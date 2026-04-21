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

describe("FinalizePolicy presets", () => {
	it("STRICT blocks every known issue code", () => {
		for (const code of Object.values(FinalizeInputIssueCode)) {
			expect(STRICT_FINALIZE_POLICY.blocking.has(code)).toBe(true);
		}
	});

	it("LENIENT blocks nothing", () => {
		expect(LENIENT_FINALIZE_POLICY.blocking.size).toBe(0);
	});

	it("MINIMAL blocks only structural issues", () => {
		expect(
			MINIMAL_FINALIZE_POLICY.blocking.has(FinalizeInputIssueCode.EMPTY_CREW),
		).toBe(true);
		expect(
			MINIMAL_FINALIZE_POLICY.blocking.has(
				FinalizeInputIssueCode.EXECUTION_DATE_BEFORE_SCHEDULE,
			),
		).toBe(true);
		expect(
			MINIMAL_FINALIZE_POLICY.blocking.has(
				FinalizeInputIssueCode.TEMPORAL_ORDER_VIOLATION,
			),
		).toBe(false);
	});

	it("presets are frozen", () => {
		expect(Object.isFrozen(STRICT_FINALIZE_POLICY)).toBe(true);
		expect(Object.isFrozen(LENIENT_FINALIZE_POLICY)).toBe(true);
		expect(Object.isFrozen(MINIMAL_FINALIZE_POLICY)).toBe(true);
	});
});

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
			p.blocking.has(FinalizeInputIssueCode.SCHEDULE_REFUID_MISMATCH),
		).toBe(false);
	});

	it("returns a frozen policy", () => {
		const p = finalizePolicy({ blocking: [] });
		expect(Object.isFrozen(p)).toBe(true);
	});
});

describe("VerifyPolicy presets", () => {
	it("STRICT requires every known check code", () => {
		for (const code of Object.values(VerificationCheckCode)) {
			// Crew-* codes are exposed as helpers but not run by verifyEvidenceBundle;
			// STRICT preset only spans the codes verifyEvidenceBundle itself runs.
			if (
				code === VerificationCheckCode.CREW_SIZE ||
				code === VerificationCheckCode.CREW_CONSISTENCY ||
				code === VerificationCheckCode.CREW_DISTINCTNESS
			) {
				continue;
			}
			expect(STRICT_VERIFY_POLICY.required.has(code)).toBe(true);
		}
	});

	it("PROTOCOL_ONLY requires only protocol-tier checks", () => {
		expect(
			PROTOCOL_ONLY_VERIFY_POLICY.required.has(
				VerificationCheckCode.BUNDLE_VERSION,
			),
		).toBe(true);
		expect(
			PROTOCOL_ONLY_VERIFY_POLICY.required.has(
				VerificationCheckCode.SIGNATURES,
			),
		).toBe(true);
		expect(
			PROTOCOL_ONLY_VERIFY_POLICY.required.has(
				VerificationCheckCode.ON_CHAIN_TIMESTAMPS,
			),
		).toBe(true);
		expect(
			PROTOCOL_ONLY_VERIFY_POLICY.required.has(
				VerificationCheckCode.REFUID_WIRING,
			),
		).toBe(false);
		expect(
			PROTOCOL_ONLY_VERIFY_POLICY.required.has(
				VerificationCheckCode.TEMPORAL_ORDER,
			),
		).toBe(false);
	});

	it("presets are frozen", () => {
		expect(Object.isFrozen(STRICT_VERIFY_POLICY)).toBe(true);
		expect(Object.isFrozen(PROTOCOL_ONLY_VERIFY_POLICY)).toBe(true);
	});
});

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

	it("returns a frozen policy", () => {
		const p = verifyPolicy({ required: [] });
		expect(Object.isFrozen(p)).toBe(true);
	});
});
