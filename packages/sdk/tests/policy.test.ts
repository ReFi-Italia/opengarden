import { describe, expect, it } from "vitest";
import {
	finalizePolicy,
	LENIENT_FINALIZE_POLICY,
	MINIMAL_FINALIZE_POLICY,
	PROTOCOL_ONLY_VERIFY_POLICY,
	STRICT_FINALIZE_POLICY,
	STRICT_VERIFY_POLICY,
	verifyPolicy,
} from "../src/policy";
import { FinalizeInputIssueCode } from "../src/preflight";
import { VerificationCheckCode } from "../src/verification";

// --- FinalizePolicy presets ---

describe("FinalizePolicy presets", () => {
	it("STRICT blocks every known issue code", () => {
		for (const code of Object.values(FinalizeInputIssueCode)) {
			expect(STRICT_FINALIZE_POLICY.blocking.has(code)).toBe(true);
		}
	});

	it("LENIENT blocks nothing", () => {
		expect(LENIENT_FINALIZE_POLICY.blocking.size).toBe(0);
	});

	it("MINIMAL blocks only EMPTY_CREW and EXECUTION_DATE_BEFORE_SCHEDULE", () => {
		expect(MINIMAL_FINALIZE_POLICY.blocking.size).toBe(2);
		expect(
			MINIMAL_FINALIZE_POLICY.blocking.has(FinalizeInputIssueCode.EMPTY_CREW),
		).toBe(true);
		expect(
			MINIMAL_FINALIZE_POLICY.blocking.has(
				FinalizeInputIssueCode.EXECUTION_DATE_BEFORE_SCHEDULE,
			),
		).toBe(true);
	});

	it("MINIMAL does NOT block wiring-level issues", () => {
		const wiringCodes: FinalizeInputIssueCode[] = [
			FinalizeInputIssueCode.SCHEDULE_SCOPE_MISMATCH,
			FinalizeInputIssueCode.ACTIVITY_SCOPE_MISMATCH,
			FinalizeInputIssueCode.SCHEDULE_AREA_MISMATCH,
			FinalizeInputIssueCode.CREW_CHAIN_INCOMPLETE,
			FinalizeInputIssueCode.TEMPORAL_ORDER_VIOLATION,
			FinalizeInputIssueCode.PAYLOAD_HASH_MISMATCH,
		];
		for (const code of wiringCodes) {
			expect(MINIMAL_FINALIZE_POLICY.blocking.has(code)).toBe(false);
		}
	});

	it("presets are frozen", () => {
		expect(Object.isFrozen(STRICT_FINALIZE_POLICY)).toBe(true);
		expect(Object.isFrozen(LENIENT_FINALIZE_POLICY)).toBe(true);
		expect(Object.isFrozen(MINIMAL_FINALIZE_POLICY)).toBe(true);
	});
});

// --- finalizePolicy builder ---

describe("finalizePolicy builder", () => {
	it("produces a policy with the given blocking set", () => {
		const p = finalizePolicy({
			blocking: [
				FinalizeInputIssueCode.EMPTY_CREW,
				FinalizeInputIssueCode.TEMPORAL_ORDER_VIOLATION,
			],
		});
		expect(p.blocking.size).toBe(2);
		expect(p.blocking.has(FinalizeInputIssueCode.EMPTY_CREW)).toBe(true);
		expect(
			p.blocking.has(FinalizeInputIssueCode.TEMPORAL_ORDER_VIOLATION),
		).toBe(true);
		expect(
			p.blocking.has(FinalizeInputIssueCode.SCHEDULE_SCOPE_MISMATCH),
		).toBe(false);
	});

	it("returns a frozen policy", () => {
		const p = finalizePolicy({ blocking: [] });
		expect(Object.isFrozen(p)).toBe(true);
	});

	it("dedupes repeated codes via Set semantics", () => {
		const p = finalizePolicy({
			blocking: [
				FinalizeInputIssueCode.EMPTY_CREW,
				FinalizeInputIssueCode.EMPTY_CREW,
				FinalizeInputIssueCode.EMPTY_CREW,
			],
		});
		expect(p.blocking.size).toBe(1);
	});

	it("accepts an empty blocking list (equivalent to LENIENT)", () => {
		const p = finalizePolicy({ blocking: [] });
		expect(p.blocking.size).toBe(0);
	});
});

// --- VerifyPolicy presets ---

describe("VerifyPolicy presets", () => {
	// Crew-* codes are composable helpers but not included in the default
	// STRICT preset run by `verifyEvidenceBundle` — readers wanting crew checks
	// compose those helpers themselves. SCHEDULE_UNIQUENESS is in the same
	// category.
	const STRICT_EXPECTED: readonly VerificationCheckCode[] = [
		VerificationCheckCode.BUNDLE_VERSION,
		VerificationCheckCode.SIGNATURES,
		VerificationCheckCode.PAYLOAD_INTEGRITY,
		VerificationCheckCode.ON_CHAIN_TIMESTAMPS,
		VerificationCheckCode.INTERVENTION_SCOPE,
		VerificationCheckCode.TEMPORAL_ORDER,
		VerificationCheckCode.EXECUTION_DATE_BRACKET,
	];

	it("STRICT requires the base check set (protocol + core policy checks)", () => {
		expect(STRICT_VERIFY_POLICY.required.size).toBe(STRICT_EXPECTED.length);
		for (const code of STRICT_EXPECTED) {
			expect(STRICT_VERIFY_POLICY.required.has(code)).toBe(true);
		}
	});

	it("STRICT does NOT include crew-composable or schedule-uniqueness codes", () => {
		expect(
			STRICT_VERIFY_POLICY.required.has(VerificationCheckCode.CREW_SIZE),
		).toBe(false);
		expect(
			STRICT_VERIFY_POLICY.required.has(VerificationCheckCode.CREW_CONSISTENCY),
		).toBe(false);
		expect(
			STRICT_VERIFY_POLICY.required.has(VerificationCheckCode.CREW_DISTINCTNESS),
		).toBe(false);
		expect(
			STRICT_VERIFY_POLICY.required.has(
				VerificationCheckCode.SCHEDULE_UNIQUENESS,
			),
		).toBe(false);
	});

	it("PROTOCOL_ONLY requires exactly the protocol-tier checks", () => {
		const expected: readonly VerificationCheckCode[] = [
			VerificationCheckCode.BUNDLE_VERSION,
			VerificationCheckCode.SIGNATURES,
			VerificationCheckCode.PAYLOAD_INTEGRITY,
			VerificationCheckCode.ON_CHAIN_TIMESTAMPS,
		];
		expect(PROTOCOL_ONLY_VERIFY_POLICY.required.size).toBe(expected.length);
		for (const code of expected) {
			expect(PROTOCOL_ONLY_VERIFY_POLICY.required.has(code)).toBe(true);
		}
	});

	it("PROTOCOL_ONLY excludes every policy-tier code", () => {
		const policyTier: readonly VerificationCheckCode[] = [
			VerificationCheckCode.INTERVENTION_SCOPE,
			VerificationCheckCode.TEMPORAL_ORDER,
			VerificationCheckCode.EXECUTION_DATE_BRACKET,
			VerificationCheckCode.CREW_SIZE,
			VerificationCheckCode.CREW_CONSISTENCY,
			VerificationCheckCode.CREW_DISTINCTNESS,
			VerificationCheckCode.SCHEDULE_UNIQUENESS,
		];
		for (const code of policyTier) {
			expect(PROTOCOL_ONLY_VERIFY_POLICY.required.has(code)).toBe(false);
		}
	});

	it("PAYLOAD_INTEGRITY is in every preset (protocol-tier essential)", () => {
		expect(
			STRICT_VERIFY_POLICY.required.has(VerificationCheckCode.PAYLOAD_INTEGRITY),
		).toBe(true);
		expect(
			PROTOCOL_ONLY_VERIFY_POLICY.required.has(
				VerificationCheckCode.PAYLOAD_INTEGRITY,
			),
		).toBe(true);
	});

	it("presets are frozen", () => {
		expect(Object.isFrozen(STRICT_VERIFY_POLICY)).toBe(true);
		expect(Object.isFrozen(PROTOCOL_ONLY_VERIFY_POLICY)).toBe(true);
	});
});

// --- verifyPolicy builder ---

describe("verifyPolicy builder", () => {
	it("produces a policy with the given required set", () => {
		const p = verifyPolicy({
			required: [
				VerificationCheckCode.SIGNATURES,
				VerificationCheckCode.BUNDLE_VERSION,
			],
		});
		expect(p.required.size).toBe(2);
		expect(p.required.has(VerificationCheckCode.SIGNATURES)).toBe(true);
		expect(p.required.has(VerificationCheckCode.TEMPORAL_ORDER)).toBe(false);
	});

	it("dedupes repeated codes via Set semantics", () => {
		const p = verifyPolicy({
			required: [
				VerificationCheckCode.SIGNATURES,
				VerificationCheckCode.SIGNATURES,
			],
		});
		expect(p.required.size).toBe(1);
	});

	it("accepts an empty required list (effectively always-valid)", () => {
		const p = verifyPolicy({ required: [] });
		expect(p.required.size).toBe(0);
	});

	it("returns a frozen policy", () => {
		const p = verifyPolicy({ required: [] });
		expect(Object.isFrozen(p)).toBe(true);
	});

	it("supports composing crew checks when the caller wants them", () => {
		const p = verifyPolicy({
			required: [
				...STRICT_VERIFY_POLICY.required,
				VerificationCheckCode.CREW_SIZE,
				VerificationCheckCode.CREW_CONSISTENCY,
				VerificationCheckCode.CREW_DISTINCTNESS,
				VerificationCheckCode.SCHEDULE_UNIQUENESS,
			],
		});
		expect(p.required.has(VerificationCheckCode.CREW_SIZE)).toBe(true);
		expect(p.required.has(VerificationCheckCode.CREW_CONSISTENCY)).toBe(true);
		expect(p.required.has(VerificationCheckCode.CREW_DISTINCTNESS)).toBe(true);
		expect(p.required.has(VerificationCheckCode.SCHEDULE_UNIQUENESS)).toBe(true);
	});
});
