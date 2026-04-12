import { EVIDENCE_BUNDLE_VERSION } from "./constants";
import type { EvidenceBundle } from "./types/evidence";

export enum VerificationCheckCode {
	BUNDLE_VERSION = "BUNDLE_VERSION",
	COMPLETENESS = "COMPLETENESS",
	TEMPORAL_ORDER = "TEMPORAL_ORDER",
	HEALTHCHECK_BRACKET = "HEALTHCHECK_BRACKET",
	EXECUTION_DATE_BRACKET = "EXECUTION_DATE_BRACKET",
	VALIDATION_APPROVED = "VALIDATION_APPROVED",
	ON_CHAIN_TIMESTAMPS = "ON_CHAIN_TIMESTAMPS",
}

export interface VerificationCheck {
	code: VerificationCheckCode;
	valid: boolean;
	message?: string;
}

export interface CompletenessCheck extends VerificationCheck {
	code: VerificationCheckCode.COMPLETENESS;
	attestationCount: number;
	expectedCount: number;
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

export function verifyBundleCompleteness(
	bundle: EvidenceBundle,
	expectedCount: number,
): CompletenessCheck {
	const {
		checkins,
		checkouts,
		reports,
		healthcheckBefore,
		healthcheckAfter,
	} = bundle.attestations;
	const attestationCount =
		2 +
		checkins.length +
		checkouts.length +
		reports.length +
		(healthcheckBefore ? 1 : 0) +
		(healthcheckAfter ? 1 : 0);
	const ok = attestationCount === expectedCount;
	return {
		code: VerificationCheckCode.COMPLETENESS,
		valid: ok,
		message: ok
			? undefined
			: `Bundle contains ${attestationCount} attestations, expected ${expectedCount}`,
		attestationCount,
		expectedCount,
	};
}

export function verifyBundleTemporalOrder(
	bundle: EvidenceBundle,
): VerificationCheck {
	const { checkins, checkouts, reports, scheduled, validation } =
		bundle.attestations;
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
	const maxReport = Math.max(...reports.map((r) => r.onchainTimestamp));

	if (!(scheduled.onchainTimestamp < minCheckin)) {
		return {
			code: VerificationCheckCode.TEMPORAL_ORDER,
			valid: false,
			message: `Scheduled timestamp (${scheduled.onchainTimestamp}) must precede the earliest checkin (${minCheckin})`,
		};
	}

	if (!(maxReport < validation.onchainTimestamp)) {
		return {
			code: VerificationCheckCode.TEMPORAL_ORDER,
			valid: false,
			message: `Latest report timestamp (${maxReport}) must precede validation timestamp (${validation.onchainTimestamp})`,
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

export function verifyBundleHealthcheckBracket(
	bundle: EvidenceBundle,
): VerificationCheck {
	const { checkins, checkouts, healthcheckBefore, healthcheckAfter } =
		bundle.attestations;

	if (!healthcheckBefore && !healthcheckAfter) {
		return { code: VerificationCheckCode.HEALTHCHECK_BRACKET, valid: true };
	}

	if (checkins.length === 0) {
		return {
			code: VerificationCheckCode.HEALTHCHECK_BRACKET,
			valid: false,
			message:
				"Bundle has healthcheck entries but no crew checkins to bracket against",
		};
	}

	const minCheckin = Math.min(...checkins.map((c) => c.onchainTimestamp));
	const maxCheckout = Math.max(...checkouts.map((c) => c.onchainTimestamp));

	if (healthcheckBefore && healthcheckBefore.onchainTimestamp >= minCheckin) {
		return {
			code: VerificationCheckCode.HEALTHCHECK_BRACKET,
			valid: false,
			message: `Healthcheck-before timestamp (${healthcheckBefore.onchainTimestamp}) must precede the earliest checkin (${minCheckin})`,
		};
	}
	if (healthcheckAfter && healthcheckAfter.onchainTimestamp <= maxCheckout) {
		return {
			code: VerificationCheckCode.HEALTHCHECK_BRACKET,
			valid: false,
			message: `Healthcheck-after timestamp (${healthcheckAfter.onchainTimestamp}) must be after the latest checkout (${maxCheckout})`,
		};
	}

	return { code: VerificationCheckCode.HEALTHCHECK_BRACKET, valid: true };
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

export function verifyBundleValidationApproved(
	bundle: EvidenceBundle,
): VerificationCheck {
	const ok = bundle.attestations.validation.approved === true;
	return {
		code: VerificationCheckCode.VALIDATION_APPROVED,
		valid: ok,
		message: ok ? undefined : "Bundle validation is not approved",
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
	const {
		checkins,
		checkouts,
		reports,
		scheduled,
		validation,
		healthcheckBefore,
		healthcheckAfter,
	} = bundle.attestations;

	const entries: Array<{ uid: string; onchainTimestamp: number }> = [
		scheduled,
		...checkins,
		...checkouts,
		...reports,
		validation,
	];
	if (healthcheckBefore) entries.push(healthcheckBefore);
	if (healthcheckAfter) entries.push(healthcheckAfter);

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
