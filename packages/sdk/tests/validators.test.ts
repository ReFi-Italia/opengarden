import { describe, expect, it } from "vitest";
import { ZERO_BYTES32 } from "../src/constants";
import { OpenGardenError, OpenGardenErrorCode } from "../src/errors";
import {
	encodeAdminValidation,
	encodeAreaRegistration,
	encodeCitizenFeedback,
	encodeGardenerCheckin,
	encodeGardenerCheckout,
	encodeGardenerMilestone,
	encodeGardenerReport,
	encodeHealthcheck,
	encodePublishedIntervention,
	encodeScheduledIntervention,
} from "../src/schemas/encoders";
import { AreaType, InterventionType, MilestoneLevel } from "../src/types/enums";
import { MOCK_SIGNER_ADDRESS } from "./_helpers";

function expectInvalidInput(fn: () => unknown, fieldName: string) {
	try {
		fn();
	} catch (err) {
		expect(err).toBeInstanceOf(OpenGardenError);
		expect((err as OpenGardenError).code).toBe(OpenGardenErrorCode.INVALID_INPUT);
		expect((err as OpenGardenError).message).toContain(fieldName);
		return;
	}
	throw new Error("Expected encoder to throw INVALID_INPUT");
}

const validArea = {
	areaId: "RM-PIGN-042",
	latitude: 41.89,
	longitude: 12.4964,
	areaType: AreaType.PublicGreenSpace,
	name: "Test",
	municipality: "RM-I",
	metadataHash: null,
};

const validPublished = {
	areaUID: ZERO_BYTES32,
	interventionId: "INT-001",
	interventionType: InterventionType.RoutineMaintenance,
	executionDate: 1709251200n,
	healthBefore: 3,
	healthAfter: 8,
	commissionId: null,
	evidenceBundleHash: ZERO_BYTES32,
	offchainCount: 5,
	crewSize: 1,
};

const validScheduled = {
	areaUID: ZERO_BYTES32,
	interventionId: "INT-001",
	interventionType: InterventionType.RoutineMaintenance,
	crewLead: MOCK_SIGNER_ADDRESS,
	crewSize: 2,
	scheduledDate: 1709251200n,
	estimatedMinutes: 90,
	description: "Test",
	commissionId: null,
};

const validMilestone = {
	recipient: MOCK_SIGNER_ADDRESS,
	milestoneLevel: MilestoneLevel.Apprentice,
	totalInterventions: 5,
	totalValidated: 5,
	avgHealthImprovement: 4,
	skillTier: "Apprentice",
	achievedAt: 1709424000n,
	evidenceRoot: ZERO_BYTES32,
};

const validCheckin = {
	interventionUID: ZERO_BYTES32,
	latitude: 41.89,
	longitude: 12.4964,
	timestamp: 1709337600n,
	photoHash: ZERO_BYTES32,
};

const validCheckout = {
	checkinUID: ZERO_BYTES32,
	timestamp: 1709344800n,
	actualMinutes: 60,
};

const validReport = {
	interventionUID: ZERO_BYTES32,
	checkoutUID: ZERO_BYTES32,
	tasksCompleted: "PRUNE,CLEAN",
	taskCount: 2,
	photosHash: ZERO_BYTES32,
	notes: "done",
};

const validAdminValidation = {
	scheduleUID: ZERO_BYTES32,
	approved: true,
	qualityScore: 8,
	feedback: "ok",
	validatorId: null,
};

const validFeedback = {
	areaUID: ZERO_BYTES32,
	rating: 4,
	comment: "great",
	photoHash: ZERO_BYTES32,
};

const validHealthcheck = {
	areaUID: ZERO_BYTES32,
	interventionUID: ZERO_BYTES32,
	healthScore: 6,
	photoHash: ZERO_BYTES32,
	assessorNotes: "ok",
	interventionNeeded: false,
	assessorId: null,
};

describe("AreaRegistration validator", () => {
	it("rejects an areaType outside the enum", () => {
		expectInvalidInput(
			() => encodeAreaRegistration({ ...validArea, areaType: 99 as AreaType }),
			"areaType",
		);
	});

	it("rejects latitude out of range", () => {
		expectInvalidInput(
			() => encodeAreaRegistration({ ...validArea, latitude: 91 }),
			"latitude",
		);
	});

	it("rejects longitude out of range", () => {
		expectInvalidInput(
			() => encodeAreaRegistration({ ...validArea, longitude: 181 }),
			"longitude",
		);
	});
});

describe("PublishedIntervention validator", () => {
	it("rejects interventionType outside the enum", () => {
		expectInvalidInput(
			() =>
				encodePublishedIntervention({
					...validPublished,
					interventionType: 99 as InterventionType,
				}),
			"interventionType",
		);
	});

	it("rejects healthBefore above 10", () => {
		expectInvalidInput(
			() =>
				encodePublishedIntervention({ ...validPublished, healthBefore: 11 }),
			"healthBefore",
		);
	});

	it("rejects healthAfter below 0", () => {
		expectInvalidInput(
			() =>
				encodePublishedIntervention({ ...validPublished, healthAfter: -1 }),
			"healthAfter",
		);
	});

	it("rejects non-integer crewSize", () => {
		expectInvalidInput(
			() => encodePublishedIntervention({ ...validPublished, crewSize: 1.5 }),
			"crewSize",
		);
	});

	it("rejects offchainCount above uint8 max", () => {
		expectInvalidInput(
			() =>
				encodePublishedIntervention({ ...validPublished, offchainCount: 256 }),
			"offchainCount",
		);
	});

	it("accepts healthBefore=0 (unmeasured sentinel)", () => {
		expect(() =>
			encodePublishedIntervention({ ...validPublished, healthBefore: 0 }),
		).not.toThrow();
	});
});

describe("GardenerMilestone validator", () => {
	it("rejects milestoneLevel outside the enum", () => {
		expectInvalidInput(
			() =>
				encodeGardenerMilestone({
					...validMilestone,
					milestoneLevel: 0 as MilestoneLevel,
				}),
			"milestoneLevel",
		);
	});

	it("rejects totalInterventions above uint16 max", () => {
		expectInvalidInput(
			() =>
				encodeGardenerMilestone({
					...validMilestone,
					totalInterventions: 70_000,
				}),
			"totalInterventions",
		);
	});
});

describe("ScheduledIntervention validator", () => {
	it("rejects estimatedMinutes above uint16 max", () => {
		expectInvalidInput(
			() =>
				encodeScheduledIntervention({
					...validScheduled,
					estimatedMinutes: 70_000,
				}),
			"estimatedMinutes",
		);
	});

	it("accepts estimatedMinutes=0 (unspecified sentinel)", () => {
		expect(() =>
			encodeScheduledIntervention({
				...validScheduled,
				estimatedMinutes: 0,
			}),
		).not.toThrow();
	});
});

describe("GardenerCheckin validator", () => {
	it("rejects out-of-range latitude", () => {
		expectInvalidInput(
			() => encodeGardenerCheckin({ ...validCheckin, latitude: -91 }),
			"latitude",
		);
	});
});

describe("GardenerCheckout validator", () => {
	it("rejects actualMinutes above uint16 max", () => {
		expectInvalidInput(
			() => encodeGardenerCheckout({ ...validCheckout, actualMinutes: 70_000 }),
			"actualMinutes",
		);
	});
});

describe("GardenerReport validator", () => {
	it("rejects taskCount above uint8 max", () => {
		expectInvalidInput(
			() => encodeGardenerReport({ ...validReport, taskCount: 256 }),
			"taskCount",
		);
	});
});

describe("AdminValidation validator", () => {
	it("rejects qualityScore above 10", () => {
		expectInvalidInput(
			() =>
				encodeAdminValidation({ ...validAdminValidation, qualityScore: 11 }),
			"qualityScore",
		);
	});

	it("accepts qualityScore=0 (unscored sentinel)", () => {
		expect(() =>
			encodeAdminValidation({ ...validAdminValidation, qualityScore: 0 }),
		).not.toThrow();
	});
});

describe("CitizenFeedback validator", () => {
	it("rejects rating above 5", () => {
		expectInvalidInput(
			() => encodeCitizenFeedback({ ...validFeedback, rating: 6 }),
			"rating",
		);
	});

	it("accepts rating=0 (no rating sentinel)", () => {
		expect(() =>
			encodeCitizenFeedback({ ...validFeedback, rating: 0 }),
		).not.toThrow();
	});
});

describe("Healthcheck validator", () => {
	it("rejects healthScore=0 (spec range is 1..10, no sentinel)", () => {
		expectInvalidInput(
			() => encodeHealthcheck({ ...validHealthcheck, healthScore: 0 }),
			"healthScore",
		);
	});

	it("rejects healthScore above 10", () => {
		expectInvalidInput(
			() => encodeHealthcheck({ ...validHealthcheck, healthScore: 11 }),
			"healthScore",
		);
	});
});
