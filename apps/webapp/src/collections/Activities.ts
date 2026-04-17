import type {
	CollectionAfterChangeHook,
	CollectionBeforeChangeHook,
	CollectionBeforeValidateHook,
	CollectionConfig,
} from "payload";
import { APIError } from "payload";
import { keccak256, toUtf8Bytes } from "ethers";
import { after } from "next/server";
import { authenticated } from "../access/authenticated";
import { isAuthoringOrAbove } from "../access/isAuthoringOrAbove";

export const ACTIVITY_TYPES = [
	"checkin",
	"checkout",
	"report",
	"healthcheck",
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

const INTERVENTION_SCOPED_TYPES: readonly ActivityType[] = [
	"checkin",
	"checkout",
	"report",
];

const TYPES_REQUIRING_GARDENER: readonly ActivityType[] = [
	"checkin",
	"checkout",
	"report",
];
const TYPES_REQUIRING_PARENT: readonly ActivityType[] = ["checkout", "report"];
const TYPES_REQUIRING_GEOLOCATION: readonly ActivityType[] = ["checkin"];
const TYPES_REQUIRING_DURATION: readonly ActivityType[] = ["checkout"];
const TYPES_REQUIRING_REPORT_BODY: readonly ActivityType[] = [];
const TYPES_REQUIRING_HEALTHSCORE: readonly ActivityType[] = ["healthcheck"];

const toIdStr = (field: unknown): string => {
	if (field && typeof field === "object" && "id" in field)
		return String((field as { id?: string | number }).id ?? "");
	return String(field ?? "");
};

// Runs before guardActivityInvariants so the "parentActivity required" guard sees the resolved value.
const autoLinkParentActivity: CollectionBeforeValidateHook = async ({
	data,
	req,
}) => {
	if (!data) return data;
	const type = data.type as ActivityType | undefined;

	if (type === "healthcheck" && !data.area && data.intervention) {
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
	}

	if (type !== "checkout" && type !== "report") return data;
	if (data.parentActivity) return data; // already supplied

	const interventionId = data.intervention as string | number | undefined;
	if (!interventionId) return data;

	const idStr = String(interventionId);

	if (type === "checkout") {
		const gardenerId = data.gardener as string | number | undefined;

		const [checkins, checkouts] = await Promise.all([
			req.payload
				.find({
					collection: "activities",
					where: {
						and: [
							{ intervention: { equals: idStr } },
							{ type: { equals: "checkin" } },
							...(gardenerId
								? [{ gardener: { equals: String(gardenerId) } }]
								: []),
						],
					},
					sort: "-claimedTimestamp",
					limit: 50,
					depth: 0,
					overrideAccess: true,
				})
				.catch(() => ({ docs: [] as Array<{ id: string | number }> })),
			req.payload
				.find({
					collection: "activities",
					where: {
						and: [
							{ intervention: { equals: idStr } },
							{ type: { equals: "checkout" } },
							...(gardenerId
								? [{ gardener: { equals: String(gardenerId) } }]
								: []),
						],
					},
					limit: 50,
					depth: 0,
					overrideAccess: true,
				})
				.catch(() => ({
					docs: [] as Array<{
						parentActivity?: string | number | { id?: string | number };
					}>,
				})),
		]);

		const usedCheckinIds = new Set(
			checkouts.docs.map((co) =>
				toIdStr((co as { parentActivity?: unknown }).parentActivity),
			),
		);

		const openCheckin = checkins.docs.find(
			(ci) => !usedCheckinIds.has(String(ci.id)),
		);
		if (openCheckin) {
			data.parentActivity = openCheckin.id;
		}
	}

	if (type === "report") {
		const [checkouts, reports] = await Promise.all([
			req.payload
				.find({
					collection: "activities",
					where: {
						and: [
							{ intervention: { equals: idStr } },
							{ type: { equals: "checkout" } },
						],
					},
					sort: "-claimedTimestamp",
					limit: 50,
					depth: 0,
					overrideAccess: true,
				})
				.catch(() => ({ docs: [] as Array<{ id: string | number }> })),
			req.payload
				.find({
					collection: "activities",
					where: {
						and: [
							{ intervention: { equals: idStr } },
							{ type: { equals: "report" } },
						],
					},
					limit: 50,
					depth: 0,
					overrideAccess: true,
				})
				.catch(() => ({
					docs: [] as Array<{
						parentActivity?: string | number | { id?: string | number };
					}>,
				})),
		]);

		const usedCheckoutIds = new Set(
			reports.docs.map((r) =>
				toIdStr((r as { parentActivity?: unknown }).parentActivity),
			),
		);

		const openCheckout = checkouts.docs.find(
			(co) => !usedCheckoutIds.has(String(co.id)),
		);
		if (openCheckout) {
			data.parentActivity = openCheckout.id;
		}
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
		if (state !== "scheduled" && state !== "in_progress") {
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

		if (type === "report") {
			const completedTaskCodes = dataObj.completedTaskCodes;
			if (!Array.isArray(completedTaskCodes)) {
				throw new APIError(
					'Activity type "report" requires data.completedTaskCodes (array of task codes).',
					400,
				);
			}
			const validCodes = new Set<string>(
				(
					(intervention as { tasks?: { code?: string }[] }).tasks ?? []
				)
					.map((t) => t.code)
					.filter((c): c is string => typeof c === "string"),
			);
			for (const code of completedTaskCodes as string[]) {
				if (!validCodes.has(code)) {
					throw new APIError(
						`Task code "${code}" does not exist on this intervention.`,
						400,
					);
				}
			}
			dataObj.taskCount = (completedTaskCodes as string[]).length;
			data.data = dataObj;
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
			typeof dataObj.latitude !== "number" ||
			typeof dataObj.longitude !== "number"
		) {
			throw new APIError(
				`Activity type "${type}" requires data.latitude and data.longitude.`,
				400,
			);
		}
	}
	if (TYPES_REQUIRING_DURATION.includes(type)) {
		if (typeof dataObj.actualMinutes !== "number") {
			throw new APIError(
				`Activity type "${type}" requires data.actualMinutes.`,
				400,
			);
		}
	}
	if (TYPES_REQUIRING_REPORT_BODY.includes(type)) {
		if (
			typeof dataObj.tasksCompleted !== "string" ||
			typeof dataObj.taskCount !== "number"
		) {
			throw new APIError(
				`Activity type "${type}" requires data.tasksCompleted and data.taskCount.`,
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

const computeHealthcheckMetadataHash: CollectionBeforeChangeHook = async ({
	data,
}) => {
	if (!data) return data;
	if (data.type !== "healthcheck") return data;

	const dataObj = (data.data ?? {}) as Record<string, unknown>;
	const metadata = dataObj.metadata as Record<string, unknown> | null | undefined;
	const metaKeys = metadata ? Object.keys(metadata) : [];
	if (!metaKeys.length) {
		return { ...data, data: { ...dataObj, metadataHash: null } };
	}

	metaKeys.sort();
	const canonical = JSON.stringify(metadata, metaKeys);
	const hash = keccak256(toUtf8Bytes(canonical));
	return { ...data, data: { ...dataObj, metadataHash: hash } };
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

	// Resolve gardener → first name
	let firstName: string | null = null;
	if (data.gardener) {
		const g = await req.payload
			.findByID({
				collection: "gardeners",
				id: data.gardener as string,
				depth: 0,
				overrideAccess: true,
			})
			.catch(() => null);
		firstName =
			(g as { displayName?: string } | null)?.displayName?.split(" ")[0] ??
			null;
	}

	// Resolve intervention → interventionId + nested area name (depth:1)
	let interventionRef: string | null = null;
	let nestedAreaName: string | null = null;
	if (data.intervention) {
		const inv = await req.payload
			.findByID({
				collection: "interventions",
				id: data.intervention as string,
				depth: 1,
				overrideAccess: true,
			})
			.catch(() => null);
		if (inv) {
			interventionRef =
				(inv as { interventionId?: string }).interventionId ?? null;
			const invArea = (inv as { area?: unknown }).area;
			if (typeof invArea === "object" && invArea) {
				nestedAreaName = (invArea as { name?: string }).name ?? null;
			}
		}
	}

	// Resolve area (direct field on healthcheck)
	let directAreaName: string | null = null;
	if (data.area) {
		const a = await req.payload
			.findByID({
				collection: "areas",
				id: data.area as string,
				depth: 0,
				overrideAccess: true,
			})
			.catch(() => null);
		directAreaName = (a as { name?: string } | null)?.name ?? null;
	}

	const areaName = directAreaName ?? nestedAreaName;

	const parts = (...tokens: (string | null | undefined)[]) =>
		tokens.filter(Boolean).join(" ");

	let label: string;
	switch (type) {
		case "checkin":
			label = parts(
				firstName ?? "Gardener",
				"checked in",
				areaName ? `· ${areaName}` : null,
				interventionRef ? `(${interventionRef})` : null,
			);
			break;
		case "checkout": {
			const mins =
				typeof actData.actualMinutes === "number"
					? actData.actualMinutes
					: null;
			label = parts(
				firstName ?? "Gardener",
				"checked out",
				mins != null ? `(${mins} min)` : null,
				areaName ? `· ${areaName}` : null,
				interventionRef ? `(${interventionRef})` : null,
			);
			break;
		}
		case "report": {
			const taskCount = Array.isArray(actData.completedTaskCodes)
				? (actData.completedTaskCodes as string[]).length
				: typeof actData.taskCount === "number"
					? actData.taskCount
					: null;
			label = parts(
				firstName ?? "Gardener",
				"submitted report",
				taskCount != null ? `(${taskCount} tasks)` : null,
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
		useAsTitle: "label",
		defaultColumns: ["label", "type", "intervention", "area", "claimedTimestamp"],
	},
	access: {
		read: authenticated,
		create: isAuthoringOrAbove,
		update: isAuthoringOrAbove,
		delete: isAuthoringOrAbove,
	},
	hooks: {
		beforeValidate: [autoLinkParentActivity, guardActivityInvariants],
		beforeChange: [computeHealthcheckMetadataHash, computeLabelBeforeChange],
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
			admin: { condition: showWhenType(["healthcheck"]) },
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
			name: "assessor",
			type: "relationship",
			relationTo: "staff",
			admin: { condition: showWhenType(TYPES_REQUIRING_HEALTHSCORE) },
		},
		{
			name: "data",
			type: "json",
			admin: {
				description: "checkin → {latitude, longitude} · checkout → {actualMinutes} · report → {completedTaskCodes: string[], taskCount: number (derived), notes} · healthcheck → {healthScore, metadata, metadataHash}",
			},
		},
		{
			name: "photo",
			type: "upload",
			relationTo: "media",
		},
		{
			name: "photoHash",
			type: "text",
			admin: { readOnly: true },
		},
		{
			name: "attestation",
			type: "relationship",
			relationTo: "attestations",
			admin: { readOnly: true },
		},
		{
			name: "label",
			type: "text",
			admin: { readOnly: true },
		},
	],
};
