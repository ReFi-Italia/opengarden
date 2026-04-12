import { OpenGardenError, OpenGardenErrorCode } from "./errors";
import type { FinalizeInterventionInput } from "./types/evidence";
import type { TimestampedOffChainResult } from "./types/results";
import { toUnixSeconds } from "./utils";

// --- Shared metadata helpers ---

export interface AttestationMetadata {
	uid: string;
	/** Lowercased signer address from the EIP-712 signed attestation. Empty string if unknown. */
	attester: string;
	/** Lowercased refUID from the signed attestation message, if set. */
	refUID: string;
	/** Self-reported `time` field from the signed attestation message (Unix seconds). 0 if unknown. */
	claimedTime: number;
	/** Authoritative on-chain timestamp (Unix seconds). */
	onchainTimestamp: number;
}

export function extractAttestationMetadata(
	result: TimestampedOffChainResult,
): AttestationMetadata {
	const sig = result.signedAttestation;
	const message = (sig.message ?? {}) as Record<string, unknown>;
	const attester =
		(sig.signer as string | undefined) ??
		(message.attester as string | undefined) ??
		"";
	const refUID = (message.refUID as string | undefined) ?? "";
	return {
		uid: result.uid,
		attester: attester.toLowerCase(),
		refUID: refUID.toLowerCase(),
		claimedTime: message.time != null ? Number(message.time) : 0,
		onchainTimestamp: Number(result.onchainTimestamp),
	};
}

function sameAddress(a: string, b: string): boolean {
	return a.toLowerCase() === b.toLowerCase();
}

function sameBytes32(a: string, b: string): boolean {
	return a.toLowerCase() === b.toLowerCase();
}

// --- Per-step pre-flight primitives (Finding B) ---

/**
 * Asserts that a persisted attestation's signer matches an expected wallet
 * address. Use before issuing a follow-up attestation (checkout, report) to
 * prove the same wallet is about to sign a continuation of the same session.
 */
export function assertAttesterMatches(
	result: TimestampedOffChainResult,
	expectedAttester: string,
	descriptor = "attestation",
): void {
	const { attester, uid } = extractAttestationMetadata(result);
	if (!attester) {
		throw new OpenGardenError(
			OpenGardenErrorCode.INVALID_INPUT,
			`${descriptor} (uid=${uid}) is missing signer/attester`,
		);
	}
	if (!sameAddress(attester, expectedAttester)) {
		throw new OpenGardenError(
			OpenGardenErrorCode.INVALID_INPUT,
			`${descriptor} (uid=${uid}) attester ${attester} does not match expected ${expectedAttester.toLowerCase()}`,
		);
	}
}

/**
 * Asserts that a persisted attestation's refUID points at the expected parent
 * attestation. Use before signing a downstream attestation whose lifecycle
 * depends on the parent (e.g. confirming a checkin points at the right
 * scheduled intervention before issuing a checkout for it).
 */
export function assertRefUIDMatches(
	result: TimestampedOffChainResult,
	expectedRefUID: string,
	descriptor = "attestation",
): void {
	const { refUID, uid } = extractAttestationMetadata(result);
	if (!refUID) {
		throw new OpenGardenError(
			OpenGardenErrorCode.INVALID_INPUT,
			`${descriptor} (uid=${uid}) is missing refUID`,
		);
	}
	if (!sameBytes32(refUID, expectedRefUID)) {
		throw new OpenGardenError(
			OpenGardenErrorCode.INVALID_INPUT,
			`${descriptor} (uid=${uid}) refUID ${refUID} does not match expected ${expectedRefUID.toLowerCase()}`,
		);
	}
}

// --- FinalizeInterventionInput validator (Finding A) ---

export enum FinalizeInputIssueCode {
	EMPTY_CREW = "EMPTY_CREW",
	EXECUTION_DATE_BEFORE_SCHEDULE = "EXECUTION_DATE_BEFORE_SCHEDULE",
	SCHEDULE_REFUID_MISMATCH = "SCHEDULE_REFUID_MISMATCH",
	CHECKIN_REFUID_MISMATCH = "CHECKIN_REFUID_MISMATCH",
	CHECKOUT_REFUID_MISMATCH = "CHECKOUT_REFUID_MISMATCH",
	REPORT_REFUID_MISMATCH = "REPORT_REFUID_MISMATCH",
	VALIDATION_REFUID_MISMATCH = "VALIDATION_REFUID_MISMATCH",
	HEALTHCHECK_BEFORE_REFUID_MISMATCH = "HEALTHCHECK_BEFORE_REFUID_MISMATCH",
	HEALTHCHECK_AFTER_REFUID_MISMATCH = "HEALTHCHECK_AFTER_REFUID_MISMATCH",
	CREW_ATTESTER_MISMATCH = "CREW_ATTESTER_MISMATCH",
	TEMPORAL_ORDER_VIOLATION = "TEMPORAL_ORDER_VIOLATION",
	HEALTHCHECK_BEFORE_OUT_OF_BRACKET = "HEALTHCHECK_BEFORE_OUT_OF_BRACKET",
	HEALTHCHECK_AFTER_OUT_OF_BRACKET = "HEALTHCHECK_AFTER_OUT_OF_BRACKET",
	VALIDATION_NOT_APPROVED = "VALIDATION_NOT_APPROVED",
}

export interface FinalizeInputIssue {
	code: FinalizeInputIssueCode;
	message: string;
	/** Crew member index (0-based) if the issue is member-specific. */
	crewIndex?: number;
	/** Attestation UID where the issue was detected, when applicable. */
	uid?: string;
}

/**
 * Pure, side-effect-free validator for a `FinalizeInterventionInput`. Runs the
 * full spec §4.2 temporal-integrity check plus wiring checks (refUIDs, same
 * attester per crew member, validation.approved). Returns a flat list of
 * issues — empty means the input is ready to finalize.
 *
 * This is the same check `finalizeIntervention` runs internally, exposed as a
 * standalone function so UIs can preview readiness and surface problems without
 * attempting to upload the evidence bundle or publish on-chain.
 */
export function validateFinalizeInput(
	input: FinalizeInterventionInput,
): FinalizeInputIssue[] {
	const issues: FinalizeInputIssue[] = [];

	if (input.crew.length === 0) {
		issues.push({
			code: FinalizeInputIssueCode.EMPTY_CREW,
			message: "Intervention has no crew members",
		});
		return issues;
	}

	const scheduled = extractAttestationMetadata(input.scheduled);
	const validation = extractAttestationMetadata(input.validation);
	const executionDate = toUnixSeconds(input.executionDate);
	const scheduledTs = BigInt(scheduled.onchainTimestamp);

	if (scheduledTs > executionDate) {
		issues.push({
			code: FinalizeInputIssueCode.EXECUTION_DATE_BEFORE_SCHEDULE,
			message: `Execution date (${executionDate}) must not be before the scheduled on-chain timestamp (${scheduledTs})`,
			uid: input.scheduled.uid,
		});
	}

	if (scheduled.refUID && !sameBytes32(scheduled.refUID, input.areaUID)) {
		issues.push({
			code: FinalizeInputIssueCode.SCHEDULE_REFUID_MISMATCH,
			message: `Scheduled attestation refUID (${scheduled.refUID}) does not match areaUID (${input.areaUID.toLowerCase()})`,
			uid: input.scheduled.uid,
		});
	}

	const checkinTimestamps: number[] = [];
	const checkoutTimestamps: number[] = [];
	const reportTimestamps: number[] = [];

	for (let i = 0; i < input.crew.length; i++) {
		const member = input.crew[i];
		const ci = extractAttestationMetadata(member.checkin);
		const co = extractAttestationMetadata(member.checkout);
		const rp = extractAttestationMetadata(member.report);

		if (ci.attester && co.attester && ci.attester !== co.attester) {
			issues.push({
				code: FinalizeInputIssueCode.CREW_ATTESTER_MISMATCH,
				message: `Crew member ${i}: checkin attester ${ci.attester} does not match checkout attester ${co.attester}`,
				crewIndex: i,
			});
		}
		if (ci.attester && rp.attester && ci.attester !== rp.attester) {
			issues.push({
				code: FinalizeInputIssueCode.CREW_ATTESTER_MISMATCH,
				message: `Crew member ${i}: checkin attester ${ci.attester} does not match report attester ${rp.attester}`,
				crewIndex: i,
			});
		}

		if (ci.refUID && !sameBytes32(ci.refUID, input.scheduled.uid)) {
			issues.push({
				code: FinalizeInputIssueCode.CHECKIN_REFUID_MISMATCH,
				message: `Crew member ${i}: checkin refUID (${ci.refUID}) does not match scheduled UID (${input.scheduled.uid.toLowerCase()})`,
				crewIndex: i,
				uid: ci.uid,
			});
		}
		if (co.refUID && !sameBytes32(co.refUID, ci.uid)) {
			issues.push({
				code: FinalizeInputIssueCode.CHECKOUT_REFUID_MISMATCH,
				message: `Crew member ${i}: checkout refUID (${co.refUID}) does not match this member's checkin UID (${ci.uid.toLowerCase()})`,
				crewIndex: i,
				uid: co.uid,
			});
		}
		if (rp.refUID && !sameBytes32(rp.refUID, input.scheduled.uid)) {
			issues.push({
				code: FinalizeInputIssueCode.REPORT_REFUID_MISMATCH,
				message: `Crew member ${i}: report refUID (${rp.refUID}) does not match scheduled UID (${input.scheduled.uid.toLowerCase()})`,
				crewIndex: i,
				uid: rp.uid,
			});
		}

		if (
			!(
				ci.onchainTimestamp < co.onchainTimestamp &&
				co.onchainTimestamp < rp.onchainTimestamp
			)
		) {
			issues.push({
				code: FinalizeInputIssueCode.TEMPORAL_ORDER_VIOLATION,
				message: `Crew member ${i}: on-chain timestamps must satisfy checkin < checkout < report, got ${ci.onchainTimestamp} / ${co.onchainTimestamp} / ${rp.onchainTimestamp}`,
				crewIndex: i,
			});
		}

		checkinTimestamps.push(ci.onchainTimestamp);
		checkoutTimestamps.push(co.onchainTimestamp);
		reportTimestamps.push(rp.onchainTimestamp);
	}

	const minCheckin = Math.min(...checkinTimestamps);
	const maxCheckout = Math.max(...checkoutTimestamps);
	const maxReport = Math.max(...reportTimestamps);

	if (scheduled.onchainTimestamp >= minCheckin) {
		issues.push({
			code: FinalizeInputIssueCode.TEMPORAL_ORDER_VIOLATION,
			message: `Scheduled on-chain timestamp (${scheduled.onchainTimestamp}) must precede the earliest checkin (${minCheckin})`,
			uid: input.scheduled.uid,
		});
	}

	if (maxReport >= validation.onchainTimestamp) {
		issues.push({
			code: FinalizeInputIssueCode.TEMPORAL_ORDER_VIOLATION,
			message: `Latest report timestamp (${maxReport}) must precede validation timestamp (${validation.onchainTimestamp})`,
			uid: input.validation.uid,
		});
	}

	if (validation.refUID && !sameBytes32(validation.refUID, input.scheduled.uid)) {
		issues.push({
			code: FinalizeInputIssueCode.VALIDATION_REFUID_MISMATCH,
			message: `Validation refUID (${validation.refUID}) does not match scheduled UID (${input.scheduled.uid.toLowerCase()})`,
			uid: input.validation.uid,
		});
	}

	if (!input.validation.approved) {
		issues.push({
			code: FinalizeInputIssueCode.VALIDATION_NOT_APPROVED,
			message: "Cannot finalize an intervention whose validation is not approved",
			uid: input.validation.uid,
		});
	}

	if (input.healthcheckBefore) {
		const hb = extractAttestationMetadata(input.healthcheckBefore);
		if (hb.refUID && !sameBytes32(hb.refUID, input.areaUID)) {
			issues.push({
				code: FinalizeInputIssueCode.HEALTHCHECK_BEFORE_REFUID_MISMATCH,
				message: `Healthcheck-before refUID (${hb.refUID}) does not match areaUID (${input.areaUID.toLowerCase()})`,
				uid: input.healthcheckBefore.uid,
			});
		}
		if (hb.onchainTimestamp >= minCheckin) {
			issues.push({
				code: FinalizeInputIssueCode.HEALTHCHECK_BEFORE_OUT_OF_BRACKET,
				message: `Healthcheck-before timestamp (${hb.onchainTimestamp}) must precede the earliest checkin (${minCheckin})`,
				uid: input.healthcheckBefore.uid,
			});
		}
	}

	if (input.healthcheckAfter) {
		const ha = extractAttestationMetadata(input.healthcheckAfter);
		if (ha.refUID && !sameBytes32(ha.refUID, input.areaUID)) {
			issues.push({
				code: FinalizeInputIssueCode.HEALTHCHECK_AFTER_REFUID_MISMATCH,
				message: `Healthcheck-after refUID (${ha.refUID}) does not match areaUID (${input.areaUID.toLowerCase()})`,
				uid: input.healthcheckAfter.uid,
			});
		}
		if (ha.onchainTimestamp <= maxCheckout) {
			issues.push({
				code: FinalizeInputIssueCode.HEALTHCHECK_AFTER_OUT_OF_BRACKET,
				message: `Healthcheck-after timestamp (${ha.onchainTimestamp}) must be after the latest checkout (${maxCheckout})`,
				uid: input.healthcheckAfter.uid,
			});
		}
	}

	return issues;
}
