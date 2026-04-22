import type { SchemaName } from "../types/enums";

export interface SchemaDefinition {
	schema: string;
	revocable: boolean;
	onchain: boolean;
	timestamped: boolean;
}

export const SCHEMA_STRINGS: Record<SchemaName, string> = {
	AreaRegistration:
		"string areaId, int32 latitude, int32 longitude, uint8 areaType, string name, string municipality, bytes32 boundariesHash, string metadata",
	Intervention:
		"string interventionId, uint8 interventionType, uint64 executionDate, bytes32 evidenceBundleHash, bytes32 commissionRef",
	GardenerMilestone:
		"uint8 milestoneLevel, uint16 totalInterventions, uint16 totalValidated, uint8 avgHealthImprovement, uint64 achievedAt, bytes32 evidenceRoot",
	Activity: "uint8 activityType, bytes32 payloadHash",
};

export const SCHEMA_DEFINITIONS: Record<SchemaName, SchemaDefinition> = {
	AreaRegistration: {
		schema: SCHEMA_STRINGS.AreaRegistration,
		revocable: false,
		onchain: true,
		timestamped: false,
	},
	Intervention: {
		schema: SCHEMA_STRINGS.Intervention,
		revocable: false,
		onchain: true,
		timestamped: false,
	},
	GardenerMilestone: {
		schema: SCHEMA_STRINGS.GardenerMilestone,
		revocable: false,
		onchain: true,
		timestamped: false,
	},
	// Registered `revocable: true` so schedule Activities can be revoked during
	// cancel/reschedule. Checkin/checkout/report/healthcheck are never revoked
	// in practice — a verifier policy MAY reject bundles containing revoked
	// entries of those types. See spec §8.
	Activity: {
		schema: SCHEMA_STRINGS.Activity,
		revocable: true,
		onchain: false,
		timestamped: true,
	},
};
