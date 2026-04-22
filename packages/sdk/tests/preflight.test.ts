import { beforeAll, describe, expect, it } from "vitest";
import { OpenGardenError, OpenGardenErrorCode } from "../src/errors";
import {
	assertAttesterMatches,
	assertRefUIDMatches,
	extractAttestationMetadata,
	FinalizeInputIssueCode,
	validateFinalizeInput,
} from "../src/preflight";
import { initEncoders } from "../src/schemas/encoders";
import { InterventionType } from "../src/types/enums";
import type { FinalizeInterventionInput } from "../src/types/evidence";
import { hashInterventionScope } from "../src/utils";
import { makeFakeActivityResult, MOCK_SIGNER_ADDRESS } from "./_helpers";

beforeAll(async () => {
	await initEncoders();
});

const INTERVENTION_ID = "INT-2026-0001";
const AREA_UID =
	"0x00000000000000000000000000000000000000000000000000000000000000a1";
const ORG = "0x000000000000000000000000000000000000000000000000000000000000b055";
const ALICE = "0x000000000000000000000000000000000000a1ce";
const BOB = "0x0000000000000000000000000000000000000b0b";

function schedulePayload() {
	return {
		interventionId: INTERVENTION_ID,
		areaUID: AREA_UID,
		interventionType: 1,
		scheduledDate: 100,
		estimatedMinutes: 60,
		description: "",
		commissionRef:
			"0x0000000000000000000000000000000000000000000000000000000000000000",
		crewSize: 1,
	};
}

function buildValidInput(): FinalizeInterventionInput {
	const scope = hashInterventionScope(INTERVENTION_ID);
	return {
		interventionId: INTERVENTION_ID,
		areaUID: AREA_UID,
		schedule: makeFakeActivityResult("0xsched", "schedule", {
			onchainTimestamp: 100n,
			refUID: scope,
			attester: ORG,
			payload: schedulePayload(),
		}),
		crewActivities: [
			makeFakeActivityResult("0xciA", "checkin", {
				onchainTimestamp: 200n,
				refUID: scope,
				attester: ALICE,
				payload: { latitude: 41890000, longitude: 12492000, photoCID: "" },
			}),
			makeFakeActivityResult("0xcoA", "checkout", {
				onchainTimestamp: 300n,
				refUID: scope,
				attester: ALICE,
				payload: { actualMinutes: 60 },
			}),
			makeFakeActivityResult("0xrpA", "report", {
				onchainTimestamp: 400n,
				refUID: scope,
				attester: ALICE,
				payload: { tasksCompleted: ["PRUNE"], photosCID: "", notes: "" },
			}),
		],
		interventionType: InterventionType.RoutineMaintenance,
		executionDate: 1_000_000n,
		commissionId: null,
	};
}

// --- extractAttestationMetadata ---

describe("extractAttestationMetadata", () => {
	it("pulls signer, refUID, claimedTime, onchainTimestamp", () => {
		const result = makeFakeActivityResult("0xuid", "checkin", {
			attester: "0xABC",
			refUID: "0xPARENT",
			time: 1234n,
			onchainTimestamp: 5678n,
		});
		const meta = extractAttestationMetadata(result);
		expect(meta.uid).toBe("0xuid");
		expect(meta.attester).toBe("0xabc");
		expect(meta.refUID).toBe("0xparent");
		expect(meta.claimedTime).toBe(1234);
		expect(meta.onchainTimestamp).toBe(5678);
	});

	it("falls back to result.attester when signedAttestation.signer is absent", () => {
		const result = makeFakeActivityResult("0xuid", "checkin", {
			attester: "0xAAA",
		});
		// Strip out the injected signer so the extractor must fall back.
		(
			result.signedAttestation as { signer?: string }
		).signer = undefined;
		const meta = extractAttestationMetadata(result);
		expect(meta.attester).toBe("0xaaa");
	});

	it("returns empty refUID when message.refUID is absent", () => {
		const result = makeFakeActivityResult("0xuid", "checkin");
		const meta = extractAttestationMetadata(result);
		expect(meta.refUID).toBe("");
		expect(meta.attester).toBe(MOCK_SIGNER_ADDRESS.toLowerCase());
	});
});

// --- assertAttesterMatches ---

describe("assertAttesterMatches", () => {
	it("passes on case-insensitive match", () => {
		const result = makeFakeActivityResult("0xuid", "checkin", {
			attester: ALICE,
		});
		expect(() =>
			assertAttesterMatches(result, ALICE.toUpperCase(), "checkin"),
		).not.toThrow();
	});

	it("throws on mismatch", () => {
		const result = makeFakeActivityResult("0xuid", "checkin", {
			attester: ALICE,
		});
		try {
			assertAttesterMatches(result, BOB, "checkin");
			throw new Error("expected throw");
		} catch (e) {
			expect(e).toBeInstanceOf(OpenGardenError);
			expect((e as OpenGardenError).code).toBe(
				OpenGardenErrorCode.INVALID_INPUT,
			);
			expect((e as OpenGardenError).message).toContain("checkin");
		}
	});

	it("throws when attester is absent everywhere", () => {
		const result = makeFakeActivityResult("0xuid", "checkin", {
			attester: "",
		});
		(
			result.signedAttestation as { signer?: string }
		).signer = undefined;
		result.attester = "";
		expect(() => assertAttesterMatches(result, ALICE)).toThrow(
			/missing signer/,
		);
	});
});

// --- assertRefUIDMatches ---

describe("assertRefUIDMatches", () => {
	it("passes on case-insensitive match", () => {
		const result = makeFakeActivityResult("0xuid", "checkin", {
			refUID: "0xFeedFaceCafeBabe",
		});
		expect(() =>
			assertRefUIDMatches(result, "0xfeedfacecafebabe", "checkin"),
		).not.toThrow();
	});

	it("throws when refUID is missing", () => {
		const result = makeFakeActivityResult("0xuid", "checkin");
		expect(() =>
			assertRefUIDMatches(result, "0xsomeparent", "checkin"),
		).toThrow(/missing refUID/);
	});

	it("throws on mismatch", () => {
		const result = makeFakeActivityResult("0xuid", "checkin", {
			refUID: "0xwrong",
		});
		expect(() =>
			assertRefUIDMatches(result, "0xexpected", "checkin"),
		).toThrow(/does not match/);
	});
});

// --- validateFinalizeInput ---

describe("validateFinalizeInput", () => {
	it("returns no issues for a well-formed solo input", () => {
		expect(validateFinalizeInput(buildValidInput())).toEqual([]);
	});

	it("returns no issues for a well-formed crew input", () => {
		const input = buildValidInput();
		const scope = hashInterventionScope(INTERVENTION_ID);
		input.crewActivities = [
			...input.crewActivities,
			makeFakeActivityResult("0xciB", "checkin", {
				onchainTimestamp: 210n,
				refUID: scope,
				attester: BOB,
				payload: { latitude: 41890000, longitude: 12492000, photoCID: "" },
			}),
			makeFakeActivityResult("0xcoB", "checkout", {
				onchainTimestamp: 310n,
				refUID: scope,
				attester: BOB,
				payload: { actualMinutes: 65 },
			}),
			makeFakeActivityResult("0xrpB", "report", {
				onchainTimestamp: 410n,
				refUID: scope,
				attester: BOB,
				payload: { tasksCompleted: ["CLEAN"], photosCID: "", notes: "" },
			}),
		];
		expect(validateFinalizeInput(input)).toEqual([]);
	});

	it("flags an empty crew and short-circuits further checks", () => {
		const input = buildValidInput();
		input.crewActivities = [];
		const issues = validateFinalizeInput(input);
		expect(issues).toHaveLength(1);
		expect(issues[0].code).toBe(FinalizeInputIssueCode.EMPTY_CREW);
	});

	it("flags SCHEDULE_SCOPE_MISMATCH when schedule.type is not 'schedule' and short-circuits", () => {
		const input = buildValidInput();
		input.schedule = makeFakeActivityResult("0xnotaschedule", "checkin", {
			onchainTimestamp: 100n,
			refUID: hashInterventionScope(INTERVENTION_ID),
			attester: ORG,
			payload: { latitude: 0, longitude: 0, photoCID: "" },
		});
		const issues = validateFinalizeInput(input);
		expect(issues).toHaveLength(1);
		expect(issues[0].code).toBe(FinalizeInputIssueCode.SCHEDULE_SCOPE_MISMATCH);
		expect(issues[0].message).toMatch(/schedule/);
	});

	it("flags SCHEDULE_SCOPE_MISMATCH when schedule.refUID ≠ keccak256(interventionId)", () => {
		const input = buildValidInput();
		input.schedule = makeFakeActivityResult("0xsched", "schedule", {
			onchainTimestamp: 100n,
			refUID: "0xwrongscope",
			attester: ORG,
			payload: schedulePayload(),
		});
		const codes = validateFinalizeInput(input).map((i) => i.code);
		expect(codes).toContain(FinalizeInputIssueCode.SCHEDULE_SCOPE_MISMATCH);
	});

	it("flags EXECUTION_DATE_BEFORE_SCHEDULE", () => {
		const input = buildValidInput();
		input.executionDate = 50n;
		const codes = validateFinalizeInput(input).map((i) => i.code);
		expect(codes).toContain(
			FinalizeInputIssueCode.EXECUTION_DATE_BEFORE_SCHEDULE,
		);
	});

	it("flags SCHEDULE_AREA_MISMATCH when payload.areaUID ≠ input.areaUID", () => {
		const input = buildValidInput();
		const scope = hashInterventionScope(INTERVENTION_ID);
		const badPayload = { ...schedulePayload(), areaUID: "0xdifferentarea" };
		input.schedule = makeFakeActivityResult("0xsched", "schedule", {
			onchainTimestamp: 100n,
			refUID: scope,
			attester: ORG,
			payload: badPayload,
		});
		const codes = validateFinalizeInput(input).map((i) => i.code);
		expect(codes).toContain(FinalizeInputIssueCode.SCHEDULE_AREA_MISMATCH);
	});

	it("flags ACTIVITY_SCOPE_MISMATCH when a crew activity's refUID differs from scope hash", () => {
		const input = buildValidInput();
		input.crewActivities[0] = makeFakeActivityResult("0xciA", "checkin", {
			onchainTimestamp: 200n,
			refUID: "0xwrongscope",
			attester: ALICE,
			payload: { latitude: 41890000, longitude: 12492000, photoCID: "" },
		});
		const issues = validateFinalizeInput(input);
		const scopeIssues = issues.filter(
			(i) => i.code === FinalizeInputIssueCode.ACTIVITY_SCOPE_MISMATCH,
		);
		expect(scopeIssues.length).toBeGreaterThan(0);
	});

	it("flags ACTIVITY_SCOPE_MISMATCH when a healthcheck leaks into crewActivities", () => {
		const input = buildValidInput();
		const scope = hashInterventionScope(INTERVENTION_ID);
		input.crewActivities = [
			...input.crewActivities,
			makeFakeActivityResult("0xhc", "healthcheck", {
				onchainTimestamp: 500n,
				refUID: scope,
				attester: ALICE,
				payload: { healthScore: 8, photoCID: "", notes: "" },
			}),
		];
		const codes = validateFinalizeInput(input).map((i) => i.code);
		expect(codes).toContain(FinalizeInputIssueCode.ACTIVITY_SCOPE_MISMATCH);
	});

	it("flags CREW_CHAIN_INCOMPLETE when a signer is missing a report", () => {
		const input = buildValidInput();
		// Drop the report activity
		input.crewActivities = input.crewActivities.filter(
			(a) => a.type !== "report",
		);
		const codes = validateFinalizeInput(input).map((i) => i.code);
		expect(codes).toContain(FinalizeInputIssueCode.CREW_CHAIN_INCOMPLETE);
	});

	it("flags CREW_CHAIN_INCOMPLETE when a signer is missing a checkout", () => {
		const input = buildValidInput();
		input.crewActivities = input.crewActivities.filter(
			(a) => a.type !== "checkout",
		);
		const codes = validateFinalizeInput(input).map((i) => i.code);
		expect(codes).toContain(FinalizeInputIssueCode.CREW_CHAIN_INCOMPLETE);
	});

	it("flags TEMPORAL_ORDER_VIOLATION when schedule timestamp ≥ earliest checkin", () => {
		const input = buildValidInput();
		input.schedule = makeFakeActivityResult("0xsched", "schedule", {
			onchainTimestamp: 500n, // after all crew timestamps
			refUID: hashInterventionScope(INTERVENTION_ID),
			attester: ORG,
			payload: schedulePayload(),
		});
		const codes = validateFinalizeInput(input).map((i) => i.code);
		expect(codes).toContain(FinalizeInputIssueCode.TEMPORAL_ORDER_VIOLATION);
	});

	it("flags TEMPORAL_ORDER_VIOLATION when a signer's checkin/checkout/report is out of order", () => {
		const input = buildValidInput();
		const scope = hashInterventionScope(INTERVENTION_ID);
		// Report earlier than checkout
		input.crewActivities = input.crewActivities.map((a) =>
			a.type === "report"
				? makeFakeActivityResult("0xrpA", "report", {
						onchainTimestamp: 250n, // before checkout (300)
						refUID: scope,
						attester: ALICE,
						payload: {
							tasksCompleted: ["PRUNE"],
							photosCID: "",
							notes: "",
						},
					})
				: a,
		);
		const issues = validateFinalizeInput(input);
		expect(
			issues.some(
				(i) => i.code === FinalizeInputIssueCode.TEMPORAL_ORDER_VIOLATION,
			),
		).toBe(true);
	});

	it("flags PAYLOAD_HASH_MISMATCH when a crew payload is mutated after signing", () => {
		const input = buildValidInput();
		// Mutate the checkout payload — the committed payloadHash no longer matches.
		const checkout = input.crewActivities.find((a) => a.type === "checkout");
		if (checkout) {
			(checkout.payload as { actualMinutes: number }).actualMinutes = 9999;
		}
		const codes = validateFinalizeInput(input).map((i) => i.code);
		expect(codes).toContain(FinalizeInputIssueCode.PAYLOAD_HASH_MISMATCH);
	});

	it("flags PAYLOAD_HASH_MISMATCH when the schedule payload is mutated after signing", () => {
		const input = buildValidInput();
		// Mutate the schedule payload
		(input.schedule.payload as { description: string }).description =
			"mutated after signing";
		const codes = validateFinalizeInput(input).map((i) => i.code);
		expect(codes).toContain(FinalizeInputIssueCode.PAYLOAD_HASH_MISMATCH);
	});

	it("collects multiple issues in a single pass", () => {
		const input = buildValidInput();
		input.executionDate = 50n; // EXECUTION_DATE_BEFORE_SCHEDULE
		const scope = hashInterventionScope(INTERVENTION_ID);
		// Replace checkin with wrong-scope and mutated payload
		input.crewActivities[0] = makeFakeActivityResult("0xciA", "checkin", {
			onchainTimestamp: 200n,
			refUID: "0xwrongscope",
			attester: ALICE,
			payload: { latitude: 41890000, longitude: 12492000, photoCID: "" },
		});
		// Mutate report payload to trigger PAYLOAD_HASH_MISMATCH
		const report = input.crewActivities.find((a) => a.type === "report");
		if (report) {
			(report.payload as { notes: string }).notes = "mutated";
		}
		const codes = validateFinalizeInput(input).map((i) => i.code);
		expect(codes).toContain(FinalizeInputIssueCode.EXECUTION_DATE_BEFORE_SCHEDULE);
		expect(codes).toContain(FinalizeInputIssueCode.ACTIVITY_SCOPE_MISMATCH);
		expect(codes).toContain(FinalizeInputIssueCode.PAYLOAD_HASH_MISMATCH);
		// Proves the validator does NOT short-circuit on first failure for these
		// codes — all three surface in one call, letting UIs render a checklist.
		// Scope variable used above
		expect(scope).toBeTruthy();
	});
});
