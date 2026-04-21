import type { SponsorRef } from "../sponsor";
import type { AreaType, InterventionType, MilestoneLevel } from "./enums";

export interface AreaRegistrationInput {
	areaId: string;
	latitude: number;
	longitude: number;
	areaType: AreaType;
	name: string;
	municipality: string;
	/**
	 * Content-addressable hash (IPFS CID / storage adapter hash) of a large
	 * boundary payload — polygon GeoJSON, photo bundle, etc. `null` if the
	 * organization has no boundary data for this area (encoded as ZERO_BYTES32).
	 */
	boundariesHash: string | null;
	/**
	 * Small inline JSON escape hatch for app-specific extras (surface area,
	 * access hours, institutional labels). Empty string for none. SHOULD stay
	 * under the 512-byte budget documented in spec §9.6; the SDK does not
	 * enforce it.
	 */
	metadata: string;
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
	photoHash: string;
	/**
	 * Signer's claim of when the checkin happened (Unix seconds or `Date`).
	 * Written into the EIP-712 envelope's `message.time`. Omit to use the
	 * current wall-clock at sign time (only correct when signing happens at
	 * the moment of checkin; for server-side signing on later upload, pass
	 * the device-recorded moment here so the envelope reflects the claim,
	 * not the upload time).
	 */
	time?: Date | bigint;
}

export interface GardenerCheckoutInput {
	/** UID of the matching GardenerCheckin for this crew member. Carried as the EAS `refUID` slot, not encoded in schema data. */
	checkinUID: string;
	actualMinutes: number;
	/** See `GardenerCheckinInput.time`. */
	time?: Date | bigint;
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
