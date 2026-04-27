import type {
	CollectionAfterChangeHook,
	CollectionBeforeChangeHook,
	CollectionBeforeValidateHook,
	CollectionConfig,
} from "payload";
import { APIError } from "payload";
import { after } from "next/server";
import { authenticated } from "../access/authenticated";

export const ACTIVITY_TYPES = [
	"schedule",
	"checkin",
	"checkout",
	"report",
	"healthcheck",
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

const INTERVENTION_SCOPED_TYPES: readonly ActivityType[] = [
	"schedule",
	"checkin",
	"checkout",
	"report",
];

const TYPES_REQUIRING_GARDENER: readonly ActivityType[] = [
	"checkin",
	"checkout",
	"report",
];

const TYPES_REQUIRING_HEALTHSCORE: readonly ActivityType[] = ["healthcheck"];

// Healthchecks can omit `area` when a linked intervention resolves one.
// Spec §3.2.5 makes healthchecks area-scoped — the area UID is the refUID.
// Running before the invariants guard so the missing-area check passes when
// an intervention was provided.
const deriveHealthcheckArea: CollectionBeforeValidateHook = async ({
	data,
	req,
}) => {
	if (!data) return data;
	if (data.type !== "healthcheck") return data;
	if (data.area || !data.intervention) return data;

	const intervention = await req.payload
		.findByID({
			collection: "interventions",
			id: data.intervention as string | number,
			depth: 1,
			req,
			overrideAccess: true,
		})
		.catch(() => null);
	const areaRef = (intervention as { area?: unknown } | null)?.area;
	if (areaRef) {
		data.area =
			typeof areaRef === "object" && areaRef !== null && "id" in areaRef
				? (areaRef as { id: unknown }).id
				: areaRef;
	}
	return data;
};

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

	const hasIntervention = Boolean(data.intervention);
	const hasArea = Boolean(data.area);
	const dataObj = (data.data ?? {}) as Record<string, unknown>;

	if (INTERVENTION_SCOPED_TYPES.includes(type)) {
		if (!hasIntervention) {
			throw new APIError(
				`Activity type "${type}" requires an intervention.`,
				400,
			);
		}
		const intervention = await req.payload.findByID({
			collection: "interventions",
			id: data.intervention as string | number,
			depth: 0,
			req,
		});
		const state = (intervention as { lifecycleStatus?: string })
			.lifecycleStatus;

		// schedule is created exactly when transitioning draft → scheduled.
		// checkin/checkout/report require the intervention to be in the active
		// window (scheduled or in_progress).
		if (type === "schedule") {
			if (state !== "draft" && state !== "scheduled") {
				throw new APIError(
					`Cannot record a "schedule" activity against an intervention in state "${state}".`,
					409,
				);
			}
		} else if (state !== "scheduled" && state !== "in_progress") {
			throw new APIError(
				`Cannot record a "${type}" against an intervention in state "${state}".`,
				409,
			);
		}

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
				if (g && typeof g === "object" && "id" in g && g.id === gardenerId) {
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

		if (type === "report") {
			const tasksCompleted = dataObj.tasksCompleted;
			if (!Array.isArray(tasksCompleted)) {
				throw new APIError(
					'Activity type "report" requires data.tasksCompleted (array of task codes).',
					400,
				);
			}
			if (typeof dataObj.reportedEffort !== "number") {
				throw new APIError(
					'Activity type "report" requires data.reportedEffort (minutes).',
					400,
				);
			}
			const validCodes = new Set<string>(
				((intervention as { tasks?: { code?: string }[] }).tasks ?? [])
					.map((t) => t.code)
					.filter((c): c is string => typeof c === "string"),
			);
			for (const code of tasksCompleted as string[]) {
				if (!validCodes.has(code)) {
					throw new APIError(
						`Task code "${code}" does not exist on this intervention.`,
						400,
					);
				}
			}
		}

		if (type === "schedule") {
			if (!Array.isArray(dataObj.tasksPlanned)) {
				throw new APIError(
					'Activity type "schedule" requires data.tasksPlanned (array of task codes).',
					400,
				);
			}
			if (typeof dataObj.plannedDuration !== "number") {
				throw new APIError(
					'Activity type "schedule" requires data.plannedDuration (minutes).',
					400,
				);
			}
			if (typeof dataObj.crewSize !== "number") {
				throw new APIError(
					'Activity type "schedule" requires data.crewSize.',
					400,
				);
			}
		}
	}

	if (type === "healthcheck") {
		if (!hasArea) {
			throw new APIError(
				'Activity type "healthcheck" requires an area. Provide one explicitly, or link an intervention whose area is set.',
				400,
			);
		}
	}

	if (TYPES_REQUIRING_GARDENER.includes(type) && !data.gardener) {
		throw new APIError(`Activity type "${type}" requires a gardener.`, 400);
	}

	if (type === "checkin" || type === "checkout") {
		const { latitude, longitude } = dataObj as {
			latitude?: unknown;
			longitude?: unknown;
		};
		const hasLat = typeof latitude === "number";
		const hasLng = typeof longitude === "number";
		if (hasLat !== hasLng) {
			throw new APIError(
				`Activity type "${type}" requires both latitude and longitude, or neither.`,
				400,
			);
		}
	}

	if (TYPES_REQUIRING_HEALTHSCORE.includes(type)) {
		if (typeof dataObj.healthScore !== "number") {
			throw new APIError(
				`Activity type "${type}" requires data.healthScore.`,
				400,
			);
		}
	}

	return data;
};

// Best-effort drain via Next's `after()` to commit immediately; cron fallback if drain fails.
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
	} catch (err) {
		req.payload.logger.error({
			msg: "Failed to queue commitActivityChain on activity create",
			err: err instanceof Error ? err.message : String(err),
		});
		return doc;
	}

	// Best-effort immediate drain. Silently skipped outside a Next.js request
	// context (local API calls, seed scripts) — cron picks up the queued job.
	try {
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
	} catch {
		// not in a request scope — cron will drain
	}
	return doc;
};

const computeLabelBeforeChange: CollectionBeforeChangeHook = async ({
	data,
	req,
	operation,
}) => {
	// Activities are write-once; skip on updates (label was set at create time)
	if (operation !== "create") return data;
	if (!data) return data;

	const type = data.type as ActivityType | undefined;
	const actData = (data.data ?? {}) as Record<string, unknown>;

	const [g, inv, a] = await Promise.all([
		data.gardener
			? req.payload
					.findByID({
						collection: "gardeners",
						id: data.gardener as string,
						depth: 0,
						overrideAccess: true,
					})
					.catch(() => null)
			: null,
		data.intervention
			? req.payload
					.findByID({
						collection: "interventions",
						id: data.intervention as string,
						depth: 1,
						overrideAccess: true,
					})
					.catch(() => null)
			: null,
		data.area
			? req.payload
					.findByID({
						collection: "areas",
						id: data.area as string,
						depth: 0,
						overrideAccess: true,
					})
					.catch(() => null)
			: null,
	]);

	const firstName =
		(g as { displayName?: string } | null)?.displayName?.split(" ")[0] ?? null;

	let interventionRef: string | null = null;
	let nestedAreaName: string | null = null;
	if (inv) {
		interventionRef =
			(inv as { interventionId?: string }).interventionId ?? null;
		const invArea = (inv as { area?: unknown }).area;
		if (typeof invArea === "object" && invArea) {
			nestedAreaName = (invArea as { name?: string }).name ?? null;
		}
	}

	const directAreaName = (a as { name?: string } | null)?.name ?? null;

	const areaName = directAreaName ?? nestedAreaName;

	const parts = (...tokens: (string | null | undefined)[]) =>
		tokens.filter(Boolean).join(" ");

	let label: string;
	switch (type) {
		case "schedule":
			label = parts(
				"Scheduled",
				interventionRef ? `(${interventionRef})` : null,
				areaName ? `· ${areaName}` : null,
			);
			break;
		case "checkin":
			label = parts(
				firstName ?? "Gardener",
				"checked in",
				areaName ? `· ${areaName}` : null,
				interventionRef ? `(${interventionRef})` : null,
			);
			break;
		case "checkout": {
			label = parts(
				firstName ?? "Gardener",
				"checked out",
				areaName ? `· ${areaName}` : null,
				interventionRef ? `(${interventionRef})` : null,
			);
			break;
		}
		case "report": {
			const taskCount = Array.isArray(actData.tasksCompleted)
				? (actData.tasksCompleted as string[]).length
				: null;
			const effort =
				typeof actData.reportedEffort === "number"
					? actData.reportedEffort
					: null;
			label = parts(
				firstName ?? "Gardener",
				"submitted report",
				taskCount != null ? `(${taskCount} tasks)` : null,
				effort != null ? `· ${effort} min` : null,
				areaName ? `· ${areaName}` : null,
				interventionRef ? `(${interventionRef})` : null,
			);
			break;
		}
		case "healthcheck": {
			const score =
				typeof actData.healthScore === "number" ? actData.healthScore : null;
			label = parts(
				"Health check",
				areaName ? `at ${areaName}` : null,
				score != null ? `· score ${score}` : null,
			);
			break;
		}
		default:
			label = type ?? "";
	}

	return { ...data, label };
};

const showWhenType =
	(allowed: readonly ActivityType[]) =>
	(_data: unknown, siblingData: unknown) => {
		const t = (siblingData as { type?: ActivityType })?.type;
		return typeof t === "string" && allowed.includes(t);
	};

export const Activities: CollectionConfig = {
	slug: "activities",
	admin: {
		group: "Lifecycle",
		useAsTitle: "label",
		defaultColumns: ["label", "type", "claimedTimestamp"],
	},
	access: {
		read: authenticated,
		create: () => false,
		update: () => false,
		delete: () => false,
	},
	hooks: {
		beforeValidate: [deriveHealthcheckArea, guardActivityInvariants],
		beforeChange: [computeLabelBeforeChange],
		afterChange: [queueChainCommit],
	},
	fields: [
		{
			name: "label",
			type: "text",
			admin: { readOnly: true },
		},
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
			admin: { condition: showWhenType(["healthcheck"]) },
		},
		{
			name: "gardener",
			type: "relationship",
			relationTo: "gardeners",
			admin: { condition: showWhenType(TYPES_REQUIRING_GARDENER) },
		},
		{
			name: "data",
			type: "json",
			admin: {
				components: {
					Field: "@/components/fields/ActivityDataField",
				},
			},
		},
		{
			name: "claimedTimestamp",
			label: "date",
			type: "date",
			required: true,
		},
		{
			name: "media",
			type: "upload",
			relationTo: "media",
			admin: {
				description:
					"Optional evidence media. Hashed into payload.mediaHash at publish time.",
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
