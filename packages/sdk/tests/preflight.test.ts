import { describe, expect, it } from "vitest";
import { OpenGardenError, OpenGardenErrorCode } from "../src/errors";
import {
	assertAttesterMatches,
	assertRefUIDMatches,
	extractAttestationMetadata,
	FinalizeInputIssueCode,
	validateFinalizeInput,
} from "../src/preflight";
import { InterventionType } from "../src/types/enums";
import type { FinalizeInterventionInput } from "../src/types/evidence";
import { MOCK_SIGNER_ADDRESS, makeFakeTimestampedResult } from "./_helpers";

const SCHEDULE_UID = "0xsched";
const AREA_UID = "0xarea";
const ALICE = "0xAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaa";
const BOB = "0xBBBBbbbbBBBBbbbbBBBBbbbbBBBBbbbbBBBBbbbb";

function buildValidInput(): FinalizeInterventionInput {
	return {
		interventionId: "INT-001",
		areaUID: AREA_UID,
		scheduled: makeFakeTimestampedResult(SCHEDULE_UID, {
			onchainTimestamp: 100n,
			refUID: AREA_UID,
		}),
		crew: [
			{
				checkin: makeFakeTimestampedResult("0xcheckinA", {
					onchainTimestamp: 200n,
					attester: ALICE,
					refUID: SCHEDULE_UID,
				}),
				checkout: makeFakeTimestampedResult("0xcheckoutA", {
					onchainTimestamp: 300n,
					attester: ALICE,
					refUID: "0xcheckinA",
				}),
				report: makeFakeTimestampedResult("0xreportA", {
					onchainTimestamp: 400n,
					attester: ALICE,
					refUID: SCHEDULE_UID,
				}),
			},
		],
		interventionType: InterventionType.RoutineMaintenance,
		executionDate: 1_000_000n,
		commissionId: null,
	};
}

describe("extractAttestationMetadata", () => {
	it("pulls signer, refUID, time, and onchainTimestamp", () => {
		const result = makeFakeTimestampedResult("0xuid", {
			attester: "0xABC",
			refUID: "0xPARENT",
			time: 1234n,
			onchainTimestamp: 5678n,
		});
		const meta = extractAttestationMetadata(result);
		expect(meta).toEqual({
			uid: "0xuid",
			attester: "0xabc",
			refUID: "0xparent",
			claimedTime: 1234,
			onchainTimestamp: 5678,
		});
	});

	it("returns empty strings for missing fields", () => {
		const result = makeFakeTimestampedResult("0xuid");
		const meta = extractAttestationMetadata(result);
		expect(meta.refUID).toBe("");
		expect(meta.attester).toBe(MOCK_SIGNER_ADDRESS.toLowerCase());
	});
});

describe("assertAttesterMatches", () => {
	it("passes when attesters match (case-insensitive)", () => {
		const result = makeFakeTimestampedResult("0xuid", { attester: ALICE });
		expect(() =>
			assertAttesterMatches(result, ALICE.toUpperCase(), "checkin"),
		).not.toThrow();
	});

	it("throws on mismatch", () => {
		const result = makeFakeTimestampedResult("0xuid", { attester: ALICE });
		try {
			assertAttesterMatches(result, BOB, "checkin");
		} catch (e) {
			expect(e).toBeInstanceOf(OpenGardenError);
			expect((e as OpenGardenError).code).toBe(
				OpenGardenErrorCode.INVALID_INPUT,
			);
			expect((e as OpenGardenError).message).toContain("checkin");
			return;
		}
		throw new Error("expected throw");
	});
});

describe("assertRefUIDMatches", () => {
	it("passes when refUIDs match (case-insensitive)", () => {
		const result = makeFakeTimestampedResult("0xuid", {
			refUID: "0xFEED",
		});
		expect(() =>
			assertRefUIDMatches(result, "0xfeed", "checkin"),
		).not.toThrow();
	});

	it("throws when refUID is missing", () => {
		const result = makeFakeTimestampedResult("0xuid");
		expect(() => assertRefUIDMatches(result, "0xsched", "checkin")).toThrow(
			/missing refUID/,
		);
	});

	it("throws on mismatch", () => {
		const result = makeFakeTimestampedResult("0xuid", { refUID: "0xwrong" });
		expect(() => assertRefUIDMatches(result, "0xsched", "checkin")).toThrow(
			/does not match expected/,
		);
	});
});

describe("validateFinalizeInput", () => {
	it("returns no issues for a well-formed solo intervention", () => {
		expect(validateFinalizeInput(buildValidInput())).toEqual([]);
	});

	it("flags an empty crew and short-circuits further checks", () => {
		const input = buildValidInput();
		input.crew = [];
		const issues = validateFinalizeInput(input);
		expect(issues).toHaveLength(1);
		expect(issues[0].code).toBe(FinalizeInputIssueCode.EMPTY_CREW);
	});

	it("flags execution date before scheduled on-chain timestamp", () => {
		const input = buildValidInput();
		input.executionDate = 50n;
		const issues = validateFinalizeInput(input);
		expect(
			issues.some(
				(i) => i.code === FinalizeInputIssueCode.EXECUTION_DATE_BEFORE_SCHEDULE,
			),
		).toBe(true);
	});

	it("flags swapped reports between crew members (attester mismatch)", () => {
		const input = buildValidInput();
		// Add a second member, then swap Alice's report into Bob's slot
		input.crew = [
			{
				checkin: makeFakeTimestampedResult("0xcheckinA", {
					onchainTimestamp: 200n,
					attester: ALICE,
					refUID: SCHEDULE_UID,
				}),
				checkout: makeFakeTimestampedResult("0xcheckoutA", {
					onchainTimestamp: 300n,
					attester: ALICE,
					refUID: "0xcheckinA",
				}),
				report: makeFakeTimestampedResult("0xreportA", {
					onchainTimestamp: 400n,
					attester: ALICE,
					refUID: SCHEDULE_UID,
				}),
			},
			{
				checkin: makeFakeTimestampedResult("0xcheckinB", {
					onchainTimestamp: 210n,
					attester: BOB,
					refUID: SCHEDULE_UID,
				}),
				checkout: makeFakeTimestampedResult("0xcheckoutB", {
					onchainTimestamp: 310n,
					attester: BOB,
					refUID: "0xcheckinB",
				}),
				// Report was signed by Alice, not Bob — wiring mistake
				report: makeFakeTimestampedResult("0xreportA2", {
					onchainTimestamp: 410n,
					attester: ALICE,
					refUID: SCHEDULE_UID,
				}),
			},
		];
		const issues = validateFinalizeInput(input);
		const attesterIssues = issues.filter(
			(i) => i.code === FinalizeInputIssueCode.CREW_ATTESTER_MISMATCH,
		);
		expect(attesterIssues).toHaveLength(1);
		expect(attesterIssues[0].crewIndex).toBe(1);
	});

	it("flags a checkout whose refUID points at the wrong checkin", () => {
		const input = buildValidInput();
		input.crew[0].checkout = makeFakeTimestampedResult("0xcheckoutA", {
			onchainTimestamp: 300n,
			attester: ALICE,
			refUID: "0xwrongcheckin",
		});
		const issues = validateFinalizeInput(input);
		expect(
			issues.some(
				(i) => i.code === FinalizeInputIssueCode.CHECKOUT_REFUID_MISMATCH,
			),
		).toBe(true);
	});

	it("flags a report whose refUID does not point at the schedule", () => {
		const input = buildValidInput();
		input.crew[0].report = makeFakeTimestampedResult("0xreportA", {
			onchainTimestamp: 400n,
			attester: ALICE,
			refUID: "0xwrong",
		});
		const issues = validateFinalizeInput(input);
		expect(
			issues.some(
				(i) => i.code === FinalizeInputIssueCode.REPORT_REFUID_MISMATCH,
			),
		).toBe(true);
	});

	it("flags temporal order violations within a crew member", () => {
		const input = buildValidInput();
		// Report timestamp before checkout
		input.crew[0].report = makeFakeTimestampedResult("0xreportA", {
			onchainTimestamp: 250n,
			attester: ALICE,
			refUID: SCHEDULE_UID,
		});
		const issues = validateFinalizeInput(input);
		expect(
			issues.some(
				(i) =>
					i.code === FinalizeInputIssueCode.TEMPORAL_ORDER_VIOLATION &&
					i.crewIndex === 0,
			),
		).toBe(true);
	});

	it("collects multiple issues in a single pass", () => {
		const input = buildValidInput();
		input.crew[0].report = makeFakeTimestampedResult("0xreportA", {
			onchainTimestamp: 250n, // temporal violation
			attester: ALICE,
			refUID: "0xwrong", // refUID violation
		});
		const issues = validateFinalizeInput(input);
		const codes = issues.map((i) => i.code);
		expect(codes).toContain(FinalizeInputIssueCode.REPORT_REFUID_MISMATCH);
		expect(codes).toContain(FinalizeInputIssueCode.TEMPORAL_ORDER_VIOLATION);
	});
});
