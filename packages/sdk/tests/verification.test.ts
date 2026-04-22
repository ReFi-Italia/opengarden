import { beforeAll, describe, expect, it } from "vitest";
import { EVIDENCE_BUNDLE_VERSION } from "../src/constants";
import { encodeActivityData, initEncoders } from "../src/schemas/encoders";
import { ActivityType, activityTypeFromName } from "../src/types/enums";
import type {
	BundleActivity,
	EvidenceBundle,
} from "../src/types/evidence";
import { hashActivityPayload, hashInterventionScope } from "../src/utils";
import {
	VerificationCheckCode,
	verifyBundleCrewConsistency,
	verifyBundleCrewDistinctness,
	verifyBundleCrewSize,
	verifyBundleExecutionDateBracket,
	verifyBundleInterventionScope,
	verifyBundleOnChainTimestamps,
	verifyBundlePayloadIntegrity,
	verifyBundleScheduleUniqueness,
	verifyBundleSignatures,
	verifyBundleTemporalOrder,
	verifyBundleVersion,
} from "../src/verification";

beforeAll(async () => {
	await initEncoders();
});

const INTERVENTION_ID = "INT-2026-0001";
const AREA_UID =
	"0x00000000000000000000000000000000000000000000000000000000000000a1";
const ORG = "0x000000000000000000000000000000000000000000000000000000000000b055";
const ALICE = "0x000000000000000000000000000000000000a1ce";
const BOB = "0x0000000000000000000000000000000000000b0b";
const CAROL = "0x00000000000000000000000000000000000ca01";

function makeSignedAttestation(opts: {
	uid: string;
	signer: string;
	refUID: string;
	time: number;
	data: string;
}) {
	return {
		version: 1,
		uid: opts.uid,
		signer: opts.signer,
		message: {
			schema: "0xschema",
			recipient: "0x0000000000000000000000000000000000000000",
			time: opts.time,
			expirationTime: 0,
			revocable: true,
			refUID: opts.refUID,
			data: opts.data,
		},
		signature: { r: "0x", s: "0x", v: 0 },
	};
}

function makeActivity(opts: {
	uid: string;
	type: BundleActivity["type"];
	signer: string;
	onchainTimestamp: number;
	payload: Record<string, unknown>;
	refUID?: string;
}): BundleActivity {
	const payloadHash = hashActivityPayload(opts.payload);
	const data = encodeActivityData(
		activityTypeFromName(opts.type),
		payloadHash,
	);
	const refUID = opts.refUID ?? hashInterventionScope(INTERVENTION_ID);
	return {
		type: opts.type,
		uid: opts.uid,
		signer: opts.signer,
		claimedTimestamp: opts.onchainTimestamp,
		onchainTimestamp: opts.onchainTimestamp,
		signedAttestation: makeSignedAttestation({
			uid: opts.uid,
			signer: opts.signer,
			refUID,
			time: opts.onchainTimestamp,
			data,
		}),
		payload: opts.payload as never,
	} as BundleActivity;
}

function schedulePayload(crewSize = 1) {
	return {
		interventionId: INTERVENTION_ID,
		areaUID: AREA_UID,
		interventionType: 1,
		scheduledDate: 100,
		estimatedMinutes: 60,
		description: "",
		commissionRef:
			"0x0000000000000000000000000000000000000000000000000000000000000000",
		crewSize,
	};
}

function makeBundle(
	overrides: {
		crewSigners?: string[];
		scheduledTs?: number;
		baseTs?: number;
		bundleVersion?: string;
		crewSize?: number;
		omitCheckoutFor?: string;
		omitReportFor?: string;
		duplicateReportFor?: string;
	} = {},
): EvidenceBundle {
	const crewSigners = overrides.crewSigners ?? [ALICE];
	const baseTs = overrides.baseTs ?? 200;
	const scheduledTs = overrides.scheduledTs ?? 100;
	const crewSize = overrides.crewSize ?? crewSigners.length;

	const activities: BundleActivity[] = [
		makeActivity({
			uid: "0xsched",
			type: "schedule",
			signer: ORG,
			onchainTimestamp: scheduledTs,
			payload: schedulePayload(crewSize),
		}),
	];

	crewSigners.forEach((signer, i) => {
		const ciTs = baseTs + i * 10;
		const coTs = ciTs + 100;
		const rpTs = coTs + 10;
		activities.push(
			makeActivity({
				uid: `0xci_${i}`,
				type: "checkin",
				signer,
				onchainTimestamp: ciTs,
				payload: { latitude: 41890000, longitude: 12492000, photoCID: "" },
			}),
		);
		if (overrides.omitCheckoutFor !== signer) {
			activities.push(
				makeActivity({
					uid: `0xco_${i}`,
					type: "checkout",
					signer,
					onchainTimestamp: coTs,
					payload: { actualMinutes: 60 },
				}),
			);
		}
		if (overrides.omitReportFor !== signer) {
			activities.push(
				makeActivity({
					uid: `0xrp_${i}`,
					type: "report",
					signer,
					onchainTimestamp: rpTs,
					payload: { tasksCompleted: ["PRUNE"], photosCID: "", notes: "" },
				}),
			);
		}
		if (overrides.duplicateReportFor === signer) {
			activities.push(
				makeActivity({
					uid: `0xrp_${i}_dup`,
					type: "report",
					signer,
					onchainTimestamp: rpTs + 1,
					payload: { tasksCompleted: ["CLEAN"], photosCID: "", notes: "dup" },
				}),
			);
		}
	});

	activities.sort((a, b) => a.onchainTimestamp - b.onchainTimestamp);

	return {
		interventionId: INTERVENTION_ID,
		areaUID: AREA_UID,
		activities,
		bundleVersion: (overrides.bundleVersion ??
			EVIDENCE_BUNDLE_VERSION) as typeof EVIDENCE_BUNDLE_VERSION,
	};
}

// --- Protocol tier ---

describe("verifyBundleVersion", () => {
	it("passes for current version", () => {
		const result = verifyBundleVersion(makeBundle());
		expect(result).toEqual({
			code: VerificationCheckCode.BUNDLE_VERSION,
			valid: true,
		});
	});

	it("fails for unknown version", () => {
		const result = verifyBundleVersion(makeBundle({ bundleVersion: "99.9.9" }));
		expect(result.valid).toBe(false);
		expect(result.message).toContain("99.9.9");
	});
});

describe("verifyBundleOnChainTimestamps", () => {
	it("passes when every fetcher result matches the bundle", async () => {
		const bundle = makeBundle({ crewSigners: [ALICE] });
		const fetcher = async (uid: string) => {
			const match = bundle.activities.find((a) => a.uid === uid);
			return match ? BigInt(match.onchainTimestamp) : null;
		};
		const result = await verifyBundleOnChainTimestamps(bundle, fetcher);
		expect(result).toEqual({
			code: VerificationCheckCode.ON_CHAIN_TIMESTAMPS,
			valid: true,
		});
	});

	it("fails when a fetched timestamp mismatches", async () => {
		const bundle = makeBundle({ crewSigners: [ALICE] });
		const target = bundle.activities[1].uid;
		const fetcher = async (uid: string) => (uid === target ? 999n : 100n);
		const result = await verifyBundleOnChainTimestamps(bundle, fetcher);
		expect(result.valid).toBe(false);
		expect(result.message).toContain(target);
	});

	it("fails gracefully when a fetcher throws", async () => {
		const bundle = makeBundle({ crewSigners: [ALICE] });
		const fetcher = async () => {
			throw new Error("network down");
		};
		const result = await verifyBundleOnChainTimestamps(bundle, fetcher);
		expect(result.valid).toBe(false);
	});
});

describe("verifyBundleSignatures", () => {
	function mockEas(opts: {
		verifyReturns?: boolean;
		throws?: boolean;
	} = {}): import("@ethereum-attestation-service/eas-sdk").EAS {
		return {
			getOffchain: async () => ({
				verifyOffchainAttestationSignature: () => {
					if (opts.throws) throw new Error("verify threw");
					return opts.verifyReturns ?? true;
				},
			}),
			// biome-ignore lint/suspicious/noExplicitAny: mock cast
		} as any;
	}

	it("passes when every signature verifies and signers match", async () => {
		const bundle = makeBundle({ crewSigners: [ALICE] });
		const result = await verifyBundleSignatures(bundle, mockEas());
		expect(result.valid).toBe(true);
	});

	it("fails when signedAttestation.signer is missing", async () => {
		const bundle = makeBundle({ crewSigners: [ALICE] });
		(
			bundle.activities[0].signedAttestation as { signer?: string }
		).signer = undefined;
		const result = await verifyBundleSignatures(bundle, mockEas());
		expect(result.valid).toBe(false);
		expect(result.message).toContain("no signedAttestation.signer");
	});

	it("fails when signature verify returns false", async () => {
		const bundle = makeBundle({ crewSigners: [ALICE] });
		const result = await verifyBundleSignatures(
			bundle,
			mockEas({ verifyReturns: false }),
		);
		expect(result.valid).toBe(false);
		expect(result.message).toContain("did not recover");
	});

	it("fails when signature verify throws", async () => {
		const bundle = makeBundle({ crewSigners: [ALICE] });
		const result = await verifyBundleSignatures(
			bundle,
			mockEas({ throws: true }),
		);
		expect(result.valid).toBe(false);
		expect(result.message).toContain("threw");
	});

	it("fails when bundle-level signer mismatches embedded signer", async () => {
		const bundle = makeBundle({ crewSigners: [ALICE] });
		bundle.activities[0].signer = "0xDifferent";
		const result = await verifyBundleSignatures(bundle, mockEas());
		expect(result.valid).toBe(false);
		expect(result.message).toContain("does not match embedded signer");
	});
});

describe("verifyBundlePayloadIntegrity", () => {
	it("passes when every payload hashes to its committed payloadHash", () => {
		const result = verifyBundlePayloadIntegrity(makeBundle({ crewSigners: [ALICE] }));
		expect(result).toEqual({
			code: VerificationCheckCode.PAYLOAD_INTEGRITY,
			valid: true,
		});
	});

	it("fails when a payload has been mutated after signing", () => {
		const bundle = makeBundle({ crewSigners: [ALICE] });
		const checkout = bundle.activities.find((a) => a.type === "checkout");
		if (checkout) {
			(checkout.payload as unknown as { actualMinutes: number }).actualMinutes =
				9999;
		}
		const result = verifyBundlePayloadIntegrity(bundle);
		expect(result.valid).toBe(false);
		expect(result.message).toContain("payloadHash mismatch");
	});

	it("fails when activityType in data disagrees with entry type", () => {
		const bundle = makeBundle({ crewSigners: [ALICE] });
		// Re-encode schedule entry's data as if it were a checkin.
		const scheduleEntry = bundle.activities.find((a) => a.type === "schedule");
		if (scheduleEntry) {
			const payloadHash = hashActivityPayload(
				scheduleEntry.payload as unknown as Record<string, unknown>,
			);
			const wrongData = encodeActivityData(ActivityType.Checkin, payloadHash);
			(
				scheduleEntry.signedAttestation as {
					message: Record<string, unknown>;
				}
			).message.data = wrongData;
		}
		const result = verifyBundlePayloadIntegrity(bundle);
		expect(result.valid).toBe(false);
		expect(result.message).toContain("type mismatch");
	});

	it("fails when the signed data field is missing", () => {
		const bundle = makeBundle({ crewSigners: [ALICE] });
		const entry = bundle.activities[0];
		(entry.signedAttestation as { message: Record<string, unknown> }).message
			.data = undefined;
		const result = verifyBundlePayloadIntegrity(bundle);
		expect(result.valid).toBe(false);
		expect(result.message).toContain("data missing");
	});
});

// --- Policy tier ---

describe("verifyBundleInterventionScope", () => {
	it("passes when every entry's refUID equals keccak256(interventionId)", () => {
		const result = verifyBundleInterventionScope(
			makeBundle({ crewSigners: [ALICE, BOB] }),
			{ interventionId: INTERVENTION_ID },
		);
		expect(result.valid).toBe(true);
	});

	it("fails when an entry's refUID does not match the scope hash", () => {
		const bundle = makeBundle({ crewSigners: [ALICE] });
		const checkin = bundle.activities.find((a) => a.type === "checkin");
		if (checkin) {
			(
				checkin.signedAttestation as { message: Record<string, unknown> }
			).message.refUID = "0xwrong";
		}
		const result = verifyBundleInterventionScope(bundle, {
			interventionId: INTERVENTION_ID,
		});
		expect(result.valid).toBe(false);
	});

	it("compares refUIDs case-insensitively", () => {
		const bundle = makeBundle({ crewSigners: [ALICE] });
		const expectedScope = hashInterventionScope(INTERVENTION_ID);
		const checkin = bundle.activities.find((a) => a.type === "checkin");
		if (checkin) {
			(
				checkin.signedAttestation as { message: Record<string, unknown> }
			).message.refUID = expectedScope.toUpperCase();
		}
		const result = verifyBundleInterventionScope(bundle, {
			interventionId: INTERVENTION_ID,
		});
		expect(result.valid).toBe(true);
	});
});

describe("verifyBundleScheduleUniqueness", () => {
	it("passes with exactly one schedule activity", () => {
		const result = verifyBundleScheduleUniqueness(makeBundle());
		expect(result.valid).toBe(true);
	});

	it("fails with zero schedule activities", () => {
		const bundle = makeBundle();
		bundle.activities = bundle.activities.filter((a) => a.type !== "schedule");
		const result = verifyBundleScheduleUniqueness(bundle);
		expect(result.valid).toBe(false);
		expect(result.message).toContain("0");
	});

	it("fails with two schedule activities", () => {
		const bundle = makeBundle();
		const dup = makeActivity({
			uid: "0xsched2",
			type: "schedule",
			signer: ORG,
			onchainTimestamp: 105,
			payload: schedulePayload(1),
		});
		bundle.activities.push(dup);
		const result = verifyBundleScheduleUniqueness(bundle);
		expect(result.valid).toBe(false);
		expect(result.message).toContain("2");
	});
});

describe("verifyBundleTemporalOrder", () => {
	it("passes for a valid solo bundle", () => {
		expect(
			verifyBundleTemporalOrder(makeBundle({ crewSigners: [ALICE] })).valid,
		).toBe(true);
	});

	it("passes for a multi-crew bundle", () => {
		expect(
			verifyBundleTemporalOrder(
				makeBundle({ crewSigners: [ALICE, BOB, CAROL] }),
			).valid,
		).toBe(true);
	});

	it("fails when schedule timestamp is not strictly before earliest checkin", () => {
		const bundle = makeBundle({ crewSigners: [ALICE], scheduledTs: 500 });
		const result = verifyBundleTemporalOrder(bundle);
		expect(result.valid).toBe(false);
		expect(result.message).toContain("must precede");
	});

	it("fails when a signer's chain has out-of-order timestamps", () => {
		const bundle = makeBundle({ crewSigners: [ALICE] });
		// Bump report to before checkout.
		const report = bundle.activities.find(
			(a) => a.type === "report" && a.signer === ALICE,
		);
		if (report) report.onchainTimestamp = 150; // before checkout (~300)
		const result = verifyBundleTemporalOrder(bundle);
		expect(result.valid).toBe(false);
	});

	it("fails when a signer is missing one of checkin/checkout/report", () => {
		const bundle = makeBundle({
			crewSigners: [ALICE],
			omitReportFor: ALICE,
		});
		const result = verifyBundleTemporalOrder(bundle);
		expect(result.valid).toBe(false);
		expect(result.message).toMatch(/report/i);
	});

	it("fails when bundle has no crew activities", () => {
		const bundle = makeBundle({ crewSigners: [] });
		const result = verifyBundleTemporalOrder(bundle);
		expect(result.valid).toBe(false);
		expect(result.message).toContain("no crew");
	});

	it("passes when the schedule signer also participates as a crew member", () => {
		// §5.4 edge case: small-org scenario where the organization wallet
		// signs the schedule AND acts as a crew member.
		const bundle = makeBundle({ crewSigners: [ORG] });
		const result = verifyBundleTemporalOrder(bundle);
		expect(result.valid).toBe(true);
	});
});

describe("verifyBundleExecutionDateBracket", () => {
	it("passes when executionDate sits between schedule and publication", () => {
		const bundle = makeBundle({ scheduledTs: 100 });
		const result = verifyBundleExecutionDateBracket(bundle, {
			executionDate: 400n,
			time: 1000n,
		});
		expect(result.valid).toBe(true);
	});

	it("fails when executionDate predates schedule", () => {
		const bundle = makeBundle({ scheduledTs: 500 });
		const result = verifyBundleExecutionDateBracket(bundle, {
			executionDate: 100n,
			time: 1000n,
		});
		expect(result.valid).toBe(false);
	});

	it("fails when executionDate postdates publication", () => {
		const bundle = makeBundle({ scheduledTs: 100 });
		const result = verifyBundleExecutionDateBracket(bundle, {
			executionDate: 2000n,
			time: 1000n,
		});
		expect(result.valid).toBe(false);
	});

	it("fails when bundle has no schedule activity", () => {
		const bundle = makeBundle();
		bundle.activities = bundle.activities.filter((a) => a.type !== "schedule");
		const result = verifyBundleExecutionDateBracket(bundle, {
			executionDate: 200n,
			time: 500n,
		});
		expect(result.valid).toBe(false);
	});
});

describe("verifyBundleCrewSize", () => {
	it("passes when checkin count equals schedule.payload.crewSize", () => {
		const bundle = makeBundle({
			crewSigners: [ALICE, BOB],
			crewSize: 2,
		});
		const result = verifyBundleCrewSize(bundle);
		expect(result.valid).toBe(true);
	});

	it("fails when checkin count < crewSize", () => {
		const bundle = makeBundle({
			crewSigners: [ALICE],
			crewSize: 3,
		});
		const result = verifyBundleCrewSize(bundle);
		expect(result.valid).toBe(false);
		expect(result.message).toContain("3");
	});

	it("fails when checkin count > crewSize", () => {
		const bundle = makeBundle({
			crewSigners: [ALICE, BOB, CAROL],
			crewSize: 1,
		});
		const result = verifyBundleCrewSize(bundle);
		expect(result.valid).toBe(false);
		expect(result.message).toContain("1");
	});

	it("fails when bundle has no schedule activity", () => {
		const bundle = makeBundle();
		bundle.activities = bundle.activities.filter((a) => a.type !== "schedule");
		const result = verifyBundleCrewSize(bundle);
		expect(result.valid).toBe(false);
	});
});

describe("verifyBundleCrewConsistency", () => {
	it("passes when every signer has exactly one checkin+checkout+report", () => {
		const bundle = makeBundle({ crewSigners: [ALICE, BOB] });
		const result = verifyBundleCrewConsistency(bundle);
		expect(result.valid).toBe(true);
	});

	it("fails when a signer is missing checkout", () => {
		const bundle = makeBundle({
			crewSigners: [ALICE, BOB],
			omitCheckoutFor: BOB,
		});
		const result = verifyBundleCrewConsistency(bundle);
		expect(result.valid).toBe(false);
		expect(result.message).toMatch(/checkout/);
	});

	it("fails when a signer has duplicate activity of same type", () => {
		const bundle = makeBundle({
			crewSigners: [ALICE],
			duplicateReportFor: ALICE,
		});
		const result = verifyBundleCrewConsistency(bundle);
		expect(result.valid).toBe(false);
		expect(result.message).toMatch(/duplicate/i);
	});

	it("compares signers case-insensitively for grouping", () => {
		const bundle = makeBundle({ crewSigners: [ALICE] });
		// Re-case a checkout's signer to uppercase — should still group with checkin/report.
		const checkout = bundle.activities.find(
			(a) => a.type === "checkout" && a.signer === ALICE,
		);
		if (checkout) checkout.signer = ALICE.toUpperCase();
		const result = verifyBundleCrewConsistency(bundle);
		expect(result.valid).toBe(true);
	});

	it("passes when the schedule signer also has their own crew triple", () => {
		const bundle = makeBundle({ crewSigners: [ORG] });
		const result = verifyBundleCrewConsistency(bundle);
		expect(result.valid).toBe(true);
	});

	it("fails when bundle has no crew activities", () => {
		const bundle = makeBundle({ crewSigners: [] });
		const result = verifyBundleCrewConsistency(bundle);
		expect(result.valid).toBe(false);
	});
});

describe("verifyBundleCrewDistinctness", () => {
	it("passes when every crew signer is distinct", () => {
		const bundle = makeBundle({ crewSigners: [ALICE, BOB, CAROL] });
		const result = verifyBundleCrewDistinctness(bundle);
		expect(result.valid).toBe(true);
	});

	it("passes trivially for a solo bundle", () => {
		const bundle = makeBundle({ crewSigners: [ALICE] });
		const result = verifyBundleCrewDistinctness(bundle);
		expect(result.valid).toBe(true);
	});

	it("passes when the only duplication is within one signer's chain (Map keys are distinct)", () => {
		// The crew-distinctness helper keys by lowercased signer address — a
		// single crew signer's checkin/checkout/report all collapse to one key,
		// so there's no "duplicate" to report. Duplicate chains across signers
		// are what the helper guards against.
		const bundle = makeBundle({ crewSigners: [ALICE] });
		const result = verifyBundleCrewDistinctness(bundle);
		expect(result.valid).toBe(true);
	});
});
