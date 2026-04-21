import type { SchemaName } from "../types/enums";

export interface SchemaDefinition {
	schema: string;
	revocable: boolean;
	onchain: boolean;
	timestamped: boolean;
}

export const SCHEMA_STRINGS: Record<SchemaName, string> = {
	AreaRegistration:
		"string areaId, int32 latitude, int32 longitude, uint8 areaType, string name, string municipality, bytes32 metadataHash",
	PublishedIntervention:
		"string interventionId, uint8 interventionType, uint64 executionDate, bytes32 evidenceBundleHash, bytes32 commissionRef",
	GardenerMilestone:
		"uint8 milestoneLevel, uint16 totalInterventions, uint16 totalValidated, uint8 avgHealthImprovement, string skillTier, uint64 achievedAt, bytes32 evidenceRoot",
	ScheduledIntervention:
		"string interventionId, uint8 interventionType, uint64 scheduledDate, uint16 estimatedMinutes, string description, bytes32 commissionRef, uint8 crewSize",
	GardenerCheckin:
		"int32 latitude, int32 longitude, uint64 timestamp, bytes32 photoHash",
	GardenerCheckout: "uint64 timestamp, uint16 actualMinutes",
	GardenerReport:
		"bytes32 checkoutUID, string tasksCompleted, uint8 taskCount, bytes32 photosHash, string notes",
	Healthcheck:
		"uint8 healthScore, bytes32 photoHash, string notes, string metadata",
};

export const SCHEMA_DEFINITIONS: Record<SchemaName, SchemaDefinition> = {
	AreaRegistration: {
		schema: SCHEMA_STRINGS.AreaRegistration,
		revocable: false,
		onchain: true,
		timestamped: false,
	},
	PublishedIntervention: {
		schema: SCHEMA_STRINGS.PublishedIntervention,
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
	ScheduledIntervention: {
		schema: SCHEMA_STRINGS.ScheduledIntervention,
		revocable: true,
		onchain: false,
		timestamped: true,
	},
	GardenerCheckin: {
		schema: SCHEMA_STRINGS.GardenerCheckin,
		revocable: false,
		onchain: false,
		timestamped: true,
	},
	GardenerCheckout: {
		schema: SCHEMA_STRINGS.GardenerCheckout,
		revocable: false,
		onchain: false,
		timestamped: true,
	},
	GardenerReport: {
		schema: SCHEMA_STRINGS.GardenerReport,
		revocable: false,
		onchain: false,
		timestamped: true,
	},
	Healthcheck: {
		schema: SCHEMA_STRINGS.Healthcheck,
		revocable: false,
		onchain: false,
		timestamped: true,
	},
};
