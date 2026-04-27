import { describe, expect, it } from "vitest";
import { EVIDENCE_BUNDLE_VERSION } from "../src/constants";
import { OpenGardenError, OpenGardenErrorCode } from "../src/errors";
import {
	buildEvidenceBundle,
	bundleJsonReplacer,
	restoreBundleBigInts,
} from "../src/evidence";
import type { EvidenceBundleBuilderInput } from "../src/types/evidence";
import { makeFakeActivityResult } from "./_helpers";

const ALICE = "0x000000000000000000000000000000000000a1ce";
const BOB = "0x0000000000000000000000000000000000000b0b";

function soloInput(): EvidenceBundleBuilderInput {
	return {
		interventionId: "INT-2026-0001",
		areaUID: "0xarea123",
		schedule: makeFakeActivityResult("0xsched", "schedule", {
			time: 1000n,
			onchainTimestamp: 1015n,
			payload: {
				interventionId: "INT-2026-0001",
				areaUID: "0xarea123",
				crewSize: 1,
				interventionType: 1,
				scheduledDate: 1000,
				estimatedMinutes: 60,
				description: "",
				commissionRef:
					"0x0000000000000000000000000000000000000000000000000000000000000000",
			},
		}),
		crewActivities: [
			makeFakeActivityResult("0xcheckin", "checkin", {
				time: 2000n,
				onchainTimestamp: 2018n,
				attester: ALICE,
				payload: { latitude: 41890000, longitude: 12492000, photoCID: "" },
			}),
			makeFakeActivityResult("0xcheckout", "checkout", {
				time: 3000n,
				onchainTimestamp: 3012n,
				attester: ALICE,
				payload: { actualMinutes: 45 },
			}),
			makeFakeActivityResult("0xreport", "report", {
				time: 3100n,
				onchainTimestamp: 3120n,
				attester: ALICE,
				payload: { tasksCompleted: ["PRUNE"], photosCID: "", notes: "" },
			}),
		],
	};
}

describe("buildEvidenceBundle", () => {
	it("sets bundleVersion to the current constant", () => {
		const bundle = buildEvidenceBundle(soloInput());
		expect(bundle.bundleVersion).toBe(EVIDENCE_BUNDLE_VERSION);
	});

	it("preserves interventionId and areaUID", () => {
		const bundle = buildEvidenceBundle(soloInput());
		expect(bundle.interventionId).toBe("INT-2026-0001");
		expect(bundle.areaUID).toBe("0xarea123");
	});

	it("flattens schedule + crew into a single activities array", () => {
		const bundle = buildEvidenceBundle(soloInput());
		expect(bundle.activities).toHaveLength(4);
		const types = bundle.activities.map((a) => a.type);
		expect(types).toContain("schedule");
		expect(types).toContain("checkin");
		expect(types).toContain("checkout");
		expect(types).toContain("report");
	});

	it("sorts activities ascending by onchainTimestamp", () => {
		// Feed crew activities out of order — builder MUST sort.
		const input = soloInput();
		input.crewActivities = [
			input.crewActivities[2], // report (3120)
			input.crewActivities[0], // checkin (2018)
			input.crewActivities[1], // checkout (3012)
		];
		const bundle = buildEvidenceBundle(input);
		const timestamps = bundle.activities.map((a) => a.onchainTimestamp);
		expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
	});

	it("converts onchainTimestamp from bigint to number", () => {
		const bundle = buildEvidenceBundle(soloInput());
		for (const a of bundle.activities) {
			expect(typeof a.onchainTimestamp).toBe("number");
		}
	});

	it("carries signer through from result.attester", () => {
		const bundle = buildEvidenceBundle(soloInput());
		const checkin = bundle.activities.find((a) => a.type === "checkin");
		expect(checkin?.signer).toBe(ALICE);
	});

	it("supports crew jobs with multiple signers", () => {
		const input = soloInput();
		input.crewActivities = [
			...input.crewActivities,
			makeFakeActivityResult("0xciB", "checkin", {
				time: 2100n,
				onchainTimestamp: 2118n,
				attester: BOB,
				payload: { latitude: 41890000, longitude: 12492000, photoCID: "" },
			}),
			makeFakeActivityResult("0xcoB", "checkout", {
				time: 3200n,
				onchainTimestamp: 3212n,
				attester: BOB,
				payload: { actualMinutes: 50 },
			}),
			makeFakeActivityResult("0xrpB", "report", {
				time: 3300n,
				onchainTimestamp: 3320n,
				attester: BOB,
				payload: { tasksCompleted: ["CLEAN"], photosCID: "", notes: "" },
			}),
		];
		const bundle = buildEvidenceBundle(input);
		expect(bundle.activities).toHaveLength(7);
		const checkinSigners = bundle.activities
			.filter((a) => a.type === "checkin")
			.map((a) => a.signer);
		expect(checkinSigners).toEqual(expect.arrayContaining([ALICE, BOB]));
	});

	it("throws when schedule result has wrong type", () => {
		const input = soloInput();
		input.schedule = makeFakeActivityResult("0xbadsched", "checkin", {
			time: 1000n,
			onchainTimestamp: 1015n,
		});
		expect(() => buildEvidenceBundle(input)).toThrow(OpenGardenError);
		try {
			buildEvidenceBundle(input);
		} catch (e) {
			expect((e as OpenGardenError).code).toBe(
				OpenGardenErrorCode.INVALID_INPUT,
			);
			expect((e as Error).message).toMatch(/schedule/i);
		}
	});

	it("rejects healthcheck activities in crewActivities", () => {
		const input = soloInput();
		input.crewActivities = [
			...input.crewActivities,
			makeFakeActivityResult("0xhc", "healthcheck", {
				time: 3400n,
				onchainTimestamp: 3410n,
				payload: { healthScore: 8, photoCID: "", notes: "" },
			}),
		];
		expect(() => buildEvidenceBundle(input)).toThrow(/healthcheck/i);
	});

	it("rejects unspecified activities in crewActivities", () => {
		const input = soloInput();
		input.crewActivities = [
			...input.crewActivities,
			makeFakeActivityResult("0xunk", "unspecified", {
				time: 3400n,
				onchainTimestamp: 3410n,
			}),
		];
		expect(() => buildEvidenceBundle(input)).toThrow(/unspecified/i);
	});

	it("preserves plaintext payload per activity", () => {
		const bundle = buildEvidenceBundle(soloInput());
		const checkout = bundle.activities.find((a) => a.type === "checkout");
		expect(checkout?.payload).toEqual({ actualMinutes: 45 });
	});

	it("embeds the signed attestation verbatim", () => {
		const bundle = buildEvidenceBundle(soloInput());
		const schedule = bundle.activities.find((a) => a.type === "schedule");
		expect(schedule?.signedAttestation).toBeDefined();
		expect(
			(schedule?.signedAttestation as { uid?: string }).uid,
		).toBe("0xsched");
	});
});

describe("bundleJsonReplacer", () => {
	it("serializes bigint as decimal string", () => {
		const result = JSON.stringify({ t: 1234567890n }, bundleJsonReplacer);
		expect(result).toBe(`{"t":"1234567890"}`);
	});

	it("passes non-bigint values through unchanged", () => {
		const result = JSON.stringify(
			{ s: "hello", n: 42, b: true, a: [1, 2] },
			bundleJsonReplacer,
		);
		expect(result).toBe(`{"s":"hello","n":42,"b":true,"a":[1,2]}`);
	});

	it("round-trips a full bundle envelope", () => {
		const bundle = buildEvidenceBundle(soloInput());
		const json = JSON.stringify(bundle, bundleJsonReplacer);
		const parsed = JSON.parse(json);
		expect(parsed.interventionId).toBe("INT-2026-0001");
		expect(parsed.activities).toHaveLength(4);
	});
});

describe("restoreBundleBigInts", () => {
	it("restores time and expirationTime from decimal strings to bigints", () => {
		const bundle = buildEvidenceBundle(soloInput());
		const json = JSON.stringify(bundle, bundleJsonReplacer);
		const parsed = JSON.parse(json);
		restoreBundleBigInts(parsed);
		for (const entry of parsed.activities) {
			const msg = entry.signedAttestation.message;
			if (msg && msg.time !== undefined) {
				expect(typeof msg.time).toBe("bigint");
			}
		}
	});

	it("is idempotent — already-bigint fields are left alone", () => {
		const bundle = buildEvidenceBundle(soloInput());
		const before = bundle.activities[0].signedAttestation;
		restoreBundleBigInts(bundle);
		const after = bundle.activities[0].signedAttestation;
		expect(after).toBe(before);
	});

	it("skips non-numeric string values", () => {
		const bundle = buildEvidenceBundle(soloInput());
		// Corrupt the field
		const first = bundle.activities[0].signedAttestation as {
			message: Record<string, unknown>;
		};
		first.message.time = "not-a-number";
		restoreBundleBigInts(bundle);
		expect(first.message.time).toBe("not-a-number");
	});
});
