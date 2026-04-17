import type { SponsorRef } from "../sponsor";
import type { AreaType, InterventionType, MilestoneLevel } from "./enums";

export interface AreaRegistrationInput {
	areaId: string;
	latitude: number;
	longitude: number;
	areaType: AreaType;
	name: string;
	municipality: string;
	/** IPFS CID / storage hash for extended metadata JSON; `null` for none. */
	metadataHash: string | null;
}

export interface PublishedInterventionInput {
	areaUID: string;
	interventionId: string;
	interventionType: InterventionType;
	executionDate: Date | bigint;
	healthBefore: number;
	healthAfter: number;
	/** Plain commissioning identifier, structured `SponsorRef`, or `null` for volunteer/unsponsored work. Hashed internally per spec §9.1; structured refs are canonicalized via `serializeSponsorRef` before hashing. */
	commissionId: string | SponsorRef | null;
	evidenceBundleHash: string;
	offchainCount: number;
	crewSize: number;
}

export interface GardenerMilestoneInput {
	recipient: string;
	milestoneLevel: MilestoneLevel;
	totalInterventions: number;
	totalValidated: number;
	avgHealthImprovement: number;
	skillTier: string;
	achievedAt: Date | bigint;
	evidenceRoot: string;
}

export interface ScheduledInterventionInput {
	areaUID: string;
	interventionId: string;
	interventionType: InterventionType;
	crewLead: string;
	crewSize: number;
	scheduledDate: Date | bigint;
	estimatedMinutes: number;
	description: string;
	/** Plain commissioning identifier, structured `SponsorRef`, or `null` for volunteer/unsponsored work. Must match the PublishedIntervention for the same job. Hashed internally per spec §9.1; structured refs are canonicalized via `serializeSponsorRef` before hashing. */
	commissionId: string | SponsorRef | null;
}

export interface GardenerCheckinInput {
	interventionUID: string;
	latitude: number;
	longitude: number;
	timestamp: Date | bigint;
	photoHash: string;
}

export interface GardenerCheckoutInput {
	checkinUID: string;
	timestamp: Date | bigint;
	actualMinutes: number;
}

export interface GardenerReportInput {
	interventionUID: string;
	checkoutUID: string;
	tasksCompleted: string;
	taskCount: number;
	photosHash: string;
	notes: string;
}

export interface AdminValidationInput {
	scheduleUID: string;
	approved: boolean;
	qualityScore: number;
	feedback: string;
	/** Plain staff identifier of the validating admin; `null` for organizational validation without individual attribution. Hashed internally per spec §9.1. */
	validatorId: string | null;
}

export interface CitizenFeedbackInput {
	areaUID: string;
	rating: number;
	comment: string;
	photoHash: string;
}

export interface HealthcheckInput {
	/** EAS UID of the linked ScheduledIntervention. `null` for standalone monitoring (encodes as ZERO_BYTES32). */
	interventionUID: string | null;
	healthScore: number;
	photoHash: string;
	/** Plain staff identifier of the assessing staff member; `null` for organizational assessment without individual attribution. Hashed internally per spec §9.1. */
	assessorId: string | null;
	/**
	 * Keccak256 of the off-chain metadata JSON. `null` encodes as ZERO_BYTES32.
	 * Metadata carries app-level fields: `baseline.score`, `baseline.sourceUID`,
	 * `assessorNotes`, `interventionNeeded`, etc.
	 */
	metadataHash: string | null;
}
