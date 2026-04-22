/**
 * Pluggable policies — verifier-side decisions encoded as data, not code.
 *
 * Both sides of the SDK (write-side pre-publish gate, read-side bundle
 * verification) accept a policy object that names which checks are required
 * for the operation to succeed. This keeps the protocol itself neutral (see
 * spec §7) while letting each consumer pick the strictness they need.
 */
import { FinalizeInputIssueCode } from "./preflight";
import { VerificationCheckCode } from "./verification";

// --- Finalize policy (write-side) ---

/**
 * Gates `finalizeIntervention`. Any issue whose code is in `blocking` aborts
 * the publish before any gas is spent.
 *
 * Note: this is a WRITE-SIDE policy applied by the publisher. It does not
 * constitute a trust guarantee for third-party readers — those apply their
 * own `VerifyPolicy` at read time.
 */
export interface FinalizePolicy {
	readonly blocking: ReadonlySet<FinalizeInputIssueCode>;
}

const ALL_FINALIZE_ISSUES: readonly FinalizeInputIssueCode[] = [
	FinalizeInputIssueCode.EMPTY_CREW,
	FinalizeInputIssueCode.EXECUTION_DATE_BEFORE_SCHEDULE,
	FinalizeInputIssueCode.SCHEDULE_SCOPE_MISMATCH,
	FinalizeInputIssueCode.ACTIVITY_SCOPE_MISMATCH,
	FinalizeInputIssueCode.SCHEDULE_AREA_MISMATCH,
	FinalizeInputIssueCode.CREW_CHAIN_INCOMPLETE,
	FinalizeInputIssueCode.TEMPORAL_ORDER_VIOLATION,
	FinalizeInputIssueCode.PAYLOAD_HASH_MISMATCH,
];

/** Strict preset — every known issue code blocks publication. */
export const STRICT_FINALIZE_POLICY: FinalizePolicy = Object.freeze({
	blocking: new Set(ALL_FINALIZE_ISSUES),
});

/**
 * Lenient preset — nothing blocks publication. The publisher accepts full
 * responsibility for the bundle's correctness and relies on read-side
 * verification to surface issues after the fact.
 */
export const LENIENT_FINALIZE_POLICY: FinalizePolicy = Object.freeze({
	blocking: new Set<FinalizeInputIssueCode>(),
});

/**
 * Minimal preset — only issues that would make the publication structurally
 * incoherent (empty crew, execution date earlier than scheduling) block.
 * Wiring / consistency issues are left to read-side verifiers.
 */
export const MINIMAL_FINALIZE_POLICY: FinalizePolicy = Object.freeze({
	blocking: new Set<FinalizeInputIssueCode>([
		FinalizeInputIssueCode.EMPTY_CREW,
		FinalizeInputIssueCode.EXECUTION_DATE_BEFORE_SCHEDULE,
	]),
});

/** Build an ad-hoc finalize policy from a list of blocking issue codes. */
export function finalizePolicy(opts: {
	blocking: readonly FinalizeInputIssueCode[];
}): FinalizePolicy {
	return Object.freeze({ blocking: new Set(opts.blocking) });
}

// --- Verify policy (read-side) ---

/**
 * Gates `verifyEvidenceBundle`. Each sub-check whose code is in `required`
 * must pass for the bundle's composite `valid` flag to be `true`. Sub-checks
 * not in `required` still run and appear in the `checks[]` breakdown, but
 * don't affect `valid`.
 *
 * `BUNDLE_VERSION` is always implicitly required — the bundle cannot be
 * decoded safely if the version is unknown, and `verifyEvidenceBundle` throws
 * rather than returning a soft "invalid" in that case.
 */
export interface VerifyPolicy {
	readonly required: ReadonlySet<VerificationCheckCode>;
}

const ALL_VERIFY_CHECKS: readonly VerificationCheckCode[] = [
	VerificationCheckCode.BUNDLE_VERSION,
	VerificationCheckCode.SIGNATURES,
	VerificationCheckCode.PAYLOAD_INTEGRITY,
	VerificationCheckCode.ON_CHAIN_TIMESTAMPS,
	VerificationCheckCode.INTERVENTION_SCOPE,
	VerificationCheckCode.TEMPORAL_ORDER,
	VerificationCheckCode.EXECUTION_DATE_BRACKET,
];

/** Strict preset — every sub-check the SDK implements must pass. */
export const STRICT_VERIFY_POLICY: VerifyPolicy = Object.freeze({
	required: new Set(ALL_VERIFY_CHECKS),
});

/**
 * Protocol-only preset — only non-negotiable protocol-tier checks are
 * required. Readers using this policy are explicitly opting out of policy-
 * tier checks (intervention scope, temporal strictness, execution bracket).
 */
export const PROTOCOL_ONLY_VERIFY_POLICY: VerifyPolicy = Object.freeze({
	required: new Set<VerificationCheckCode>([
		VerificationCheckCode.BUNDLE_VERSION,
		VerificationCheckCode.SIGNATURES,
		VerificationCheckCode.PAYLOAD_INTEGRITY,
		VerificationCheckCode.ON_CHAIN_TIMESTAMPS,
	]),
});

/** Build an ad-hoc verify policy from a list of required check codes. */
export function verifyPolicy(opts: {
	required: readonly VerificationCheckCode[];
}): VerifyPolicy {
	return Object.freeze({ required: new Set(opts.required) });
}
