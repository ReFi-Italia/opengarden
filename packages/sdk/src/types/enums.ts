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

/**
 * Activity discriminator for the polymorphic off-chain Activity schema.
 * See spec §3.1. Values `0` and `6-127` are reserved for future protocol
 * versions; `128-255` are application-specific and verifiers MUST ignore
 * unknown values.
 */
export enum ActivityType {
	Unspecified = 0,
	Schedule = 1,
	Checkin = 2,
	Checkout = 3,
	Report = 4,
	Healthcheck = 5,
}

export const ACTIVITY_TYPE_NAMES = {
	[ActivityType.Unspecified]: "unspecified",
	[ActivityType.Schedule]: "schedule",
	[ActivityType.Checkin]: "checkin",
	[ActivityType.Checkout]: "checkout",
	[ActivityType.Report]: "report",
	[ActivityType.Healthcheck]: "healthcheck",
} as const;

export type ActivityTypeName =
	(typeof ACTIVITY_TYPE_NAMES)[keyof typeof ACTIVITY_TYPE_NAMES];

export function activityTypeFromName(name: ActivityTypeName): ActivityType {
	switch (name) {
		case "unspecified":
			return ActivityType.Unspecified;
		case "schedule":
			return ActivityType.Schedule;
		case "checkin":
			return ActivityType.Checkin;
		case "checkout":
			return ActivityType.Checkout;
		case "report":
			return ActivityType.Report;
		case "healthcheck":
			return ActivityType.Healthcheck;
	}
}

export type SchemaName =
	| "AreaRegistration"
	| "Intervention"
	| "GardenerMilestone"
	| "Activity";
