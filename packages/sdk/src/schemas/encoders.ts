import type { SchemaEncoder as SchemaEncoderType } from "@ethereum-attestation-service/eas-sdk";
import { ZERO_BYTES32 } from "../constants";
import { type SponsorRef, serializeSponsorRef } from "../sponsor";
import type {
	AreaType,
	InterventionType,
	MilestoneLevel,
} from "../types/enums";
import type {
	AreaRegistrationInput,
	GardenerCheckinInput,
	GardenerCheckoutInput,
	GardenerMilestoneInput,
	GardenerReportInput,
	HealthcheckInput,
	PublishedInterventionInput,
	ScheduledInterventionInput,
} from "../types/schemas";
import {
	fromMicrodegrees,
	hashIdentifier,
	toMicrodegrees,
	toUnixSeconds,
} from "../utils";
import { SCHEMA_STRINGS } from "./definitions";
import {
	validateAreaRegistration,
	validateGardenerCheckin,
	validateGardenerCheckout,
	validateGardenerMilestone,
	validateGardenerReport,
	validateHealthcheck,
	validatePublishedIntervention,
	validateScheduledIntervention,
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

// --- Encoders ---

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
			name: "metadataHash",
			value: input.metadataHash ?? ZERO_BYTES32,
			type: "bytes32",
		},
	]);
}

export function encodePublishedIntervention(
	input: PublishedInterventionInput,
): string {
	validatePublishedIntervention(input);
	const encoder = newSchemaEncoder(SCHEMA_STRINGS.PublishedIntervention);
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
		{ name: "skillTier", value: input.skillTier, type: "string" },
		{
			name: "achievedAt",
			value: toUnixSeconds(input.achievedAt),
			type: "uint64",
		},
		{ name: "evidenceRoot", value: input.evidenceRoot, type: "bytes32" },
	]);
}

export function encodeScheduledIntervention(
	input: ScheduledInterventionInput,
): string {
	validateScheduledIntervention(input);
	const encoder = newSchemaEncoder(SCHEMA_STRINGS.ScheduledIntervention);
	return encoder.encodeData([
		{ name: "interventionId", value: input.interventionId, type: "string" },
		{ name: "interventionType", value: input.interventionType, type: "uint8" },
		{
			name: "scheduledDate",
			value: toUnixSeconds(input.scheduledDate),
			type: "uint64",
		},
		{ name: "estimatedMinutes", value: input.estimatedMinutes, type: "uint16" },
		{ name: "description", value: input.description, type: "string" },
		{
			name: "commissionRef",
			value: hashCommissionIdOrZero(input.commissionId),
			type: "bytes32",
		},
		{ name: "crewSize", value: input.crewSize, type: "uint8" },
	]);
}

export function encodeGardenerCheckin(input: GardenerCheckinInput): string {
	validateGardenerCheckin(input);
	const encoder = newSchemaEncoder(SCHEMA_STRINGS.GardenerCheckin);
	return encoder.encodeData([
		{ name: "latitude", value: toMicrodegrees(input.latitude), type: "int32" },
		{
			name: "longitude",
			value: toMicrodegrees(input.longitude),
			type: "int32",
		},
		{
			name: "timestamp",
			value: toUnixSeconds(input.timestamp),
			type: "uint64",
		},
		{ name: "photoHash", value: input.photoHash, type: "bytes32" },
	]);
}

export function encodeGardenerCheckout(input: GardenerCheckoutInput): string {
	validateGardenerCheckout(input);
	const encoder = newSchemaEncoder(SCHEMA_STRINGS.GardenerCheckout);
	return encoder.encodeData([
		{
			name: "timestamp",
			value: toUnixSeconds(input.timestamp),
			type: "uint64",
		},
		{ name: "actualMinutes", value: input.actualMinutes, type: "uint16" },
	]);
}

export function encodeGardenerReport(input: GardenerReportInput): string {
	validateGardenerReport(input);
	const encoder = newSchemaEncoder(SCHEMA_STRINGS.GardenerReport);
	return encoder.encodeData([
		{ name: "checkoutUID", value: input.checkoutUID, type: "bytes32" },
		{ name: "tasksCompleted", value: input.tasksCompleted, type: "string" },
		{ name: "taskCount", value: input.taskCount, type: "uint8" },
		{ name: "photosHash", value: input.photosHash, type: "bytes32" },
		{ name: "notes", value: input.notes, type: "string" },
	]);
}

export function encodeHealthcheck(input: HealthcheckInput): string {
	validateHealthcheck(input);
	const encoder = newSchemaEncoder(SCHEMA_STRINGS.Healthcheck);
	return encoder.encodeData([
		{ name: "healthScore", value: input.healthScore, type: "uint8" },
		{ name: "photoHash", value: input.photoHash, type: "bytes32" },
		{ name: "notes", value: input.notes, type: "string" },
		{ name: "metadata", value: input.metadata, type: "string" },
	]);
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
		metadataHash: String(getFieldValue(decoded, "metadataHash")),
	};
}

export function decodePublishedIntervention(data: string) {
	const decoded = decodeSchema(SCHEMA_STRINGS.PublishedIntervention, data);
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
		skillTier: getFieldValue(decoded, "skillTier") as string,
		achievedAt: BigInt(String(getFieldValue(decoded, "achievedAt"))),
		evidenceRoot: String(getFieldValue(decoded, "evidenceRoot")),
	};
}

export function decodeScheduledIntervention(data: string) {
	const decoded = decodeSchema(SCHEMA_STRINGS.ScheduledIntervention, data);
	return {
		interventionId: getFieldValue(decoded, "interventionId") as string,
		interventionType: Number(
			getFieldValue(decoded, "interventionType"),
		) as InterventionType,
		scheduledDate: BigInt(String(getFieldValue(decoded, "scheduledDate"))),
		estimatedMinutes: Number(getFieldValue(decoded, "estimatedMinutes")),
		description: getFieldValue(decoded, "description") as string,
		commissionRef: String(getFieldValue(decoded, "commissionRef")),
		crewSize: Number(getFieldValue(decoded, "crewSize")),
	};
}

export function decodeHealthcheck(data: string) {
	const decoded = decodeSchema(SCHEMA_STRINGS.Healthcheck, data);
	return {
		healthScore: Number(getFieldValue(decoded, "healthScore")),
		photoHash: String(getFieldValue(decoded, "photoHash")),
		notes: getFieldValue(decoded, "notes") as string,
		metadata: getFieldValue(decoded, "metadata") as string,
	};
}
