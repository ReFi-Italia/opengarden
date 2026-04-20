import { SchemaEncoder } from "@ethereum-attestation-service/eas-sdk";
import { describe, expect, it } from "vitest";
import { ZERO_BYTES32 } from "../src/constants";
import { SCHEMA_STRINGS } from "../src/schemas/definitions";
import {
	decodeAreaRegistration,
	decodeGardenerMilestone,
	decodeHealthcheck,
	decodePublishedIntervention,
	decodeScheduledIntervention,
	encodeAdminValidation,
	encodeAreaRegistration,
	encodeGardenerCheckin,
	encodeGardenerCheckout,
	encodeGardenerMilestone,
	encodeGardenerReport,
	encodeHealthcheck,
	encodePublishedIntervention,
	encodeScheduledIntervention,
} from "../src/schemas/encoders";
import { AreaType, InterventionType } from "../src/types/enums";
import { hashIdentifier } from "../src/utils";
import { MOCK_SIGNER_ADDRESS } from "./_helpers";

describe("AreaRegistration encoder", () => {
	const input = {
		areaId: "RM-PIGN-042",
		latitude: 41.89,
		longitude: 12.4964,
		areaType: AreaType.PublicGreenSpace,
		name: "Giardino Via Appia 12",
		municipality: "RM-I",
		metadataHash: null,
	};

	it("encodes and decodes roundtrip", () => {
		const encoded = encodeAreaRegistration(input);
		expect(encoded).toBeTruthy();
		expect(typeof encoded).toBe("string");
		expect(encoded.startsWith("0x")).toBe(true);

		const decoded = decodeAreaRegistration(encoded);
		expect(decoded.areaId).toBe("RM-PIGN-042");
		expect(decoded.latitude).toBeCloseTo(41.89, 4);
		expect(decoded.longitude).toBeCloseTo(12.4964, 4);
		expect(decoded.areaType).toBe(AreaType.PublicGreenSpace);
		expect(decoded.name).toBe("Giardino Via Appia 12");
		expect(decoded.municipality).toBe("RM-I");
	});

	it("produces valid ABI-encoded data", () => {
		const encoded = encodeAreaRegistration(input);
		const encoder = new SchemaEncoder(SCHEMA_STRINGS.AreaRegistration);
		expect(encoder.isEncodedDataValid(encoded)).toBe(true);
	});
});

describe("PublishedIntervention encoder", () => {
	const input = {
		areaUID: ZERO_BYTES32,
		interventionId: "INT-2026-0001",
		interventionType: InterventionType.RoutineMaintenance,
		executionDate: 1709251200n,
		commissionId: "sponsor-acme-001",
		evidenceBundleHash: ZERO_BYTES32,
		offchainCount: 8,
		crewSize: 2,
	};

	it("encodes and decodes roundtrip", () => {
		const encoded = encodePublishedIntervention(input);
		const decoded = decodePublishedIntervention(encoded);
		expect(decoded.interventionId).toBe("INT-2026-0001");
		expect(decoded.interventionType).toBe(InterventionType.RoutineMaintenance);
		expect(decoded.executionDate).toBe(1709251200n);
		expect(decoded.commissionRef).toBe(hashIdentifier("sponsor-acme-001"));
		expect(decoded.offchainCount).toBe(8);
		expect(decoded.crewSize).toBe(2);
	});

	it("encodes a volunteer intervention with ZERO_BYTES32 commissionRef", () => {
		const encoded = encodePublishedIntervention({
			...input,
			commissionId: null,
		});
		const decoded = decodePublishedIntervention(encoded);
		expect(decoded.commissionRef).toBe(ZERO_BYTES32);
	});

	it("accepts a Date for executionDate and normalizes to Unix seconds", () => {
		const executionDate = new Date("2024-03-01T00:00:00.000Z");
		const encoded = encodePublishedIntervention({ ...input, executionDate });
		const decoded = decodePublishedIntervention(encoded);
		expect(decoded.executionDate).toBe(1709251200n);
	});
});

describe("GardenerMilestone encoder", () => {
	const input = {
		recipient: MOCK_SIGNER_ADDRESS,
		milestoneLevel: 2,
		totalInterventions: 15,
		totalValidated: 14,
		avgHealthImprovement: 4,
		skillTier: "Certified Urban Gardener — Level 2",
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
		expect(decoded.skillTier).toBe("Certified Urban Gardener — Level 2");
		expect(decoded.achievedAt).toBe(1709424000n);
	});
});

describe("ScheduledIntervention encoder", () => {
	it("encodes and decodes roundtrip", () => {
		const encoded = encodeScheduledIntervention({
			areaUID: ZERO_BYTES32,
			interventionId: "INT-2026-0002",
			interventionType: InterventionType.Restoration,
			crewLead: MOCK_SIGNER_ADDRESS,
			crewSize: 3,
			scheduledDate: 1709337600n,
			estimatedMinutes: 120,
			description: "Restoration of flower beds",
			commissionId: "sponsor-city-hall",
		});
		expect(encoded).toBeTruthy();
		const encoder = new SchemaEncoder(SCHEMA_STRINGS.ScheduledIntervention);
		expect(encoder.isEncodedDataValid(encoded)).toBe(true);

		const decoded = decodeScheduledIntervention(encoded);
		expect(decoded.interventionId).toBe("INT-2026-0002");
		expect(decoded.interventionType).toBe(InterventionType.Restoration);
		expect(decoded.scheduledDate).toBe(1709337600n);
		expect(decoded.estimatedMinutes).toBe(120);
		expect(decoded.description).toBe("Restoration of flower beds");
		expect(decoded.commissionRef).toBe(hashIdentifier("sponsor-city-hall"));
		expect(decoded.crewSize).toBe(3);
	});
});

describe("GardenerCheckin encoder", () => {
	it("encodes with coordinate conversion", () => {
		const encoded = encodeGardenerCheckin({
			interventionUID: ZERO_BYTES32,
			latitude: 41.89,
			longitude: 12.4964,
			timestamp: 1709337600n,
			photoHash: ZERO_BYTES32,
		});
		expect(encoded).toBeTruthy();
		const encoder = new SchemaEncoder(SCHEMA_STRINGS.GardenerCheckin);
		expect(encoder.isEncodedDataValid(encoded)).toBe(true);
	});
});

describe("GardenerCheckout encoder", () => {
	it("encodes without error", () => {
		const encoded = encodeGardenerCheckout({
			checkinUID: ZERO_BYTES32,
			timestamp: 1709344800n,
			actualMinutes: 90,
		});
		expect(encoded).toBeTruthy();
		const encoder = new SchemaEncoder(SCHEMA_STRINGS.GardenerCheckout);
		expect(encoder.isEncodedDataValid(encoded)).toBe(true);
	});
});

describe("GardenerReport encoder", () => {
	it("encodes without error", () => {
		const encoded = encodeGardenerReport({
			interventionUID: ZERO_BYTES32,
			checkoutUID: ZERO_BYTES32,
			tasksCompleted: "PRUNE,CLEAN,WATER",
			taskCount: 3,
			photosHash: ZERO_BYTES32,
			notes: "All tasks completed. Rose beds pruned.",
		});
		expect(encoded).toBeTruthy();
		const encoder = new SchemaEncoder(SCHEMA_STRINGS.GardenerReport);
		expect(encoder.isEncodedDataValid(encoded)).toBe(true);
	});
});

describe("AdminValidation encoder", () => {
	it("encodes without error", () => {
		const encoded = encodeAdminValidation({
			scheduleUID: ZERO_BYTES32,
			approved: true,
			qualityScore: 8,
			feedback: "Good work.",
			validatorId: null,
		});
		expect(encoded).toBeTruthy();
		const encoder = new SchemaEncoder(SCHEMA_STRINGS.AdminValidation);
		expect(encoder.isEncodedDataValid(encoded)).toBe(true);
	});
});

describe("Healthcheck encoder", () => {
	const AREA_UID =
		"0x000000000000000000000000000000000000000000000000000000000000cafe";

	it("encodes and decodes a healthcheck roundtrip", () => {
		const encoded = encodeHealthcheck({
			areaUID: AREA_UID,
			healthScore: 8,
			photoHash: ZERO_BYTES32,
			notes: "Hedge trimmed, beds mulched.",
			metadata: '{"weather":"sunny"}',
		});
		expect(encoded).toBeTruthy();
		const encoder = new SchemaEncoder(SCHEMA_STRINGS.Healthcheck);
		expect(encoder.isEncodedDataValid(encoded)).toBe(true);

		const decoded = decodeHealthcheck(encoded);
		expect(decoded.areaUID).toBe(AREA_UID);
		expect(decoded.healthScore).toBe(8);
		expect(decoded.photoHash).toBe(ZERO_BYTES32);
		expect(decoded.notes).toBe("Hedge trimmed, beds mulched.");
		expect(decoded.metadata).toBe('{"weather":"sunny"}');
	});

	it("accepts empty strings for notes and metadata", () => {
		const encoded = encodeHealthcheck({
			areaUID: AREA_UID,
			healthScore: 5,
			photoHash: ZERO_BYTES32,
			notes: "",
			metadata: "",
		});
		const decoded = decodeHealthcheck(encoded);
		expect(decoded.notes).toBe("");
		expect(decoded.metadata).toBe("");
	});
});
