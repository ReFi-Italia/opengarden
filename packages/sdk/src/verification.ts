import { EVIDENCE_BUNDLE_VERSION } from "./constants";
import type { EvidenceBundle } from "./types/evidence";

export enum VerificationCheckCode {
	BUNDLE_VERSION = "BUNDLE_VERSION",
	TEMPORAL_ORDER = "TEMPORAL_ORDER",
	EXECUTION_DATE_BRACKET = "EXECUTION_DATE_BRACKET",
	ON_CHAIN_TIMESTAMPS = "ON_CHAIN_TIMESTAMPS",
}

export interface VerificationCheck {
	code: VerificationCheckCode;
	valid: boolean;
	message?: string;
}

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

export type TimestampFetcher = (uid: string) => Promise<bigint | null>;

/**
 * Verifies that the on-chain timestamp for every attestation in the bundle
 * matches the `onchainTimestamp` recorded in the bundle itself. Takes a
 * fetcher (typically `(uid) => eas.getTimestamp(uid)`) so the check works
 * with any EAS instance or test stub. Fetch failures for individual UIDs
 * are treated as mismatches, not thrown errors.
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
