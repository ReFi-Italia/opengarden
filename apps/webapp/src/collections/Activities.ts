import type {
	CollectionAfterChangeHook,
	CollectionBeforeValidateHook,
	CollectionConfig,
} from "payload";
import { APIError } from "payload";
import { authenticated } from "../access/authenticated";
import { isAuthoringOrAbove } from "../access/isAuthoringOrAbove";

export const ACTIVITY_TYPES = [
	"checkin",
	"checkout",
	"report",
	"interventionHealthcheck",
	"areaHealthcheck",
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

const INTERVENTION_SCOPED_TYPES: readonly ActivityType[] = [
	"checkin",
	"checkout",
	"report",
	"interventionHealthcheck",
];
const AREA_SCOPED_TYPES: readonly ActivityType[] = ["areaHealthcheck"];

const TYPES_REQUIRING_GARDENER: readonly ActivityType[] = [
	"checkin",
	"checkout",
	"report",
];
const TYPES_REQUIRING_PARENT: readonly ActivityType[] = ["checkout", "report"];
const TYPES_REQUIRING_GEOLOCATION: readonly ActivityType[] = ["checkin"];
const TYPES_REQUIRING_DURATION: readonly ActivityType[] = ["checkout"];
const TYPES_REQUIRING_REPORT_BODY: readonly ActivityType[] = ["report"];
const TYPES_REQUIRING_HEALTHSCORE: readonly ActivityType[] = [
	"interventionHealthcheck",
	"areaHealthcheck",
];

/**
 * Enforces polymorphic parent (intervention XOR area per type) plus the
 * per-type required fields. Replaces the four separate beforeValidate
 * guards we used to have on GardenerCheckins/Checkouts/Reports/Healthchecks.
 */
const guardActivityInvariants: CollectionBeforeValidateHook = async ({
	data,
	req,
}) => {
	if (!data) return data;

	const type = data.type as ActivityType | undefined;
	if (!type) {
		throw new APIError("Activity is missing required field: type.", 400);
	}
	if (!ACTIVITY_TYPES.includes(type)) {
		throw new APIError(`Unknown activity type "${type}".`, 400);
	}

	// Parent XOR: intervention-scoped types need intervention, area-scoped
	// types need area. Exactly one parent per row.
	const hasIntervention = Boolean(data.intervention);
	const hasArea = Boolean(data.area);

	if (INTERVENTION_SCOPED_TYPES.includes(type)) {
		if (!hasIntervention) {
			throw new APIError(
				`Activity type "${type}" requires an intervention.`,
				400,
			);
		}
		// Confirm the intervention is in a state that accepts crew-field data.
		// Mirrors the old GardenerCheckins guard.
		const intervention = await req.payload.findByID({
			collection: "interventions",
			id: data.intervention as string | number,
			depth: 0,
			req,
		});
		const state = (intervention as { lifecycleStatus?: string })
			.lifecycleStatus;
		if (state !== "scheduled" && state !== "in_progress") {
			throw new APIError(
				`Cannot record a "${type}" against an intervention in state "${state}".`,
				409,
			);
		}

		// Verify the gardener is a member of the crew for crew-authored types.
		if (TYPES_REQUIRING_GARDENER.includes(type) && data.gardener) {
			const crew = (
				intervention as {
					crew?: {
						gardener?: string | number | { id?: string | number };
					}[];
				}
			).crew;
			const gardenerId = data.gardener;
			const inCrew = crew?.some((row) => {
				const g = row.gardener;
				if (g === gardenerId) return true;
				if (
					g &&
					typeof g === "object" &&
					"id" in g &&
					g.id === gardenerId
				) {
					return true;
				}
				return false;
			});
			if (!inCrew) {
				throw new APIError(
					"Gardener is not a member of this intervention's crew.",
					403,
				);
			}
		}
	}

	if (AREA_SCOPED_TYPES.includes(type)) {
		if (!hasArea) {
			throw new APIError(
				`Activity type "${type}" requires an area.`,
				400,
			);
		}
	}

	// Per-type required fields
	if (TYPES_REQUIRING_GARDENER.includes(type) && !data.gardener) {
		throw new APIError(
			`Activity type "${type}" requires a gardener.`,
			400,
		);
	}
	if (TYPES_REQUIRING_PARENT.includes(type) && !data.parentActivity) {
		throw new APIError(
			`Activity type "${type}" requires a parentActivity (its checkin / checkout).`,
			400,
		);
	}
	if (TYPES_REQUIRING_GEOLOCATION.includes(type)) {
		if (
			typeof data.latitude !== "number" ||
			typeof data.longitude !== "number"
		) {
			throw new APIError(
				`Activity type "${type}" requires latitude and longitude.`,
				400,
			);
		}
	}
	if (TYPES_REQUIRING_DURATION.includes(type)) {
		if (typeof data.actualMinutes !== "number") {
			throw new APIError(
				`Activity type "${type}" requires actualMinutes.`,
				400,
			);
		}
	}
	if (TYPES_REQUIRING_REPORT_BODY.includes(type)) {
		if (
			typeof data.tasksCompleted !== "string" ||
			typeof data.taskCount !== "number"
		) {
			throw new APIError(
				`Activity type "${type}" requires tasksCompleted and taskCount.`,
				400,
			);
		}
	}
	if (TYPES_REQUIRING_HEALTHSCORE.includes(type)) {
		if (typeof data.healthScore !== "number") {
			throw new APIError(
				`Activity type "${type}" requires healthScore.`,
				400,
			);
		}
		if (type === "interventionHealthcheck" && !data.kind) {
			throw new APIError(
				'Activity type "interventionHealthcheck" requires kind ("before" or "after").',
				400,
			);
		}
	}

	return data;
};

/**
 * On insert, queue the unified `commitActivityChain` task to commit the
 * off-chain attestation and write the Attestations row + relationship
 * back on the activity. Best-effort drain via Next's `after()`.
 */
const queueChainCommit: CollectionAfterChangeHook = async ({
	doc,
	operation,
	req,
}) => {
	if (operation !== "create") return doc;
	if ((doc as { attestation?: unknown }).attestation) return doc;

	try {
		await req.payload.jobs.queue({
			task: "commitActivityChain",
			input: { activityId: String((doc as { id: string | number }).id) },
			queue: "default",
		});
		const { after } = await import("next/server");
		after(async () => {
			try {
				await req.payload.jobs.run({ queue: "default", limit: 1 });
			} catch (err) {
				req.payload.logger.error({
					msg: "queueChainCommit (commitActivityChain): drain failed — cron fallback",
					err: err instanceof Error ? err.message : String(err),
				});
			}
		});
	} catch (err) {
		req.payload.logger.error({
			msg: "Failed to queue commitActivityChain on activity create",
			err: err instanceof Error ? err.message : String(err),
		});
	}
	return doc;
};

// Conditional visibility helpers for admin.condition
const showWhenType =
	(allowed: readonly ActivityType[]) =>
	(_data: unknown, siblingData: unknown) => {
		const t = (siblingData as { type?: string })?.type;
		return typeof t === "string" && (allowed as readonly string[]).includes(t);
	};

export const Activities: CollectionConfig = {
	slug: "activities",
	admin: {
		group: "Lifecycle",
		hidden: true,
		useAsTitle: "id",
		defaultColumns: ["type", "intervention", "area", "claimedTimestamp"],
	},
	access: {
		read: authenticated,
		create: isAuthoringOrAbove,
		update: isAuthoringOrAbove,
		delete: isAuthoringOrAbove,
	},
	hooks: {
		beforeValidate: [guardActivityInvariants],
		afterChange: [queueChainCommit],
	},
	fields: [
		{
			name: "type",
			type: "select",
			required: true,
			index: true,
			options: ACTIVITY_TYPES.map((value) => ({ label: value, value })),
		},
		{
			name: "intervention",
			type: "relationship",
			relationTo: "interventions",
			index: true,
			admin: { condition: showWhenType(INTERVENTION_SCOPED_TYPES) },
		},
		{
			name: "area",
			type: "relationship",
			relationTo: "areas",
			index: true,
			admin: { condition: showWhenType(AREA_SCOPED_TYPES) },
		},
		{
			name: "parentActivity",
			type: "relationship",
			relationTo: "activities",
			admin: { condition: showWhenType(TYPES_REQUIRING_PARENT) },
		},
		{
			name: "gardener",
			type: "relationship",
			relationTo: "gardeners",
			admin: { condition: showWhenType(TYPES_REQUIRING_GARDENER) },
		},
		{
			name: "claimedTimestamp",
			type: "date",
			required: true,
		},
		{
			name: "latitude",
			type: "number",
			min: -90,
			max: 90,
			admin: { condition: showWhenType(TYPES_REQUIRING_GEOLOCATION) },
		},
		{
			name: "longitude",
			type: "number",
			min: -180,
			max: 180,
			admin: { condition: showWhenType(TYPES_REQUIRING_GEOLOCATION) },
		},
		{
			name: "actualMinutes",
			type: "number",
			min: 0,
			admin: { condition: showWhenType(TYPES_REQUIRING_DURATION) },
		},
		{
			name: "tasksCompleted",
			type: "text",
			admin: { condition: showWhenType(TYPES_REQUIRING_REPORT_BODY) },
		},
		{
			name: "taskCount",
			type: "number",
			min: 0,
			admin: { condition: showWhenType(TYPES_REQUIRING_REPORT_BODY) },
		},
		{
			name: "notes",
			type: "textarea",
			admin: { condition: showWhenType(TYPES_REQUIRING_REPORT_BODY) },
		},
		{
			name: "kind",
			type: "select",
			options: [
				{ label: "before", value: "before" },
				{ label: "after", value: "after" },
			],
			admin: { condition: showWhenType(["interventionHealthcheck"]) },
		},
		{
			name: "healthScore",
			type: "number",
			min: 0,
			max: 10,
			admin: { condition: showWhenType(TYPES_REQUIRING_HEALTHSCORE) },
		},
		{
			name: "assessor",
			type: "relationship",
			relationTo: "staff",
			admin: { condition: showWhenType(TYPES_REQUIRING_HEALTHSCORE) },
		},
		{
			name: "assessorNotes",
			type: "textarea",
			admin: { condition: showWhenType(TYPES_REQUIRING_HEALTHSCORE) },
		},
		{
			name: "photo",
			type: "upload",
			relationTo: "media",
		},
		{
			name: "photoHash",
			type: "text",
			admin: {
				readOnly: true,
			},
		},
		{
			name: "attestation",
			type: "relationship",
			relationTo: "attestations",
			admin: { readOnly: true },
		},
	],
};
