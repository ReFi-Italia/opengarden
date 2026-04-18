import { AreaType, InterventionType } from "@refi-italia/opengarden";
import type { Payload } from "payload";

export const uniqueId = (prefix: string) =>
	`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const createArea = (payload: Payload, overrides: Record<string, unknown> = {}) =>
	payload.create({
		collection: "areas",
		data: {
			areaId: uniqueId("AREA"),
			name: "Test area",
			municipality: "Roma",
			areaType: String(AreaType.PublicGreenSpace) as "1",
			coordinates: [12.5, 41.9] as [number, number],
			lifecycleStatus: "registered",
			...overrides,
		} as never,
	});

export const createSponsor = (payload: Payload, overrides: Record<string, unknown> = {}) =>
	payload.create({
		collection: "sponsors",
		data: {
			displayName: "Test Sponsor",
			kind: "municipal",
			canonicalKey: { contractNumber: uniqueId("CT") },
			...overrides,
		} as never,
	});

export const createGardener = (payload: Payload, overrides: Record<string, unknown> = {}) =>
	payload.create({
		collection: "gardeners",
		data: {
			displayName: "Test Gardener",
			status: "active",
			...overrides,
		} as never,
	});

export const createStaff = (payload: Payload, overrides: Record<string, unknown> = {}) =>
	payload.create({
		collection: "staff",
		data: {
			displayName: "Test Staff",
			staffId: uniqueId("STAFF"),
			capabilities: ["validator"],
			...overrides,
		} as never,
	});

type CrewMember = { gardener: string | number; isCrewLead: boolean };

export const createIntervention = (
	payload: Payload,
	{
		areaId,
		sponsorId,
		crew,
		...overrides
	}: {
		areaId: string | number;
		sponsorId: string | number;
		crew: CrewMember[];
		[k: string]: unknown;
	},
) =>
	payload.create({
		collection: "interventions",
		data: {
			interventionId: uniqueId("INT"),
			area: areaId,
			interventionType: String(InterventionType.RoutineMaintenance) as "1",
			description: "Test intervention",
			commissioning: { sponsor: sponsorId },
			crew,
			lifecycleStatus: "draft",
			...overrides,
		} as never,
	});

export const advanceToInProgress = async (
	payload: Payload,
	interventionId: string | number,
) => {
	await payload.update({
		collection: "interventions",
		id: interventionId,
		data: { lifecycleStatus: "scheduled" },
		context: { skipLifecycleHooks: true },
	});
	await payload.update({
		collection: "interventions",
		id: interventionId,
		data: { lifecycleStatus: "in_progress" },
		context: { skipLifecycleHooks: true },
	});
};
