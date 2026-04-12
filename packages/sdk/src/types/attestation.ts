import type { AreaType, InterventionType, MilestoneLevel } from "./enums";
import type { VerificationCheck } from "../verification";

export interface ScheduledIntervention {
	uid: string;
	areaUID: string;
	interventionId: string;
	interventionType: InterventionType;
	scheduledDate: bigint;
	estimatedMinutes: number;
	description: string;
	/** On-chain bytes32 hash of the commissioning identifier (or ZERO_BYTES32 for volunteer work). */
	commissionRef: string;
	crewSize: number;
	attester: string;
	/** Crew lead wallet (or ZERO_ADDRESS for unassigned schedules). */
	recipient: string;
	time: bigint;
}

export interface Healthcheck {
	uid: string;
	areaUID: string;
	/** UID of the linked ScheduledIntervention, or ZERO_BYTES32 for standalone monitoring. */
	interventionUID: string;
	healthScore: number;
	photoHash: string;
	assessorNotes: string;
	interventionNeeded: boolean;
	/** On-chain bytes32 hash of the assessor staff identifier (or ZERO_BYTES32 for organizational attribution). */
	assessorId: string;
	attester: string;
	time: bigint;
}

export interface CitizenFeedback {
	uid: string;
	areaUID: string;
	rating: number;
	comment: string;
	photoHash: string;
	attester: string;
	time: bigint;
}

export interface Area {
	uid: string;
	areaId: string;
	latitude: number;
	longitude: number;
	areaType: AreaType;
	name: string;
	municipality: string;
	metadataHash: string;
	attester: string;
	time: bigint;
}

export interface Intervention {
	uid: string;
	areaUID: string;
	interventionId: string;
	interventionType: InterventionType;
	executionDate: bigint;
	healthBefore: number;
	healthAfter: number;
	commissionRef: string;
	evidenceBundleHash: string;
	offchainCount: number;
	crewSize: number;
	attester: string;
	recipient: string;
	time: bigint;
}

export interface Milestone {
	uid: string;
	milestoneLevel: MilestoneLevel;
	totalInterventions: number;
	totalValidated: number;
	avgHealthImprovement: number;
	skillTier: string;
	achievedAt: bigint;
	evidenceRoot: string;
	recipient: string;
	attester: string;
	time: bigint;
}

export interface EvidenceBundleVerification {
	valid: boolean;
	attestationCount: number;
	expectedCount: number;
	temporalOrderValid: boolean;
	timestampsVerified: boolean;
	healthcheckOrderValid: boolean;
	executionDateBracketed: boolean;
	validationApproved: boolean;
	/** Flat per-check breakdown, in the order the SDK runs them. Useful for rendering "X of N integrity checks passed" UX. */
	checks: VerificationCheck[];
}
