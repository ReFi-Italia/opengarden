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
		"bytes32 areaUID, string interventionId, uint8 interventionType, uint64 executionDate, uint8 healthBefore, uint8 healthAfter, bytes32 commissionRef, bytes32 evidenceBundleHash, uint8 offchainCount, uint8 crewSize",
	GardenerMilestone:
		"uint8 milestoneLevel, uint16 totalInterventions, uint16 totalValidated, uint8 avgHealthImprovement, string skillTier, uint64 achievedAt, bytes32 evidenceRoot",
	ScheduledIntervention:
		"bytes32 areaUID, string interventionId, uint8 interventionType, uint64 scheduledDate, uint16 estimatedMinutes, string description, bytes32 commissionRef, uint8 crewSize",
	GardenerCheckin:
		"bytes32 interventionUID, int32 latitude, int32 longitude, uint64 timestamp, bytes32 photoHash",
	GardenerCheckout:
		"bytes32 checkinUID, uint64 timestamp, uint16 actualMinutes",
	GardenerReport:
		"bytes32 interventionUID, bytes32 checkoutUID, string tasksCompleted, uint8 taskCount, bytes32 photosHash, string notes",
	AdminValidation:
		"bytes32 scheduleUID, bool approved, uint8 qualityScore, string feedback, bytes32 validatorId",
	CitizenFeedback:
		"bytes32 areaUID, uint8 rating, string comment, bytes32 photoHash",
	Healthcheck:
		"bytes32 interventionUID, uint8 healthScore, bytes32 photoHash, bytes32 assessorId, bytes32 metadataHash",
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
	AdminValidation: {
		schema: SCHEMA_STRINGS.AdminValidation,
		revocable: true,
		onchain: false,
		timestamped: true,
	},
	CitizenFeedback: {
		schema: SCHEMA_STRINGS.CitizenFeedback,
		revocable: false,
		onchain: false,
		timestamped: false,
	},
	Healthcheck: {
		schema: SCHEMA_STRINGS.Healthcheck,
		revocable: false,
		onchain: false,
		timestamped: true,
	},
};
