import { OpenGardenError, OpenGardenErrorCode } from "../errors";
import {
	AreaType,
	InterventionType,
	MilestoneLevel,
} from "../types/enums";
import type {
	AreaRegistrationInput,
	CheckinActivityInput,
	CheckoutActivityInput,
	GardenerMilestoneInput,
	HealthcheckActivityInput,
	InterventionInput,
	ReportActivityInput,
	ScheduleActivityInput,
} from "../types/schemas";

const UINT8_MAX = 255;
const UINT16_MAX = 65_535;

function fail(field: string, reason: string): never {
	throw new OpenGardenError(
		OpenGardenErrorCode.INVALID_INPUT,
		`Invalid ${field}: ${reason}`,
	);
}

function assertInteger(value: number, field: string): void {
	if (!Number.isFinite(value) || !Number.isInteger(value)) {
		fail(field, `expected integer, got ${value}`);
	}
}

function assertRange(
	value: number,
	min: number,
	max: number,
	field: string,
): void {
	assertInteger(value, field);
	if (value < min || value > max) {
		fail(field, `must be between ${min} and ${max}, got ${value}`);
	}
}

function assertUint8(value: number, field: string): void {
	assertRange(value, 0, UINT8_MAX, field);
}

function assertUint16(value: number, field: string): void {
	assertRange(value, 0, UINT16_MAX, field);
}

function assertEnum<T extends number>(
	value: number,
	validValues: readonly T[],
	field: string,
): void {
	if (!validValues.includes(value as T)) {
		fail(field, `must be one of [${validValues.join(", ")}], got ${value}`);
	}
}

function assertLatitude(value: number, field: string): void {
	if (!Number.isFinite(value) || value < -90 || value > 90) {
		fail(field, `must be between -90 and 90, got ${value}`);
	}
}

function assertLongitude(value: number, field: string): void {
	if (!Number.isFinite(value) || value < -180 || value > 180) {
		fail(field, `must be between -180 and 180, got ${value}`);
	}
}

function assertNonEmptyString(value: string, field: string): void {
	if (typeof value !== "string" || value.length === 0) {
		fail(field, `expected non-empty string`);
	}
}

const AREA_TYPES = Object.values(AreaType).filter(
	(v): v is AreaType => typeof v === "number",
);
const INTERVENTION_TYPES = Object.values(InterventionType).filter(
	(v): v is InterventionType => typeof v === "number",
);
const MILESTONE_LEVELS = Object.values(MilestoneLevel).filter(
	(v): v is MilestoneLevel => typeof v === "number",
);

// --- On-chain schema validators ---

export function validateAreaRegistration(input: AreaRegistrationInput): void {
	assertEnum(input.areaType, AREA_TYPES, "areaType");
	assertLatitude(input.latitude, "latitude");
	assertLongitude(input.longitude, "longitude");
}

export function validateIntervention(input: InterventionInput): void {
	assertEnum(input.interventionType, INTERVENTION_TYPES, "interventionType");
	assertNonEmptyString(input.interventionId, "interventionId");
}

export function validateGardenerMilestone(input: GardenerMilestoneInput): void {
	assertEnum(input.milestoneLevel, MILESTONE_LEVELS, "milestoneLevel");
	assertUint16(input.totalInterventions, "totalInterventions");
	assertUint16(input.totalValidated, "totalValidated");
	assertUint8(input.avgHealthImprovement, "avgHealthImprovement");
}

// --- Activity payload validators (per-type) ---

export function validateScheduleActivity(input: ScheduleActivityInput): void {
	assertNonEmptyString(input.interventionId, "interventionId");
	assertEnum(input.interventionType, INTERVENTION_TYPES, "interventionType");
	assertUint8(input.crewSize, "crewSize");
	assertUint16(input.plannedDuration, "plannedDuration");
	if (!Array.isArray(input.tasksPlanned)) {
		fail("tasksPlanned", "expected array of task code strings");
	}
}

function assertOptionalCoordinatePair(
	latitude: number | undefined,
	longitude: number | undefined,
): void {
	const hasLat = latitude !== undefined;
	const hasLng = longitude !== undefined;
	if (hasLat !== hasLng) {
		fail(
			hasLat ? "longitude" : "latitude",
			"latitude and longitude must be both present or both absent",
		);
	}
	if (hasLat && hasLng) {
		assertLatitude(latitude as number, "latitude");
		assertLongitude(longitude as number, "longitude");
	}
}

export function validateCheckinActivity(input: CheckinActivityInput): void {
	assertNonEmptyString(input.interventionId, "interventionId");
	assertOptionalCoordinatePair(input.latitude, input.longitude);
}

export function validateCheckoutActivity(input: CheckoutActivityInput): void {
	assertNonEmptyString(input.interventionId, "interventionId");
	assertOptionalCoordinatePair(input.latitude, input.longitude);
}

export function validateReportActivity(input: ReportActivityInput): void {
	assertNonEmptyString(input.interventionId, "interventionId");
	if (!Array.isArray(input.tasksCompleted)) {
		fail("tasksCompleted", "expected array of task code strings");
	}
	assertUint16(input.reportedEffort, "reportedEffort");
}

export function validateHealthcheckActivity(
	input: HealthcheckActivityInput,
): void {
	assertRange(input.healthScore, 1, 10, "healthScore");
}
