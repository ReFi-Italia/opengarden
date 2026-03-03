export enum AreaType {
	PublicGreenSpace = 0,
	PrivateGarden = 1,
	InstitutionalGrounds = 2,
	RoadsideMedian = 3,
}

export enum InterventionType {
	RoutineMaintenance = 0,
	Restoration = 1,
	Emergency = 2,
	Seasonal = 3,
	NewPlanting = 4,
}

export enum MilestoneLevel {
	Apprentice = 1,
	Gardener = 2,
	Senior = 3,
	Master = 4,
}

export type SchemaName =
	| "AreaRegistration"
	| "PublishedIntervention"
	| "GardenerMilestone"
	| "ScheduledIntervention"
	| "GardenerCheckin"
	| "GardenerCheckout"
	| "GardenerReport"
	| "AdminValidation"
	| "CitizenFeedback"
	| "Healthcheck";
