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
	/** UID of the AreaRegistration attestation this intervention belongs to. Carried as the EAS `refUID` slot on the on-chain attestation, not encoded in schema data. */
	areaUID: string;
	interventionId: string;
	interventionType: InterventionType;
	executionDate: Date | bigint;
	/** Plain commissioning identifier, structured `SponsorRef`, or `null` for volunteer/unsponsored work. Hashed internally per spec §9.1; structured refs are canonicalized via `serializeSponsorRef` before hashing. */
	commissionId: string | SponsorRef | null;
	evidenceBundleHash: string;
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
	/** UID of the AreaRegistration attestation this schedule belongs to. Carried as the EAS `refUID` slot, not encoded in schema data. */
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
	/** UID of the ScheduledIntervention this checkin belongs to. Carried as the EAS `refUID` slot, not encoded in schema data. */
	interventionUID: string;
	latitude: number;
	longitude: number;
	timestamp: Date | bigint;
	photoHash: string;
}

export interface GardenerCheckoutInput {
	/** UID of the matching GardenerCheckin for this crew member. Carried as the EAS `refUID` slot, not encoded in schema data. */
	checkinUID: string;
	timestamp: Date | bigint;
	actualMinutes: number;
}

export interface GardenerReportInput {
	/** UID of the ScheduledIntervention this report belongs to. Carried as the EAS `refUID` slot, not encoded in schema data. */
	interventionUID: string;
	/** UID of this crew member's GardenerCheckout. Carried as a schema field since EAS only exposes one `refUID` slot. */
	checkoutUID: string;
	tasksCompleted: string;
	taskCount: number;
	photosHash: string;
	notes: string;
}

export interface HealthcheckInput {
	/** UID of the AreaRegistration attestation this healthcheck belongs to. Carried as the EAS `refUID` slot, not encoded in schema data. */
	areaUID: string;
	/** 1-10, where 10 is best. */
	healthScore: number;
	photoHash: string;
	notes: string;
	/** Free-form JSON string for app-specific extras. Empty string for none. */
	metadata: string;
}
