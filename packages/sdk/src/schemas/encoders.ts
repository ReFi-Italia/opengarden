import type { SchemaEncoder as SchemaEncoderType } from "@ethereum-attestation-service/eas-sdk";
import { ZERO_BYTES32 } from "../constants";
import { type SponsorRef, serializeSponsorRef } from "../sponsor";
import type {
	CheckinActivityPayload,
	CheckoutActivityPayload,
	HealthcheckActivityPayload,
	ReportActivityPayload,
	ScheduleActivityPayload,
} from "../types/attestation";
import {
	ActivityType,
	type AreaType,
	type InterventionType,
	type MilestoneLevel,
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
import {
	fromMicrodegrees,
	hashActivityPayload,
	hashBoundary,
	hashIdentifier,
	toMicrodegrees,
	toUnixSeconds,
} from "../utils";
import { SCHEMA_STRINGS } from "./definitions";
import {
	validateAreaRegistration,
	validateCheckinActivity,
	validateCheckoutActivity,
	validateGardenerMilestone,
	validateHealthcheckActivity,
	validateIntervention,
	validateReportActivity,
	validateScheduleActivity,
} from "./validators";

let SchemaEncoderCtor: (new (schema: string) => SchemaEncoderType) | null =
	null;

/**
 * Lazy-loads the `SchemaEncoder` class from `eas-sdk` and caches it.
 * Idempotent. `createOpenGardenClient` calls it automatically; consumers
 * calling the encode/decode helpers directly must await it first.
 */
export async function initEncoders(): Promise<void> {
	if (SchemaEncoderCtor) return;
	const mod = await import("@ethereum-attestation-service/eas-sdk");
	SchemaEncoderCtor = mod.SchemaEncoder;
}

export function newSchemaEncoder(schema: string): SchemaEncoderType {
	if (!SchemaEncoderCtor) {
		throw new Error(
			"SchemaEncoder not initialised. Call `initEncoders()` (or use `createOpenGardenClient`) first.",
		);
	}
	return new SchemaEncoderCtor(schema);
}

function hashCommissionIdOrZero(id: string | SponsorRef | null): string {
	if (id === null) return ZERO_BYTES32;
	if (typeof id === "string") return hashIdentifier(id);
	const serialized = serializeSponsorRef(id);
	return serialized === null ? ZERO_BYTES32 : hashIdentifier(serialized);
}

// --- On-chain encoders ---

export function encodeAreaRegistration(input: AreaRegistrationInput): string {
	validateAreaRegistration(input);
	const encoder = newSchemaEncoder(SCHEMA_STRINGS.AreaRegistration);
	return encoder.encodeData([
		{ name: "areaId", value: input.areaId, type: "string" },
		{ name: "latitude", value: toMicrodegrees(input.latitude), type: "int32" },
		{
			name: "longitude",
			value: toMicrodegrees(input.longitude),
			type: "int32",
		},
		{ name: "areaType", value: input.areaType, type: "uint8" },
		{ name: "name", value: input.name, type: "string" },
		{ name: "municipality", value: input.municipality, type: "string" },
		{
			name: "boundariesHash",
			value: input.boundary === null ? ZERO_BYTES32 : hashBoundary(input.boundary),
			type: "bytes32",
		},
		{ name: "metadata", value: input.metadata, type: "string" },
	]);
}

export function encodeIntervention(input: InterventionInput): string {
	validateIntervention(input);
	const encoder = newSchemaEncoder(SCHEMA_STRINGS.Intervention);
	return encoder.encodeData([
		{ name: "interventionId", value: input.interventionId, type: "string" },
		{ name: "interventionType", value: input.interventionType, type: "uint8" },
		{
			name: "executionDate",
			value: toUnixSeconds(input.executionDate),
			type: "uint64",
		},
		{
			name: "evidenceBundleHash",
			value: input.evidenceBundleHash,
			type: "bytes32",
		},
		{
			name: "commissionRef",
			value: hashCommissionIdOrZero(input.commissionId),
			type: "bytes32",
		},
	]);
}

export function encodeGardenerMilestone(input: GardenerMilestoneInput): string {
	validateGardenerMilestone(input);
	const encoder = newSchemaEncoder(SCHEMA_STRINGS.GardenerMilestone);
	return encoder.encodeData([
		{ name: "milestoneLevel", value: input.milestoneLevel, type: "uint8" },
		{
			name: "totalInterventions",
			value: input.totalInterventions,
			type: "uint16",
		},
		{ name: "totalValidated", value: input.totalValidated, type: "uint16" },
		{
			name: "avgHealthImprovement",
			value: input.avgHealthImprovement,
			type: "uint8",
		},
		{
			name: "achievedAt",
			value: toUnixSeconds(input.achievedAt),
			type: "uint64",
		},
		{ name: "evidenceRoot", value: input.evidenceRoot, type: "bytes32" },
	]);
}

// --- Activity ABI encoder (schema: `uint8 activityType, bytes32 payloadHash`) ---

export function encodeActivityData(
	activityType: ActivityType,
	payloadHash: string,
): string {
	const encoder = newSchemaEncoder(SCHEMA_STRINGS.Activity);
	return encoder.encodeData([
		{ name: "activityType", value: activityType, type: "uint8" },
		{ name: "payloadHash", value: payloadHash, type: "bytes32" },
	]);
}

// --- Per-type payload builders (typed Input → canonical Payload) ---

export function buildSchedulePayload(
	input: ScheduleActivityInput,
): ScheduleActivityPayload {
	validateScheduleActivity(input);
	return {
		interventionId: input.interventionId,
		areaUID: input.areaUID,
		interventionType: input.interventionType,
		scheduledDate: Number(toUnixSeconds(input.scheduledDate)),
		plannedDuration: input.plannedDuration,
		tasksPlanned: input.tasksPlanned,
		description: input.description,
		commissionRef: hashCommissionIdOrZero(input.commissionId),
		crewSize: input.crewSize,
	};
}

export function buildCheckinPayload(
	input: CheckinActivityInput,
): CheckinActivityPayload {
	validateCheckinActivity(input);
	const payload: CheckinActivityPayload = {};
	if (input.latitude !== undefined && input.longitude !== undefined) {
		payload.latitude = toMicrodegrees(input.latitude);
		payload.longitude = toMicrodegrees(input.longitude);
	}
	return payload;
}

export function buildCheckoutPayload(
	input: CheckoutActivityInput,
): CheckoutActivityPayload {
	validateCheckoutActivity(input);
	const payload: CheckoutActivityPayload = {};
	if (input.latitude !== undefined && input.longitude !== undefined) {
		payload.latitude = toMicrodegrees(input.latitude);
		payload.longitude = toMicrodegrees(input.longitude);
	}
	return payload;
}

export function buildReportPayload(
	input: ReportActivityInput,
): ReportActivityPayload {
	validateReportActivity(input);
	return {
		tasksCompleted: input.tasksCompleted,
		reportedEffort: input.reportedEffort,
		mediaHash: input.mediaHash,
		notes: input.notes,
	};
}

export function buildHealthcheckPayload(
	input: HealthcheckActivityInput,
): HealthcheckActivityPayload {
	validateHealthcheckActivity(input);
	const payload: HealthcheckActivityPayload = {
		healthScore: input.healthScore,
		mediaHash: input.mediaHash,
		notes: input.notes,
	};
	if (input.metadata !== undefined && input.metadata !== null) {
		payload.metadata = input.metadata;
	}
	return payload;
}

/**
 * Convenience: build a payload and compute its `payloadHash` in one call. The
 * hash is taken over the canonical-JSON serialization of the payload per
 * spec §9.8 (`hashActivityPayload` in `utils.ts`).
 *
 * Accepts `unknown` so callers can pass typed payload interfaces (e.g.
 * `ScheduleActivityPayload`) without an intermediate cast.
 */
export function encodeActivityFromPayload(
	type: ActivityType,
	payload: unknown,
): { data: string; payloadHash: string } {
	const payloadHash = hashActivityPayload(payload);
	const data = encodeActivityData(type, payloadHash);
	return { data, payloadHash };
}

// --- Decoders ---

interface DecodedField {
	name: string;
	value: { value: unknown } | unknown;
	type: string;
}

function getFieldValue(decoded: DecodedField[], name: string): unknown {
	const field = decoded.find((f) => f.name === name);
	if (!field) throw new Error(`Field "${name}" not found in decoded data`);
	const val = field.value;
	return typeof val === "object" && val !== null && "value" in val
		? (val as { value: unknown }).value
		: val;
}

function decodeSchema(schemaString: string, data: string): DecodedField[] {
	return newSchemaEncoder(schemaString).decodeData(
		data,
	) as unknown as DecodedField[];
}

export function decodeAreaRegistration(data: string) {
	const decoded = decodeSchema(SCHEMA_STRINGS.AreaRegistration, data);
	return {
		areaId: getFieldValue(decoded, "areaId") as string,
		latitude: fromMicrodegrees(Number(getFieldValue(decoded, "latitude"))),
		longitude: fromMicrodegrees(Number(getFieldValue(decoded, "longitude"))),
		areaType: Number(getFieldValue(decoded, "areaType")) as AreaType,
		name: getFieldValue(decoded, "name") as string,
		municipality: getFieldValue(decoded, "municipality") as string,
		boundariesHash: String(getFieldValue(decoded, "boundariesHash")),
		metadata: getFieldValue(decoded, "metadata") as string,
	};
}

export function decodeIntervention(data: string) {
	const decoded = decodeSchema(SCHEMA_STRINGS.Intervention, data);
	return {
		interventionId: getFieldValue(decoded, "interventionId") as string,
		interventionType: Number(
			getFieldValue(decoded, "interventionType"),
		) as InterventionType,
		executionDate: BigInt(String(getFieldValue(decoded, "executionDate"))),
		evidenceBundleHash: String(getFieldValue(decoded, "evidenceBundleHash")),
		commissionRef: String(getFieldValue(decoded, "commissionRef")),
	};
}

export function decodeGardenerMilestone(data: string) {
	const decoded = decodeSchema(SCHEMA_STRINGS.GardenerMilestone, data);
	return {
		milestoneLevel: Number(
			getFieldValue(decoded, "milestoneLevel"),
		) as MilestoneLevel,
		totalInterventions: Number(getFieldValue(decoded, "totalInterventions")),
		totalValidated: Number(getFieldValue(decoded, "totalValidated")),
		avgHealthImprovement: Number(
			getFieldValue(decoded, "avgHealthImprovement"),
		),
		achievedAt: BigInt(String(getFieldValue(decoded, "achievedAt"))),
		evidenceRoot: String(getFieldValue(decoded, "evidenceRoot")),
	};
}

export function decodeActivityData(data: string): {
	activityType: ActivityType;
	payloadHash: string;
} {
	const decoded = decodeSchema(SCHEMA_STRINGS.Activity, data);
	return {
		activityType: Number(
			getFieldValue(decoded, "activityType"),
		) as ActivityType,
		payloadHash: String(getFieldValue(decoded, "payloadHash")),
	};
}

/**
 * Parse easscan's `decodedDataJson` field (available on both on-chain and
 * off-chain attestations in the `attestations` GraphQL query) into the
 * Activity schema's typed fields.
 *
 * easscan emits `decodedDataJson` as a JSON string shaped like:
 * ```
 * [
 *   { "name": "activityType", "type": "uint8",
 *     "value": { "name": "activityType", "type": "uint8", "value": "1" } },
 *   { "name": "payloadHash", "type": "bytes32",
 *     "value": { "name": "payloadHash", "type": "bytes32", "value": "0x…" } },
 * ]
 * ```
 *
 * Using this over raw `data` lets the SDK treat on-chain and off-chain
 * activities uniformly: on-chain `data` is hex ABI bytes, while off-chain
 * `data` is the full offchain envelope JSON. `decodedDataJson` is always the
 * decoded ABI regardless of origin.
 */
export function parseActivityDecodedDataJson(decodedDataJson: string): {
	activityType: ActivityType;
	payloadHash: string;
} {
	const entries = JSON.parse(decodedDataJson) as Array<{
		name: string;
		value: { value: unknown };
	}>;
	const byName = new Map(entries.map((e) => [e.name, e.value.value]));
	const rawType = byName.get("activityType");
	const rawHash = byName.get("payloadHash");
	if (rawType === undefined || rawHash === undefined) {
		throw new Error(
			"decodedDataJson does not carry activityType + payloadHash",
		);
	}
	return {
		activityType: Number(rawType) as ActivityType,
		payloadHash: String(rawHash),
	};
}
