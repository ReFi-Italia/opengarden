export interface AreaRegistrationInput {
	areaId: string;
	latitude: number;
	longitude: number;
	areaType: number;
	name: string;
	municipality: string;
	metadataHash: string;
}

export interface PublishedInterventionInput {
	areaUID: string;
	interventionId: string;
	gardener: string;
	interventionType: number;
	executionDate: bigint;
	healthBefore: number;
	healthAfter: number;
	commissionRef: string;
	evidenceBundleHash: string;
	offchainCount: number;
	crewSize: number;
	isLead: boolean;
}

export interface GardenerMilestoneInput {
	recipient: string;
	milestoneLevel: number;
	totalInterventions: number;
	totalValidated: number;
	avgHealthImprovement: number;
	skillTier: string;
	achievedAt: bigint;
	evidenceRoot: string;
}

export interface ScheduledInterventionInput {
	areaUID: string;
	interventionId: string;
	interventionType: number;
	assignedGardener: string;
	crewSize: number;
	scheduledDate: bigint;
	estimatedMinutes: number;
	description: string;
	commissionRef: string;
}

export interface GardenerCheckinInput {
	interventionUID: string;
	latitude: number;
	longitude: number;
	timestamp: bigint;
	photoHash: string;
}

export interface GardenerCheckoutInput {
	checkinUID: string;
	timestamp: bigint;
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
	gardener: string;
	reportUID: string;
	approved: boolean;
	qualityScore: number;
	feedback: string;
	validatorId: string;
}

export interface CitizenFeedbackInput {
	areaUID: string;
	rating: number;
	comment: string;
	photoHash: string;
}

export interface HealthcheckInput {
	areaUID: string;
	interventionUID: string;
	healthScore: number;
	photoHash: string;
	assessorNotes: string;
	interventionNeeded: boolean;
	assessorId: string;
}
