export enum AreaType {
	Unspecified = 0,
	PublicGreenSpace = 1,
	PrivateGarden = 2,
	InstitutionalGrounds = 3,
	RoadsideMedian = 4,
}

export enum InterventionType {
	Unspecified = 0,
	RoutineMaintenance = 1,
	Restoration = 2,
	Emergency = 3,
	Seasonal = 4,
	NewPlanting = 5,
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
	| "Healthcheck";
