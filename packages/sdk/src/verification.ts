import type { EAS } from "@ethereum-attestation-service/eas-sdk";
import { EVIDENCE_BUNDLE_VERSION } from "./constants";
import type { EvidenceBundle } from "./types/evidence";

/**
 * Verification checks split into two tiers — see spec §5 and §7.
 *
 * **Protocol tier** (non-negotiable): checks the protocol itself guarantees.
 * Skipping any of these means you no longer have a valid OpenGarden bundle.
 *   - `BUNDLE_VERSION`
 *   - `ON_CHAIN_TIMESTAMPS`
 *   - `SIGNATURES`
 *
 * **Policy tier** (verifier's call): checks a specific reader may apply
 * depending on their trust model. Two readers may legitimately disagree on
 * which of these to enforce.
 *   - `TEMPORAL_ORDER`
 *   - `EXECUTION_DATE_BRACKET`
 *   - `REFUID_WIRING`
 *   - `CREW_SIZE`
 *   - `CREW_CONSISTENCY`
 *   - `CREW_DISTINCTNESS`
 */
export enum VerificationCheckCode {
	BUNDLE_VERSION = "BUNDLE_VERSION",
	ON_CHAIN_TIMESTAMPS = "ON_CHAIN_TIMESTAMPS",
	SIGNATURES = "SIGNATURES",
	TEMPORAL_ORDER = "TEMPORAL_ORDER",
	EXECUTION_DATE_BRACKET = "EXECUTION_DATE_BRACKET",
	REFUID_WIRING = "REFUID_WIRING",
	CREW_SIZE = "CREW_SIZE",
	CREW_CONSISTENCY = "CREW_CONSISTENCY",
	CREW_DISTINCTNESS = "CREW_DISTINCTNESS",
}

export interface VerificationCheck {
	code: VerificationCheckCode;
	valid: boolean;
	message?: string;
}

// --- Protocol tier ---

/**
 * **Protocol tier.** Rejects bundles whose `bundleVersion` the SDK doesn't
 * understand. A failure here means the bundle cannot be safely decoded — every
 * downstream check becomes unreliable.
 */
export function verifyBundleVersion(bundle: EvidenceBundle): VerificationCheck {
	const ok = bundle.bundleVersion === EVIDENCE_BUNDLE_VERSION;
	return {
		code: VerificationCheckCode.BUNDLE_VERSION,
		valid: ok,
		message: ok
			? undefined
			: `Unsupported bundleVersion: ${bundle.bundleVersion ?? "missing"} (expected "${EVIDENCE_BUNDLE_VERSION}")`,
	};
}

export type TimestampFetcher = (uid: string) => Promise<bigint | null>;

/**
 * **Protocol tier.** Verifies that every attestation's bundle-recorded
 * `onchainTimestamp` matches what `EAS.getTimestamp(uid)` returns on chain.
 * A failure means the bundle JSON has been tampered with relative to the
 * canonical on-chain timestamps.
 *
 * Takes a fetcher (typically `(uid) => eas.getTimestamp(uid)`) so the check
 * works with any EAS instance or test stub. Fetch failures for individual
 * UIDs are treated as mismatches, not thrown errors.
 */
export async function verifyBundleOnChainTimestamps(
	bundle: EvidenceBundle,
	fetchTimestamp: TimestampFetcher,
): Promise<VerificationCheck> {
	const { checkins, checkouts, reports, scheduled } = bundle.attestations;

	const entries: Array<{ uid: string; onchainTimestamp: number }> = [
		scheduled,
		...checkins,
		...checkouts,
		...reports,
	];

	const results = await Promise.all(
		entries.map((e) => fetchTimestamp(e.uid).catch(() => null)),
	);

	for (let i = 0; i < entries.length; i++) {
		const ts = results[i];
		if (ts === null || Number(ts) !== entries[i].onchainTimestamp) {
			return {
				code: VerificationCheckCode.ON_CHAIN_TIMESTAMPS,
				valid: false,
				message: `On-chain timestamp mismatch for ${entries[i].uid}: bundle says ${entries[i].onchainTimestamp}, chain says ${ts}`,
			};
		}
	}

	return { code: VerificationCheckCode.ON_CHAIN_TIMESTAMPS, valid: true };
}

/**
 * **Protocol tier.** Recovers the signer from every bundle entry's EIP-712
 * signature and confirms (a) the signature is valid over the typed message,
 * and (b) the recovered signer matches the `signer` field inside the signed
 * attestation. For gardener entries, also confirms the bundle's top-level
 * `attester` field matches the recovered signer — catches publishers who
 * misreport attester identity in the bundle JSON.
 *
 * Requires an `EAS` instance configured for the same chain that signed the
 * attestations (the EIP-712 domain depends on chain + EAS contract address).
 * The bundle must have its `bigint` fields rehydrated — pass bundles through
 * `restoreBundleBigInts` after JSON parsing.
 *
 * This is a pure local check — no network calls — once the EAS instance is
 * constructed.
 */
export async function verifyBundleSignatures(
	bundle: EvidenceBundle,
	eas: EAS,
): Promise<VerificationCheck> {
	const offchain = await eas.getOffchain();
	const { scheduled, checkins, checkouts, reports } = bundle.attestations;

	type BundleEntry = {
		uid: string;
		signedAttestation: Record<string, unknown>;
		attester?: string;
		descriptor: string;
	};
	const entries: BundleEntry[] = [
		{ ...scheduled, descriptor: "scheduled" },
		...checkins.map((c, i) => ({ ...c, descriptor: `checkin[${i}]` })),
		...checkouts.map((c, i) => ({ ...c, descriptor: `checkout[${i}]` })),
		...reports.map((r, i) => ({ ...r, descriptor: `report[${i}]` })),
	];

	for (const entry of entries) {
		const sig = entry.signedAttestation;
		const signer = sig.signer as string | undefined;
		if (!signer) {
			return {
				code: VerificationCheckCode.SIGNATURES,
				valid: false,
				message: `${entry.descriptor} (uid=${entry.uid}) has no signer field`,
			};
		}
		let ok: boolean;
		try {
			ok = offchain.verifyOffchainAttestationSignature(
				signer,
				// eas-sdk expects the full SignedOffchainAttestation — the bundle
				// stores it verbatim under `signedAttestation`, so this cast is safe.
				sig as unknown as Parameters<
					typeof offchain.verifyOffchainAttestationSignature
				>[1],
			);
		} catch (err) {
			return {
				code: VerificationCheckCode.SIGNATURES,
				valid: false,
				message: `${entry.descriptor} (uid=${entry.uid}) signature verify threw: ${err instanceof Error ? err.message : String(err)}`,
			};
		}
		if (!ok) {
			return {
				code: VerificationCheckCode.SIGNATURES,
				valid: false,
				message: `${entry.descriptor} (uid=${entry.uid}) signature did not recover to signer ${signer}`,
			};
		}
		const claimedAttester = entry.attester;
		if (
			claimedAttester &&
			claimedAttester.toLowerCase() !== signer.toLowerCase()
		) {
			return {
				code: VerificationCheckCode.SIGNATURES,
				valid: false,
				message: `${entry.descriptor} (uid=${entry.uid}) bundle attester ${claimedAttester} does not match recovered signer ${signer}`,
			};
		}
	}

	return { code: VerificationCheckCode.SIGNATURES, valid: true };
}

// --- Policy tier ---

/**
 * **Policy tier.** Enforces strict `T_scheduled < min(T_checkin)` and, per
 * crew member, `T_checkin < T_checkout < T_report` on the bundle's on-chain
 * timestamps. A permissive reader may choose to skip this check or relax the
 * strictness (e.g. allow same-block timestamps).
 */
export function verifyBundleTemporalOrder(
	bundle: EvidenceBundle,
): VerificationCheck {
	const { checkins, checkouts, reports, scheduled } = bundle.attestations;
	const crewCount = checkins.length;

	if (
		crewCount === 0 ||
		crewCount !== checkouts.length ||
		crewCount !== reports.length
	) {
		return {
			code: VerificationCheckCode.TEMPORAL_ORDER,
			valid: false,
			message: `Bundle has inconsistent crew arrays: ${crewCount} checkins, ${checkouts.length} checkouts, ${reports.length} reports`,
		};
	}

	const minCheckin = Math.min(...checkins.map((c) => c.onchainTimestamp));

	if (!(scheduled.onchainTimestamp < minCheckin)) {
		return {
			code: VerificationCheckCode.TEMPORAL_ORDER,
			valid: false,
			message: `Scheduled timestamp (${scheduled.onchainTimestamp}) must precede the earliest checkin (${minCheckin})`,
		};
	}

	for (let i = 0; i < crewCount; i++) {
		const ci = checkins[i].onchainTimestamp;
		const co = checkouts[i].onchainTimestamp;
		const rp = reports[i].onchainTimestamp;
		if (!(ci < co && co < rp)) {
			return {
				code: VerificationCheckCode.TEMPORAL_ORDER,
				valid: false,
				message: `Crew member ${i}: must satisfy checkin < checkout < report, got ${ci} / ${co} / ${rp}`,
			};
		}
	}

	return { code: VerificationCheckCode.TEMPORAL_ORDER, valid: true };
}

/**
 * **Policy tier.** Enforces that the PublishedIntervention's claimed
 * `executionDate` sits between the scheduled attestation's on-chain timestamp
 * and the publication's on-chain timestamp. A permissive reader may accept
 * backdated execution dates as long as the bundle is internally consistent.
 */
export function verifyBundleExecutionDateBracket(
	bundle: EvidenceBundle,
	intervention: { executionDate: bigint; time: bigint },
): VerificationCheck {
	const scheduledTs = BigInt(bundle.attestations.scheduled.onchainTimestamp);
	const ok =
		scheduledTs <= intervention.executionDate &&
		intervention.executionDate <= intervention.time;
	return {
		code: VerificationCheckCode.EXECUTION_DATE_BRACKET,
		valid: ok,
		message: ok
			? undefined
			: `Execution date (${intervention.executionDate}) must fall between scheduled (${scheduledTs}) and publication (${intervention.time})`,
	};
}

/**
 * **Policy tier.** Asserts that every bundle entry's signed EIP-712 `refUID`
 * points at the expected parent attestation:
 *
 * - `scheduled.signedAttestation.message.refUID === bundle.areaUID`
 * - each checkin's `message.refUID === scheduled.uid`
 * - each checkout's `message.refUID === matching checkin.uid` (index-aligned)
 * - each report's `message.refUID === scheduled.uid`
 *
 * Detects bundles stitched from attestations whose parent pointers don't form
 * a consistent graph. A lenient verifier that doesn't care about graph
 * topology may skip this check.
 *
 * Pure local check — operates entirely on the signed attestation payloads
 * embedded in the bundle.
 */
export function verifyBundleRefUIDs(bundle: EvidenceBundle): VerificationCheck {
	const { scheduled, checkins, checkouts, reports } = bundle.attestations;

	const schedRefUID = readMessageRefUID(scheduled.signedAttestation);
	if (schedRefUID !== bundle.areaUID.toLowerCase()) {
		return {
			code: VerificationCheckCode.REFUID_WIRING,
			valid: false,
			message: `Scheduled attestation refUID (${schedRefUID}) does not match bundle.areaUID (${bundle.areaUID.toLowerCase()})`,
		};
	}

	const schedUID = scheduled.uid.toLowerCase();

	for (let i = 0; i < checkins.length; i++) {
		const ref = readMessageRefUID(checkins[i].signedAttestation);
		if (ref !== schedUID) {
			return {
				code: VerificationCheckCode.REFUID_WIRING,
				valid: false,
				message: `checkin[${i}] refUID (${ref}) does not match scheduled UID (${schedUID})`,
			};
		}
	}

	for (let i = 0; i < checkouts.length; i++) {
		const checkinUID = checkins[i]?.uid.toLowerCase();
		if (!checkinUID) {
			return {
				code: VerificationCheckCode.REFUID_WIRING,
				valid: false,
				message: `checkout[${i}] has no matching checkin at index ${i}`,
			};
		}
		const ref = readMessageRefUID(checkouts[i].signedAttestation);
		if (ref !== checkinUID) {
			return {
				code: VerificationCheckCode.REFUID_WIRING,
				valid: false,
				message: `checkout[${i}] refUID (${ref}) does not match checkin[${i}] UID (${checkinUID})`,
			};
		}
	}

	for (let i = 0; i < reports.length; i++) {
		const ref = readMessageRefUID(reports[i].signedAttestation);
		if (ref !== schedUID) {
			return {
				code: VerificationCheckCode.REFUID_WIRING,
				valid: false,
				message: `report[${i}] refUID (${ref}) does not match scheduled UID (${schedUID})`,
			};
		}
	}

	return { code: VerificationCheckCode.REFUID_WIRING, valid: true };
}

function readMessageRefUID(sig: Record<string, unknown>): string {
	const message = sig.message as Record<string, unknown> | undefined;
	const ref = message?.refUID;
	return typeof ref === "string" ? ref.toLowerCase() : "";
}

/**
 * **Policy tier.** Asserts that the bundle's crew-array lengths match the
 * `crewSize` declared on the ScheduledIntervention. A strict verifier uses
 * this to detect under-reporting (fewer attested crew members than assigned).
 * A lenient verifier (e.g. "lead-only suffices") may skip this check.
 *
 * All three arrays (`checkins`, `checkouts`, `reports`) must match the
 * expected size — any length divergence is reported.
 */
export function verifyBundleCrewSize(
	bundle: EvidenceBundle,
	scheduled: { crewSize: number },
): VerificationCheck {
	const { checkins, checkouts, reports } = bundle.attestations;
	const expected = scheduled.crewSize;
	const ci = checkins.length;
	const co = checkouts.length;
	const rp = reports.length;

	if (ci !== expected || co !== expected || rp !== expected) {
		return {
			code: VerificationCheckCode.CREW_SIZE,
			valid: false,
			message: `Bundle crew arrays (checkins=${ci}, checkouts=${co}, reports=${rp}) do not match ScheduledIntervention.crewSize (${expected})`,
		};
	}

	return { code: VerificationCheckCode.CREW_SIZE, valid: true };
}

/**
 * **Policy tier.** Asserts that each crew member's `(checkin, checkout,
 * report)` triple is signed by the same attester wallet. Detects bundles
 * stitched together from attestations by different wallets — e.g. Alice's
 * checkin paired with Bob's report as if they were the same crew member.
 *
 * Assumes the three arrays are index-aligned (crew member i's checkin/
 * checkout/report share array index i). Crew arrays of mismatched length are
 * reported as an error.
 */
export function verifyBundleCrewConsistency(
	bundle: EvidenceBundle,
): VerificationCheck {
	const { checkins, checkouts, reports } = bundle.attestations;
	const n = checkins.length;

	if (n === 0 || n !== checkouts.length || n !== reports.length) {
		return {
			code: VerificationCheckCode.CREW_CONSISTENCY,
			valid: false,
			message: `Bundle has inconsistent crew arrays: ${n} checkins, ${checkouts.length} checkouts, ${reports.length} reports`,
		};
	}

	for (let i = 0; i < n; i++) {
		const ci = checkins[i].attester.toLowerCase();
		const co = checkouts[i].attester.toLowerCase();
		const rp = reports[i].attester.toLowerCase();
		if (ci !== co || ci !== rp) {
			return {
				code: VerificationCheckCode.CREW_CONSISTENCY,
				valid: false,
				message: `Crew member ${i}: attesters must match across checkin/checkout/report, got ${ci} / ${co} / ${rp}`,
			};
		}
	}

	return { code: VerificationCheckCode.CREW_CONSISTENCY, valid: true };
}

/**
 * **Policy tier.** Asserts that every crew member's attester wallet is
 * distinct. Detects bundles where a single wallet produced multiple "crew
 * member" chains to pad the crew count. A verifier that accepts repeat
 * attesters (e.g. the same person working two shifts) may skip this check.
 *
 * Uses the checkin array's attester as the canonical per-member identity,
 * matching `verifyBundleCrewConsistency`.
 */
export function verifyBundleCrewDistinctness(
	bundle: EvidenceBundle,
): VerificationCheck {
	const { checkins } = bundle.attestations;
	const seen = new Set<string>();
	const duplicates: string[] = [];

	for (const c of checkins) {
		const a = c.attester.toLowerCase();
		if (seen.has(a)) {
			duplicates.push(a);
		} else {
			seen.add(a);
		}
	}

	if (duplicates.length > 0) {
		return {
			code: VerificationCheckCode.CREW_DISTINCTNESS,
			valid: false,
			message: `Crew member attesters must be distinct; duplicates: ${[...new Set(duplicates)].join(", ")}`,
		};
	}

	return { code: VerificationCheckCode.CREW_DISTINCTNESS, valid: true };
}
