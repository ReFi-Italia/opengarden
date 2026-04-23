import { beforeAll, describe, expect, it } from "vitest";
import { ZERO_BYTES32 } from "../src/constants";
import { OpenGardenError, OpenGardenErrorCode } from "../src/errors";
import {
	buildCheckinPayload,
	buildCheckoutPayload,
	buildHealthcheckPayload,
	buildReportPayload,
	buildSchedulePayload,
	encodeAreaRegistration,
	encodeGardenerMilestone,
	encodeIntervention,
	initEncoders,
} from "../src/schemas/encoders";
import {
	AreaType,
	InterventionType,
	MilestoneLevel,
} from "../src/types/enums";
import { MOCK_SIGNER_ADDRESS } from "./_helpers";

beforeAll(async () => {
	await initEncoders();
});

function expectInvalidInput(fn: () => unknown, fieldName: string) {
	try {
		fn();
	} catch (err) {
		expect(err).toBeInstanceOf(OpenGardenError);
		expect((err as OpenGardenError).code).toBe(
			OpenGardenErrorCode.INVALID_INPUT,
		);
		expect((err as OpenGardenError).message).toContain(fieldName);
		return;
	}
	throw new Error(`Expected function to throw INVALID_INPUT for "${fieldName}"`);
}

// --- On-chain schemas ---

const validArea = {
	areaId: "RM-PIGN-042",
	latitude: 41.89,
	longitude: 12.4964,
	areaType: AreaType.PublicGreenSpace,
	name: "Test",
	municipality: "RM-I",
	boundary: null,
	metadata: "",
};

describe("AreaRegistration validator", () => {
	it("accepts the valid fixture", () => {
		expect(() => encodeAreaRegistration(validArea)).not.toThrow();
	});

	it("rejects areaType outside the enum", () => {
		expectInvalidInput(
			() => encodeAreaRegistration({ ...validArea, areaType: 99 as AreaType }),
			"areaType",
		);
	});

	it("rejects negative areaType", () => {
		expectInvalidInput(
			() => encodeAreaRegistration({ ...validArea, areaType: -1 as AreaType }),
			"areaType",
		);
	});

	it("accepts latitude at the boundary (±90)", () => {
		expect(() =>
			encodeAreaRegistration({ ...validArea, latitude: 90 }),
		).not.toThrow();
		expect(() =>
			encodeAreaRegistration({ ...validArea, latitude: -90 }),
		).not.toThrow();
	});

	it("rejects latitude just past the boundary", () => {
		expectInvalidInput(
			() => encodeAreaRegistration({ ...validArea, latitude: 91 }),
			"latitude",
		);
		expectInvalidInput(
			() => encodeAreaRegistration({ ...validArea, latitude: -91 }),
			"latitude",
		);
	});

	it("accepts longitude at the boundary (±180)", () => {
		expect(() =>
			encodeAreaRegistration({ ...validArea, longitude: 180 }),
		).not.toThrow();
		expect(() =>
			encodeAreaRegistration({ ...validArea, longitude: -180 }),
		).not.toThrow();
	});

	it("rejects longitude just past the boundary", () => {
		expectInvalidInput(
			() => encodeAreaRegistration({ ...validArea, longitude: 181 }),
			"longitude",
		);
		expectInvalidInput(
			() => encodeAreaRegistration({ ...validArea, longitude: -181 }),
			"longitude",
		);
	});

	it("rejects non-finite latitude (NaN, Infinity)", () => {
		expectInvalidInput(
			() => encodeAreaRegistration({ ...validArea, latitude: Number.NaN }),
			"latitude",
		);
		expectInvalidInput(
			() => encodeAreaRegistration({ ...validArea, latitude: Infinity }),
			"latitude",
		);
	});
});

const validIntervention = {
	areaUID: ZERO_BYTES32,
	interventionId: "INT-001",
	interventionType: InterventionType.RoutineMaintenance,
	executionDate: 1709251200n,
	commissionId: null,
	evidenceBundleHash: ZERO_BYTES32,
};

describe("Intervention validator", () => {
	it("accepts the valid fixture", () => {
		expect(() => encodeIntervention(validIntervention)).not.toThrow();
	});

	it("rejects interventionType outside the enum", () => {
		expectInvalidInput(
			() =>
				encodeIntervention({
					...validIntervention,
					interventionType: 99 as InterventionType,
				}),
			"interventionType",
		);
	});

	it("rejects empty interventionId", () => {
		expectInvalidInput(
			() => encodeIntervention({ ...validIntervention, interventionId: "" }),
			"interventionId",
		);
	});

	it("accepts every valid interventionType enum value", () => {
		for (const type of [
			InterventionType.Unspecified,
			InterventionType.RoutineMaintenance,
			InterventionType.Restoration,
			InterventionType.Emergency,
			InterventionType.Seasonal,
			InterventionType.NewPlanting,
		]) {
			expect(() =>
				encodeIntervention({ ...validIntervention, interventionType: type }),
			).not.toThrow();
		}
	});
});

const validMilestone = {
	recipient: MOCK_SIGNER_ADDRESS,
	milestoneLevel: MilestoneLevel.Apprentice,
	totalInterventions: 5,
	totalValidated: 5,
	avgHealthImprovement: 4,
	achievedAt: 1709424000n,
	evidenceRoot: ZERO_BYTES32,
};

describe("GardenerMilestone validator", () => {
	it("accepts the valid fixture", () => {
		expect(() => encodeGardenerMilestone(validMilestone)).not.toThrow();
	});

	it("rejects milestoneLevel=0 (not in the enum)", () => {
		expectInvalidInput(
			() =>
				encodeGardenerMilestone({
					...validMilestone,
					milestoneLevel: 0 as MilestoneLevel,
				}),
			"milestoneLevel",
		);
	});

	it("rejects milestoneLevel above the enum max", () => {
		expectInvalidInput(
			() =>
				encodeGardenerMilestone({
					...validMilestone,
					milestoneLevel: 99 as MilestoneLevel,
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

	it("rejects totalValidated above uint16 max", () => {
		expectInvalidInput(
			() =>
				encodeGardenerMilestone({
					...validMilestone,
					totalValidated: 70_000,
				}),
			"totalValidated",
		);
	});

	it("rejects avgHealthImprovement above uint8 max", () => {
		expectInvalidInput(
			() =>
				encodeGardenerMilestone({
					...validMilestone,
					avgHealthImprovement: 256,
				}),
			"avgHealthImprovement",
		);
	});

	it("rejects non-integer counts (float)", () => {
		expectInvalidInput(
			() =>
				encodeGardenerMilestone({
					...validMilestone,
					totalInterventions: 5.5,
				}),
			"totalInterventions",
		);
	});

	it("accepts zero counts (edge of uint range)", () => {
		expect(() =>
			encodeGardenerMilestone({
				...validMilestone,
				totalInterventions: 0,
				totalValidated: 0,
				avgHealthImprovement: 0,
			}),
		).not.toThrow();
	});
});

// --- Activity payload validators (via buildXxxPayload) ---

const validSchedule = {
	interventionId: "INT-2026-0001",
	areaUID:
		"0x00000000000000000000000000000000000000000000000000000000000000a1",
	interventionType: InterventionType.RoutineMaintenance,
	crewLead: MOCK_SIGNER_ADDRESS,
	crewSize: 2,
	scheduledDate: 1709251200n,
	estimatedMinutes: 90,
	description: "Test",
	commissionId: null,
};

describe("Schedule activity validator", () => {
	it("accepts the valid fixture", () => {
		expect(() => buildSchedulePayload(validSchedule)).not.toThrow();
	});

	it("rejects empty interventionId", () => {
		expectInvalidInput(
			() => buildSchedulePayload({ ...validSchedule, interventionId: "" }),
			"interventionId",
		);
	});

	it("rejects interventionType outside the enum", () => {
		expectInvalidInput(
			() =>
				buildSchedulePayload({
					...validSchedule,
					interventionType: 99 as InterventionType,
				}),
			"interventionType",
		);
	});

	it("rejects crewSize above uint8 max", () => {
		expectInvalidInput(
			() => buildSchedulePayload({ ...validSchedule, crewSize: 256 }),
			"crewSize",
		);
	});

	it("rejects negative crewSize", () => {
		expectInvalidInput(
			() => buildSchedulePayload({ ...validSchedule, crewSize: -1 }),
			"crewSize",
		);
	});

	it("rejects estimatedMinutes above uint16 max", () => {
		expectInvalidInput(
			() =>
				buildSchedulePayload({
					...validSchedule,
					estimatedMinutes: 70_000,
				}),
			"estimatedMinutes",
		);
	});

	it("accepts estimatedMinutes=0 (unspecified sentinel)", () => {
		expect(() =>
			buildSchedulePayload({ ...validSchedule, estimatedMinutes: 0 }),
		).not.toThrow();
	});

	it("accepts crewSize=1 for solo jobs", () => {
		expect(() =>
			buildSchedulePayload({ ...validSchedule, crewSize: 1 }),
		).not.toThrow();
	});
});

const validCheckin = {
	interventionId: "INT-2026-0001",
	latitude: 41.89,
	longitude: 12.4964,
	photoCID: "",
};

describe("Checkin activity validator", () => {
	it("accepts the valid fixture", () => {
		expect(() => buildCheckinPayload(validCheckin)).not.toThrow();
	});

	it("rejects empty interventionId", () => {
		expectInvalidInput(
			() => buildCheckinPayload({ ...validCheckin, interventionId: "" }),
			"interventionId",
		);
	});

	it("rejects out-of-range latitude", () => {
		expectInvalidInput(
			() => buildCheckinPayload({ ...validCheckin, latitude: -91 }),
			"latitude",
		);
	});

	it("rejects out-of-range longitude", () => {
		expectInvalidInput(
			() => buildCheckinPayload({ ...validCheckin, longitude: 181 }),
			"longitude",
		);
	});

	it("rejects non-finite latitude", () => {
		expectInvalidInput(
			() => buildCheckinPayload({ ...validCheckin, latitude: Number.NaN }),
			"latitude",
		);
	});
});

const validCheckout = {
	interventionId: "INT-2026-0001",
	actualMinutes: 60,
};

describe("Checkout activity validator", () => {
	it("accepts the valid fixture", () => {
		expect(() => buildCheckoutPayload(validCheckout)).not.toThrow();
	});

	it("rejects empty interventionId", () => {
		expectInvalidInput(
			() => buildCheckoutPayload({ ...validCheckout, interventionId: "" }),
			"interventionId",
		);
	});

	it("rejects actualMinutes above uint16 max", () => {
		expectInvalidInput(
			() => buildCheckoutPayload({ ...validCheckout, actualMinutes: 70_000 }),
			"actualMinutes",
		);
	});

	it("rejects negative actualMinutes", () => {
		expectInvalidInput(
			() => buildCheckoutPayload({ ...validCheckout, actualMinutes: -1 }),
			"actualMinutes",
		);
	});

	it("accepts actualMinutes=0 (zero-duration session sentinel)", () => {
		expect(() =>
			buildCheckoutPayload({ ...validCheckout, actualMinutes: 0 }),
		).not.toThrow();
	});
});

const validReport = {
	interventionId: "INT-2026-0001",
	tasksCompleted: ["PRUNE", "CLEAN"],
	photosCID: "",
	notes: "",
};

describe("Report activity validator", () => {
	it("accepts the valid fixture", () => {
		expect(() => buildReportPayload(validReport)).not.toThrow();
	});

	it("rejects empty interventionId", () => {
		expectInvalidInput(
			() => buildReportPayload({ ...validReport, interventionId: "" }),
			"interventionId",
		);
	});

	it("rejects non-array tasksCompleted", () => {
		expectInvalidInput(
			() =>
				buildReportPayload({
					...validReport,
					// biome-ignore lint/suspicious/noExplicitAny: intentional bad input
					tasksCompleted: "PRUNE,CLEAN" as any,
				}),
			"tasksCompleted",
		);
	});

	it("accepts an empty tasksCompleted array", () => {
		expect(() =>
			buildReportPayload({ ...validReport, tasksCompleted: [] }),
		).not.toThrow();
	});
});

const validHealthcheck = {
	areaUID: ZERO_BYTES32,
	healthScore: 6,
	photoCID: "",
	notes: "",
};

describe("Healthcheck activity validator", () => {
	it("accepts the valid fixture", () => {
		expect(() => buildHealthcheckPayload(validHealthcheck)).not.toThrow();
	});

	it("rejects healthScore=0 (spec range is 1..10)", () => {
		expectInvalidInput(
			() => buildHealthcheckPayload({ ...validHealthcheck, healthScore: 0 }),
			"healthScore",
		);
	});

	it("rejects healthScore above 10", () => {
		expectInvalidInput(
			() => buildHealthcheckPayload({ ...validHealthcheck, healthScore: 11 }),
			"healthScore",
		);
	});

	it("accepts healthScore at both boundaries (1 and 10)", () => {
		expect(() =>
			buildHealthcheckPayload({ ...validHealthcheck, healthScore: 1 }),
		).not.toThrow();
		expect(() =>
			buildHealthcheckPayload({ ...validHealthcheck, healthScore: 10 }),
		).not.toThrow();
	});

	it("rejects non-integer healthScore", () => {
		expectInvalidInput(
			() => buildHealthcheckPayload({ ...validHealthcheck, healthScore: 5.5 }),
			"healthScore",
		);
	});
});
