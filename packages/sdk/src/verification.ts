import type { EAS } from "@ethereum-attestation-service/eas-sdk";
import { EVIDENCE_BUNDLE_VERSION } from "./constants";
import { decodeActivityData } from "./schemas/encoders";
import { ACTIVITY_TYPE_NAMES, type ActivityType } from "./types/enums";
import type { BundleActivity, EvidenceBundle } from "./types/evidence";
import {
	hashActivityPayload,
	hashInterventionScope,
	sameAddress,
	sameBytes32,
} from "./utils";

/**
 * Verification checks split into two tiers — see spec §5 and §7.
 *
 * **Protocol tier** (non-negotiable): guarantees the protocol itself makes.
 * Skipping any of these means you no longer have a valid OpenGarden bundle.
 *   - `BUNDLE_VERSION`
 *   - `SIGNATURES`
 *   - `PAYLOAD_INTEGRITY`
 *   - `ON_CHAIN_TIMESTAMPS`
 *
 * **Policy tier** (verifier's call): checks a specific reader may apply
 * depending on their trust model. Two readers may legitimately disagree on
 * which of these to enforce.
 *   - `INTERVENTION_SCOPE`
 *   - `TEMPORAL_ORDER`
 *   - `EXECUTION_DATE_BRACKET`
 *   - `CREW_SIZE`
 *   - `CREW_CONSISTENCY`
 *   - `CREW_DISTINCTNESS`
 *   - `SCHEDULE_UNIQUENESS`
 */
export enum VerificationCheckCode {
	BUNDLE_VERSION = "BUNDLE_VERSION",
	SIGNATURES = "SIGNATURES",
	PAYLOAD_INTEGRITY = "PAYLOAD_INTEGRITY",
	ON_CHAIN_TIMESTAMPS = "ON_CHAIN_TIMESTAMPS",
	INTERVENTION_SCOPE = "INTERVENTION_SCOPE",
	TEMPORAL_ORDER = "TEMPORAL_ORDER",
	EXECUTION_DATE_BRACKET = "EXECUTION_DATE_BRACKET",
	CREW_SIZE = "CREW_SIZE",
	CREW_CONSISTENCY = "CREW_CONSISTENCY",
	CREW_DISTINCTNESS = "CREW_DISTINCTNESS",
	SCHEDULE_UNIQUENESS = "SCHEDULE_UNIQUENESS",
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
 * **Protocol tier.** Verifies that every activity's bundle-recorded
 * `onchainTimestamp` matches what `EAS.getTimestamp(uid)` returns on chain.
 * A failure means the bundle JSON has been tampered with relative to the
 * canonical on-chain timestamps.
 */
export async function verifyBundleOnChainTimestamps(
	bundle: EvidenceBundle,
	fetchTimestamp: TimestampFetcher,
): Promise<VerificationCheck> {
	const results = await Promise.all(
		bundle.activities.map((a) => fetchTimestamp(a.uid).catch(() => null)),
	);

	for (let i = 0; i < bundle.activities.length; i++) {
		const entry = bundle.activities[i];
		const ts = results[i];
		if (ts === null || Number(ts) !== entry.onchainTimestamp) {
			return {
				code: VerificationCheckCode.ON_CHAIN_TIMESTAMPS,
				valid: false,
				message: `On-chain timestamp mismatch for ${entry.uid}: bundle says ${entry.onchainTimestamp}, chain says ${ts}`,
			};
		}
	}

	return { code: VerificationCheckCode.ON_CHAIN_TIMESTAMPS, valid: true };
}

/**
 * **Protocol tier.** Recovers the signer from every activity's EIP-712
 * signature and confirms (a) the signature is valid over the typed message,
 * and (b) the recovered signer matches the bundle-level `signer` and the
 * embedded `signedAttestation.signer`.
 */
export async function verifyBundleSignatures(
	bundle: EvidenceBundle,
	eas: EAS,
): Promise<VerificationCheck> {
	const offchain = await eas.getOffchain();

	for (let i = 0; i < bundle.activities.length; i++) {
		const entry = bundle.activities[i];
		const sig = entry.signedAttestation;
		const embeddedSigner = sig.signer as string | undefined;
		if (!embeddedSigner) {
			return {
				code: VerificationCheckCode.SIGNATURES,
				valid: false,
				message: `activity[${i}] (uid=${entry.uid}, type=${entry.type}) has no signedAttestation.signer field`,
			};
		}
		let ok: boolean;
		try {
			ok = offchain.verifyOffchainAttestationSignature(
				embeddedSigner,
				sig as unknown as Parameters<
					typeof offchain.verifyOffchainAttestationSignature
				>[1],
			);
		} catch (err) {
			return {
				code: VerificationCheckCode.SIGNATURES,
				valid: false,
				message: `activity[${i}] (uid=${entry.uid}, type=${entry.type}) signature verify threw: ${err instanceof Error ? err.message : String(err)}`,
			};
		}
		if (!ok) {
			return {
				code: VerificationCheckCode.SIGNATURES,
				valid: false,
				message: `activity[${i}] (uid=${entry.uid}, type=${entry.type}) signature did not recover to signer ${embeddedSigner}`,
			};
		}
		if (!sameAddress(entry.signer, embeddedSigner)) {
			return {
				code: VerificationCheckCode.SIGNATURES,
				valid: false,
				message: `activity[${i}] (uid=${entry.uid}, type=${entry.type}) bundle signer ${entry.signer} does not match embedded signer ${embeddedSigner}`,
			};
		}
	}

	return { code: VerificationCheckCode.SIGNATURES, valid: true };
}

/**
 * **Protocol tier.** Recomputes `keccak256(canonicalJSON(payload))` for each
 * activity and confirms it matches the `payloadHash` decoded from the signed
 * ABI data. Also confirms the decoded `activityType` matches the bundle
 * entry's `type` field. A failure means the plaintext payload in the bundle
 * does not correspond to what was originally signed.
 */
export function verifyBundlePayloadIntegrity(
	bundle: EvidenceBundle,
): VerificationCheck {
	for (let i = 0; i < bundle.activities.length; i++) {
		const entry = bundle.activities[i];
		const message = entry.signedAttestation.message as
			| Record<string, unknown>
			| undefined;
		const data = message?.data as string | undefined;
		if (!data) {
			return {
				code: VerificationCheckCode.PAYLOAD_INTEGRITY,
				valid: false,
				message: `activity[${i}] (uid=${entry.uid}, type=${entry.type}) signedAttestation.message.data missing`,
			};
		}
		let activityType: ActivityType;
		let payloadHash: string;
		try {
			({ activityType, payloadHash } = decodeActivityData(data));
		} catch (err) {
			return {
				code: VerificationCheckCode.PAYLOAD_INTEGRITY,
				valid: false,
				message: `activity[${i}] (uid=${entry.uid}) failed to decode Activity data: ${err instanceof Error ? err.message : String(err)}`,
			};
		}

		const expectedTypeName = ACTIVITY_TYPE_NAMES[activityType];
		if (expectedTypeName !== entry.type) {
			return {
				code: VerificationCheckCode.PAYLOAD_INTEGRITY,
				valid: false,
				message: `activity[${i}] (uid=${entry.uid}) type mismatch: bundle says "${entry.type}", signed data says "${expectedTypeName}"`,
			};
		}

		const computed = hashActivityPayload(
			entry.payload as unknown as Record<string, unknown>,
		);
		if (!sameBytes32(computed, payloadHash)) {
			return {
				code: VerificationCheckCode.PAYLOAD_INTEGRITY,
				valid: false,
				message: `activity[${i}] (uid=${entry.uid}, type=${entry.type}) payloadHash mismatch: bundle payload hashes to ${computed}, signed data commits to ${payloadHash}`,
			};
		}
	}

	return { code: VerificationCheckCode.PAYLOAD_INTEGRITY, valid: true };
}

// --- Policy tier ---

/**
 * **Policy tier.** Asserts every lifecycle entry's signed `refUID` equals
 * `keccak256(intervention.interventionId)`. A mismatch indicates the bundle
 * was stitched from activities that don't share this intervention's scope.
 */
export function verifyBundleInterventionScope(
	bundle: EvidenceBundle,
	intervention: { interventionId: string },
): VerificationCheck {
	const expected = hashInterventionScope(intervention.interventionId);
	for (let i = 0; i < bundle.activities.length; i++) {
		const entry = bundle.activities[i];
		const message = entry.signedAttestation.message as
			| Record<string, unknown>
			| undefined;
		const refUID = (message?.refUID as string | undefined) ?? "";
		if (!sameBytes32(refUID, expected)) {
			return {
				code: VerificationCheckCode.INTERVENTION_SCOPE,
				valid: false,
				message: `activity[${i}] (uid=${entry.uid}, type=${entry.type}) refUID ${refUID} does not match intervention scope ${expected}`,
			};
		}
	}
	return { code: VerificationCheckCode.INTERVENTION_SCOPE, valid: true };
}

/**
 * **Policy tier.** Exactly one entry with `type === "schedule"` appears in
 * the bundle. Multiple schedule Activities may exist on chain (e.g. after a
 * reschedule), but the bundle commits to the authoritative one.
 */
export function verifyBundleScheduleUniqueness(
	bundle: EvidenceBundle,
): VerificationCheck {
	const schedules = bundle.activities.filter((a) => a.type === "schedule");
	if (schedules.length !== 1) {
		return {
			code: VerificationCheckCode.SCHEDULE_UNIQUENESS,
			valid: false,
			message: `Bundle must contain exactly one schedule activity; got ${schedules.length}`,
		};
	}
	return { code: VerificationCheckCode.SCHEDULE_UNIQUENESS, valid: true };
}

/**
 * **Policy tier.** Enforces strict per-signer `T_schedule < T_checkin <
 * T_checkout < T_report` on the bundle's on-chain timestamps. The schedule
 * anchor is the earliest `type === "schedule"` onchainTimestamp; each crew
 * signer's triple is enforced independently.
 */
export function verifyBundleTemporalOrder(
	bundle: EvidenceBundle,
): VerificationCheck {
	const schedule = bundle.activities.find((a) => a.type === "schedule");
	if (!schedule) {
		return {
			code: VerificationCheckCode.TEMPORAL_ORDER,
			valid: false,
			message: "Bundle has no schedule activity",
		};
	}

	const crew = groupCrewBySigner(bundle);
	if (crew.size === 0) {
		return {
			code: VerificationCheckCode.TEMPORAL_ORDER,
			valid: false,
			message: "Bundle has no crew activities",
		};
	}

	const scheduleTs = schedule.onchainTimestamp;
	for (const [signer, group] of crew) {
		if (!group.checkin || !group.checkout || !group.report) {
			return {
				code: VerificationCheckCode.TEMPORAL_ORDER,
				valid: false,
				message: `Crew signer ${signer} missing one of checkin/checkout/report`,
			};
		}
		const ci = group.checkin.onchainTimestamp;
		const co = group.checkout.onchainTimestamp;
		const rp = group.report.onchainTimestamp;
		if (!(scheduleTs < ci)) {
			return {
				code: VerificationCheckCode.TEMPORAL_ORDER,
				valid: false,
				message: `Schedule timestamp (${scheduleTs}) must precede crew signer ${signer}'s checkin (${ci})`,
			};
		}
		if (!(ci < co && co < rp)) {
			return {
				code: VerificationCheckCode.TEMPORAL_ORDER,
				valid: false,
				message: `Crew signer ${signer}: must satisfy checkin < checkout < report, got ${ci} / ${co} / ${rp}`,
			};
		}
	}

	return { code: VerificationCheckCode.TEMPORAL_ORDER, valid: true };
}

/**
 * **Policy tier.** Enforces that the Intervention's claimed `executionDate`
 * sits between the schedule Activity's on-chain timestamp and the
 * Intervention's on-chain publication timestamp.
 */
export function verifyBundleExecutionDateBracket(
	bundle: EvidenceBundle,
	intervention: { executionDate: bigint; time: bigint },
): VerificationCheck {
	const schedule = bundle.activities.find((a) => a.type === "schedule");
	if (!schedule) {
		return {
			code: VerificationCheckCode.EXECUTION_DATE_BRACKET,
			valid: false,
			message: "Bundle has no schedule activity",
		};
	}
	const scheduledTs = BigInt(schedule.onchainTimestamp);
	const ok =
		scheduledTs <= intervention.executionDate &&
		intervention.executionDate <= intervention.time;
	return {
		code: VerificationCheckCode.EXECUTION_DATE_BRACKET,
		valid: ok,
		message: ok
			? undefined
			: `Execution date (${intervention.executionDate}) must fall between schedule (${scheduledTs}) and publication (${intervention.time})`,
	};
}

/**
 * **Policy tier.** Asserts that the number of distinct `checkin` activities
 * in the bundle equals the schedule payload's `crewSize`.
 */
export function verifyBundleCrewSize(
	bundle: EvidenceBundle,
): VerificationCheck {
	const schedule = bundle.activities.find((a) => a.type === "schedule");
	if (!schedule) {
		return {
			code: VerificationCheckCode.CREW_SIZE,
			valid: false,
			message: "Bundle has no schedule activity",
		};
	}
	const expected = schedule.payload.crewSize;
	const checkins = bundle.activities.filter((a) => a.type === "checkin").length;
	if (checkins !== expected) {
		return {
			code: VerificationCheckCode.CREW_SIZE,
			valid: false,
			message: `Bundle has ${checkins} checkin activities but schedule payload.crewSize is ${expected}`,
		};
	}
	return { code: VerificationCheckCode.CREW_SIZE, valid: true };
}

/**
 * **Policy tier.** Filters to activities whose type is `checkin`/`checkout`/
 * `report`, groups by signer, and asserts each group contains exactly one of
 * each type. Detects bundles where a crew member's chain is incomplete or
 * stitched from different signers.
 */
export function verifyBundleCrewConsistency(
	bundle: EvidenceBundle,
): VerificationCheck {
	const crew = groupCrewBySigner(bundle);
	if (crew.size === 0) {
		return {
			code: VerificationCheckCode.CREW_CONSISTENCY,
			valid: false,
			message: "Bundle has no crew activities",
		};
	}
	for (const [signer, group] of crew) {
		if (!group.checkin) {
			return {
				code: VerificationCheckCode.CREW_CONSISTENCY,
				valid: false,
				message: `Crew signer ${signer} has no checkin activity`,
			};
		}
		if (!group.checkout) {
			return {
				code: VerificationCheckCode.CREW_CONSISTENCY,
				valid: false,
				message: `Crew signer ${signer} has no checkout activity`,
			};
		}
		if (!group.report) {
			return {
				code: VerificationCheckCode.CREW_CONSISTENCY,
				valid: false,
				message: `Crew signer ${signer} has no report activity`,
			};
		}
		if (group.extras.length > 0) {
			return {
				code: VerificationCheckCode.CREW_CONSISTENCY,
				valid: false,
				message: `Crew signer ${signer} has duplicate activities: ${group.extras.map((e) => e.type).join(", ")}`,
			};
		}
	}
	return { code: VerificationCheckCode.CREW_CONSISTENCY, valid: true };
}

/**
 * **Policy tier.** Asserts every crew signer wallet is distinct. Detects
 * bundles where a single wallet produced multiple "crew member" chains.
 */
export function verifyBundleCrewDistinctness(
	bundle: EvidenceBundle,
): VerificationCheck {
	const crew = groupCrewBySigner(bundle);
	const signers = [...crew.keys()];
	const unique = new Set(signers.map((s) => s.toLowerCase()));
	if (unique.size !== signers.length) {
		return {
			code: VerificationCheckCode.CREW_DISTINCTNESS,
			valid: false,
			message: `Crew signer wallets must be distinct; got ${signers.length} entries with ${unique.size} distinct addresses`,
		};
	}
	return { code: VerificationCheckCode.CREW_DISTINCTNESS, valid: true };
}

// --- Helpers ---

interface CrewGroup {
	checkin?: BundleActivity;
	checkout?: BundleActivity;
	report?: BundleActivity;
	extras: BundleActivity[];
}

/**
 * Groups lifecycle activities by signer. Keyed by lowercased signer address.
 * Only considers `checkin`, `checkout`, `report` types — the schedule
 * activity is explicitly excluded (even if the schedule signer also acts as
 * a crew member, their crew chain is still visible in the same `signer`
 * group once filtered by type).
 */
function groupCrewBySigner(bundle: EvidenceBundle): Map<string, CrewGroup> {
	const groups = new Map<string, CrewGroup>();
	for (const entry of bundle.activities) {
		if (
			entry.type !== "checkin" &&
			entry.type !== "checkout" &&
			entry.type !== "report"
		) {
			continue;
		}
		const key = entry.signer.toLowerCase();
		let g = groups.get(key);
		if (!g) {
			g = { extras: [] };
			groups.set(key, g);
		}
		if (entry.type === "checkin") {
			if (g.checkin) g.extras.push(entry);
			else g.checkin = entry;
		} else if (entry.type === "checkout") {
			if (g.checkout) g.extras.push(entry);
			else g.checkout = entry;
		} else {
			if (g.report) g.extras.push(entry);
			else g.report = entry;
		}
	}
	return groups;
}
