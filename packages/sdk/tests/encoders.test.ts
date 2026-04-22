import { SchemaEncoder } from "@ethereum-attestation-service/eas-sdk";
import { beforeAll, describe, expect, it } from "vitest";
import { ZERO_BYTES32 } from "../src/constants";
import { SCHEMA_STRINGS } from "../src/schemas/definitions";
import {
	buildCheckinPayload,
	buildCheckoutPayload,
	buildHealthcheckPayload,
	buildReportPayload,
	buildSchedulePayload,
	decodeActivityData,
	decodeAreaRegistration,
	decodeGardenerMilestone,
	decodeIntervention,
	encodeActivityData,
	encodeActivityFromPayload,
	encodeAreaRegistration,
	encodeGardenerMilestone,
	encodeIntervention,
	initEncoders,
} from "../src/schemas/encoders";
import {
	ActivityType,
	AreaType,
	InterventionType,
} from "../src/types/enums";
import { hashActivityPayload, hashIdentifier } from "../src/utils";
import { MOCK_SIGNER_ADDRESS } from "./_helpers";

beforeAll(async () => {
	await initEncoders();
});

// --- AreaRegistration ---

describe("AreaRegistration encoder", () => {
	const input = {
		areaId: "RM-PIGN-042",
		latitude: 41.89,
		longitude: 12.4964,
		areaType: AreaType.PublicGreenSpace,
		name: "Giardino Via Appia 12",
		municipality: "RM-I",
		boundariesHash: null,
		metadata: "",
	};

	it("encodes and decodes roundtrip", () => {
		const encoded = encodeAreaRegistration(input);
		expect(encoded.startsWith("0x")).toBe(true);

		const decoded = decodeAreaRegistration(encoded);
		expect(decoded.areaId).toBe("RM-PIGN-042");
		expect(decoded.latitude).toBeCloseTo(41.89, 4);
		expect(decoded.longitude).toBeCloseTo(12.4964, 4);
		expect(decoded.areaType).toBe(AreaType.PublicGreenSpace);
		expect(decoded.name).toBe("Giardino Via Appia 12");
		expect(decoded.municipality).toBe("RM-I");
		expect(decoded.boundariesHash).toBe(ZERO_BYTES32);
		expect(decoded.metadata).toBe("");
	});

	it("encodes boundariesHash and inline metadata roundtrip", () => {
		const encoded = encodeAreaRegistration({
			...input,
			boundariesHash:
				"0x0000000000000000000000000000000000000000000000000000000000000001",
			metadata: '{"v":1,"surfaceM2":420,"accessHours":"dawn-dusk"}',
		});
		const decoded = decodeAreaRegistration(encoded);
		expect(decoded.boundariesHash).toBe(
			"0x0000000000000000000000000000000000000000000000000000000000000001",
		);
		expect(decoded.metadata).toBe(
			'{"v":1,"surfaceM2":420,"accessHours":"dawn-dusk"}',
		);
	});

	it("produces valid ABI-encoded data", () => {
		const encoded = encodeAreaRegistration(input);
		const encoder = new SchemaEncoder(SCHEMA_STRINGS.AreaRegistration);
		expect(encoder.isEncodedDataValid(encoded)).toBe(true);
	});
});

// --- Intervention (renamed from PublishedIntervention) ---

describe("Intervention encoder", () => {
	const input = {
		areaUID: ZERO_BYTES32,
		interventionId: "INT-2026-0001",
		interventionType: InterventionType.RoutineMaintenance,
		executionDate: 1709251200n,
		commissionId: "sponsor-acme-001",
		evidenceBundleHash: ZERO_BYTES32,
	};

	it("encodes and decodes roundtrip", () => {
		const encoded = encodeIntervention(input);
		const decoded = decodeIntervention(encoded);
		expect(decoded.interventionId).toBe("INT-2026-0001");
		expect(decoded.interventionType).toBe(InterventionType.RoutineMaintenance);
		expect(decoded.executionDate).toBe(1709251200n);
		expect(decoded.commissionRef).toBe(hashIdentifier("sponsor-acme-001"));
		expect(decoded.evidenceBundleHash).toBe(ZERO_BYTES32);
	});

	it("encodes a volunteer intervention with ZERO_BYTES32 commissionRef", () => {
		const encoded = encodeIntervention({ ...input, commissionId: null });
		const decoded = decodeIntervention(encoded);
		expect(decoded.commissionRef).toBe(ZERO_BYTES32);
	});

	it("accepts a Date for executionDate and normalizes to Unix seconds", () => {
		const executionDate = new Date("2024-03-01T00:00:00.000Z");
		const encoded = encodeIntervention({ ...input, executionDate });
		const decoded = decodeIntervention(encoded);
		expect(decoded.executionDate).toBe(1709251200n);
	});

	it("produces valid ABI-encoded data", () => {
		const encoded = encodeIntervention(input);
		const encoder = new SchemaEncoder(SCHEMA_STRINGS.Intervention);
		expect(encoder.isEncodedDataValid(encoded)).toBe(true);
	});
});

// --- GardenerMilestone ---

describe("GardenerMilestone encoder", () => {
	const input = {
		recipient: MOCK_SIGNER_ADDRESS,
		milestoneLevel: 2,
		totalInterventions: 15,
		totalValidated: 14,
		avgHealthImprovement: 4,
		achievedAt: 1709424000n,
		evidenceRoot: ZERO_BYTES32,
	};

	it("encodes and decodes roundtrip", () => {
		const encoded = encodeGardenerMilestone(input);
		const decoded = decodeGardenerMilestone(encoded);
		expect(decoded.milestoneLevel).toBe(2);
		expect(decoded.totalInterventions).toBe(15);
		expect(decoded.totalValidated).toBe(14);
		expect(decoded.avgHealthImprovement).toBe(4);
		expect(decoded.achievedAt).toBe(1709424000n);
		expect(decoded.evidenceRoot).toBe(ZERO_BYTES32);
	});

	it("produces valid ABI-encoded data", () => {
		const encoded = encodeGardenerMilestone(input);
		const encoder = new SchemaEncoder(SCHEMA_STRINGS.GardenerMilestone);
		expect(encoder.isEncodedDataValid(encoded)).toBe(true);
	});
});

// --- Activity ABI (uint8 activityType, bytes32 payloadHash) ---

describe("Activity ABI encoder", () => {
	const samplePayloadHash =
		"0x1111111111111111111111111111111111111111111111111111111111111111";

	it("encodeActivityData + decodeActivityData roundtrip", () => {
		const data = encodeActivityData(ActivityType.Checkin, samplePayloadHash);
		expect(data.startsWith("0x")).toBe(true);

		const decoded = decodeActivityData(data);
		expect(decoded.activityType).toBe(ActivityType.Checkin);
		expect(decoded.payloadHash.toLowerCase()).toBe(
			samplePayloadHash.toLowerCase(),
		);
	});

	it("encodes every ActivityType value without loss", () => {
		for (const type of [
			ActivityType.Schedule,
			ActivityType.Checkin,
			ActivityType.Checkout,
			ActivityType.Report,
			ActivityType.Healthcheck,
		]) {
			const data = encodeActivityData(type, samplePayloadHash);
			const decoded = decodeActivityData(data);
			expect(decoded.activityType).toBe(type);
		}
	});

	it("produces valid ABI-encoded data", () => {
		const data = encodeActivityData(ActivityType.Report, samplePayloadHash);
		const encoder = new SchemaEncoder(SCHEMA_STRINGS.Activity);
		expect(encoder.isEncodedDataValid(data)).toBe(true);
	});

	it("encodes consistent widths: 2 + 64 + 64 hex chars for uint8 + bytes32", () => {
		const data = encodeActivityData(ActivityType.Schedule, samplePayloadHash);
		expect(data.length).toBe(2 + 64 + 64);
	});
});

describe("encodeActivityFromPayload", () => {
	it("returns data + payloadHash that agree with each other", () => {
		const payload = { actualMinutes: 45 };
		const { data, payloadHash } = encodeActivityFromPayload(
			ActivityType.Checkout,
			payload,
		);
		expect(payloadHash).toBe(hashActivityPayload(payload));
		const decoded = decodeActivityData(data);
		expect(decoded.activityType).toBe(ActivityType.Checkout);
		expect(decoded.payloadHash.toLowerCase()).toBe(payloadHash.toLowerCase());
	});

	it("produces the same hash regardless of key insertion order in the payload", () => {
		const a = encodeActivityFromPayload(ActivityType.Checkin, {
			latitude: 1,
			longitude: 2,
			photoCID: "cid",
		});
		const b = encodeActivityFromPayload(ActivityType.Checkin, {
			photoCID: "cid",
			longitude: 2,
			latitude: 1,
		});
		expect(a.payloadHash).toBe(b.payloadHash);
		expect(a.data).toBe(b.data);
	});
});

// --- Payload builders ---

describe("buildSchedulePayload", () => {
	const base = {
		interventionId: "INT-2026-0001",
		areaUID:
			"0x00000000000000000000000000000000000000000000000000000000000000a1",
		interventionType: InterventionType.RoutineMaintenance,
		crewLead: MOCK_SIGNER_ADDRESS,
		crewSize: 2,
		scheduledDate: 1709251200n,
		estimatedMinutes: 180,
		description: "Trim hedges",
		commissionId: "sponsor-acme",
	};

	it("produces the canonical payload shape with resolved commissionRef", () => {
		const payload = buildSchedulePayload(base);
		expect(payload).toEqual({
			interventionId: "INT-2026-0001",
			areaUID:
				"0x00000000000000000000000000000000000000000000000000000000000000a1",
			interventionType: InterventionType.RoutineMaintenance,
			scheduledDate: 1709251200,
			estimatedMinutes: 180,
			description: "Trim hedges",
			commissionRef: hashIdentifier("sponsor-acme"),
			crewSize: 2,
		});
	});

	it("normalizes Date to Unix seconds", () => {
		const payload = buildSchedulePayload({
			...base,
			scheduledDate: new Date("2024-03-01T00:00:00.000Z"),
		});
		expect(payload.scheduledDate).toBe(1709251200);
	});

	it("emits ZERO_BYTES32 commissionRef for volunteer schedules", () => {
		const payload = buildSchedulePayload({ ...base, commissionId: null });
		expect(payload.commissionRef).toBe(ZERO_BYTES32);
	});

	it("fails validation on invalid crewSize", () => {
		expect(() =>
			buildSchedulePayload({ ...base, crewSize: -1 }),
		).toThrow();
		expect(() =>
			buildSchedulePayload({ ...base, crewSize: 256 }),
		).toThrow();
	});

	it("fails validation on empty interventionId", () => {
		expect(() =>
			buildSchedulePayload({ ...base, interventionId: "" }),
		).toThrow();
	});
});

describe("buildCheckinPayload", () => {
	const base = {
		interventionId: "INT-2026-0001",
		latitude: 41.89,
		longitude: 12.4964,
		photoCID: "ipfs://Qm.../arrival.jpg",
	};

	it("converts lat/lng to microdegrees", () => {
		const payload = buildCheckinPayload(base);
		expect(payload.latitude).toBe(41890000);
		expect(payload.longitude).toBe(12496400);
		expect(payload.photoCID).toBe("ipfs://Qm.../arrival.jpg");
	});

	it("truncates extra decimals rather than rounding", () => {
		const payload = buildCheckinPayload({
			...base,
			latitude: 41.8901239,
			longitude: 12.1234569,
		});
		expect(payload.latitude).toBe(41890123);
		expect(payload.longitude).toBe(12123456);
	});

	it("rejects out-of-range latitude", () => {
		expect(() => buildCheckinPayload({ ...base, latitude: 95 })).toThrow();
		expect(() => buildCheckinPayload({ ...base, latitude: -91 })).toThrow();
	});

	it("rejects out-of-range longitude", () => {
		expect(() => buildCheckinPayload({ ...base, longitude: 181 })).toThrow();
		expect(() => buildCheckinPayload({ ...base, longitude: -181 })).toThrow();
	});
});

describe("buildCheckoutPayload", () => {
	it("passes actualMinutes through", () => {
		const payload = buildCheckoutPayload({
			interventionId: "INT-2026-0001",
			actualMinutes: 135,
		});
		expect(payload).toEqual({ actualMinutes: 135 });
	});

	it("rejects out-of-range actualMinutes", () => {
		expect(() =>
			buildCheckoutPayload({
				interventionId: "INT-2026-0001",
				actualMinutes: -1,
			}),
		).toThrow();
		expect(() =>
			buildCheckoutPayload({
				interventionId: "INT-2026-0001",
				actualMinutes: 65_536,
			}),
		).toThrow();
	});
});

describe("buildReportPayload", () => {
	it("keeps tasksCompleted as an array and preserves order", () => {
		const payload = buildReportPayload({
			interventionId: "INT-2026-0001",
			tasksCompleted: ["PRUNE", "CLEAN", "WATER"],
			photosCID: "ipfs://Qm.../work/",
			notes: "all good",
		});
		expect(payload.tasksCompleted).toEqual(["PRUNE", "CLEAN", "WATER"]);
		expect(payload.photosCID).toBe("ipfs://Qm.../work/");
		expect(payload.notes).toBe("all good");
	});

	it("accepts an empty tasksCompleted array", () => {
		const payload = buildReportPayload({
			interventionId: "INT-2026-0001",
			tasksCompleted: [],
			photosCID: "",
			notes: "",
		});
		expect(payload.tasksCompleted).toEqual([]);
	});

	it("rejects non-array tasksCompleted", () => {
		expect(() =>
			buildReportPayload({
				interventionId: "INT-2026-0001",
				// biome-ignore lint/suspicious/noExplicitAny: intentional bad input
				tasksCompleted: "PRUNE" as any,
				photosCID: "",
				notes: "",
			}),
		).toThrow();
	});
});

describe("buildHealthcheckPayload", () => {
	const base = {
		areaUID:
			"0x000000000000000000000000000000000000000000000000000000000000cafe",
		healthScore: 8,
		photoCID: "ipfs://Qm.../condition.jpg",
		notes: "Hedge trimmed.",
	};

	it("produces the canonical payload shape", () => {
		const payload = buildHealthcheckPayload(base);
		expect(payload).toEqual({
			healthScore: 8,
			photoCID: "ipfs://Qm.../condition.jpg",
			notes: "Hedge trimmed.",
		});
	});

	it("includes metadata when provided", () => {
		const payload = buildHealthcheckPayload({
			...base,
			metadata: { v: 1, weather: "sunny" },
		});
		expect(payload.metadata).toEqual({ v: 1, weather: "sunny" });
	});

	it("omits metadata when null or undefined", () => {
		const a = buildHealthcheckPayload({ ...base, metadata: null });
		const b = buildHealthcheckPayload({ ...base, metadata: undefined });
		expect("metadata" in a).toBe(false);
		expect("metadata" in b).toBe(false);
	});

	it("rejects healthScore outside 1-10", () => {
		expect(() =>
			buildHealthcheckPayload({ ...base, healthScore: 0 }),
		).toThrow();
		expect(() =>
			buildHealthcheckPayload({ ...base, healthScore: 11 }),
		).toThrow();
	});
});

// --- Hash-stability cross-check ---

describe("payload → ABI data → decode roundtrip", () => {
	it("is stable across canonical payload rebuilds", () => {
		const firstBuild = buildCheckoutPayload({
			interventionId: "INT-2026-0001",
			actualMinutes: 45,
		});
		const secondBuild = buildCheckoutPayload({
			interventionId: "INT-2026-0001",
			actualMinutes: 45,
		});
		expect(hashActivityPayload(firstBuild)).toBe(
			hashActivityPayload(secondBuild),
		);
	});

	it("commits the payload hash into ABI data that decodes back to the same hash", () => {
		const payload = buildSchedulePayload({
			interventionId: "INT-2026-0001",
			areaUID:
				"0x00000000000000000000000000000000000000000000000000000000000000a1",
			interventionType: InterventionType.RoutineMaintenance,
			crewLead: MOCK_SIGNER_ADDRESS,
			crewSize: 1,
			scheduledDate: 1709251200n,
			estimatedMinutes: 120,
			description: "",
			commissionId: null,
		});
		const { data, payloadHash } = encodeActivityFromPayload(
			ActivityType.Schedule,
			payload,
		);
		const decoded = decodeActivityData(data);
		expect(decoded.payloadHash.toLowerCase()).toBe(payloadHash.toLowerCase());
		expect(decoded.payloadHash.toLowerCase()).toBe(
			hashActivityPayload(payload).toLowerCase(),
		);
	});
});
