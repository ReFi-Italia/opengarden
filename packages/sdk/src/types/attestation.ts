import type { AreaType, InterventionType, MilestoneLevel } from "./enums";

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
}
