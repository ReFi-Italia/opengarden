import type { VerificationCheck } from "../verification";
import type { AreaType, InterventionType, MilestoneLevel } from "./enums";

export interface ScheduledIntervention {
	uid: string;
	/** Sourced from the EAS `refUID` slot of the signed attestation, not from schema data. */
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
	/** Sourced from the EAS `refUID` slot of the signed attestation, not from schema data. */
	areaUID: string;
	healthScore: number;
	photoHash: string;
	notes: string;
	/** Free-form JSON string for app-specific extras. Empty string for none. */
	metadata: string;
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
	/** Sourced from the EAS `refUID` slot of the on-chain attestation, not from schema data. */
	areaUID: string;
	interventionId: string;
	interventionType: InterventionType;
	executionDate: bigint;
	commissionRef: string;
	evidenceBundleHash: string;
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
	/** Protocol tier — every signed attestation's EIP-712 signature recovers to its claimed signer. */
	signaturesValid: boolean;
	/** Protocol tier — bundle's on-chain timestamps match `EAS.getTimestamp`. */
	timestampsVerified: boolean;
	/** Policy tier — every entry's `refUID` points at the expected parent (area / schedule / checkin). */
	refUIDsValid: boolean;
	/** Policy tier — strict `T_scheduled < T_checkin < T_checkout < T_report` ordering. */
	temporalOrderValid: boolean;
	/** Policy tier — `executionDate` sits between scheduled and publication timestamps. */
	executionDateBracketed: boolean;
	/** Flat per-check breakdown, in the order the SDK runs them. Useful for rendering "X of N integrity checks passed" UX. */
	checks: VerificationCheck[];
}
