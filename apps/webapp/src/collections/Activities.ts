import type {
	CollectionAfterChangeHook,
	CollectionBeforeChangeHook,
	CollectionBeforeValidateHook,
	CollectionConfig,
} from "payload";
import { APIError } from "payload";
import { keccak256, toUtf8Bytes } from "ethers";
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
// healthcheck can be area-scoped or intervention-scoped — handled separately
const AREA_SCOPED_TYPES: readonly ActivityType[] = [];

const TYPES_REQUIRING_GARDENER: readonly ActivityType[] = [
	"checkin",
	"checkout",
	"report",
];
const TYPES_REQUIRING_PARENT: readonly ActivityType[] = ["checkout", "report"];
const TYPES_REQUIRING_GEOLOCATION: readonly ActivityType[] = ["checkin"];
const TYPES_REQUIRING_DURATION: readonly ActivityType[] = ["checkout"];
const TYPES_REQUIRING_REPORT_BODY: readonly ActivityType[] = ["report"];
const TYPES_REQUIRING_HEALTHSCORE: readonly ActivityType[] = ["healthcheck"];

/**
 * For `checkout` and `report`, automatically resolves the nearest open parent
 * activity when `parentActivity` is not supplied by the caller:
 *
 *  - checkout → latest checkin for the same intervention+gardener that has no
 *               matching checkout yet
 *  - report   → latest checkout for the same intervention that has no matching
 *               report yet
 *
 * Runs before `guardActivityInvariants` so that the "parentActivity required"
 * guard sees the resolved value.
 */
const autoLinkParentActivity: CollectionBeforeValidateHook = async ({
	data,
	req,
}) => {
	if (!data) return data;
	const type = data.type as ActivityType | undefined;
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
			checkouts.docs.map((co) => {
				const p = (co as { parentActivity?: string | number | { id?: string | number } }).parentActivity;
				if (typeof p === "object" && p !== null) {
					return String((p as { id?: string | number }).id ?? "");
				}
				return String(p ?? "");
			}),
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
			reports.docs.map((r) => {
				const p = (r as { parentActivity?: string | number | { id?: string | number } }).parentActivity;
				if (typeof p === "object" && p !== null) {
					return String((p as { id?: string | number }).id ?? "");
				}
				return String(p ?? "");
			}),
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

	// healthcheck requires either intervention or area (not necessarily both)
	if (type === "healthcheck") {
		if (!hasIntervention && !hasArea) {
			throw new APIError(
				'Activity type "healthcheck" requires an intervention or an area.',
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
	}

	return data;
};

/**
 * Computes a keccak256 fingerprint of the healthcheck off-chain metadata JSON
 * so the SDK can include it in the on-chain attestation. Only runs for
 * `healthcheck` activities with non-empty metadata. Null otherwise.
 */
const computeHealthcheckMetadataHash: CollectionBeforeChangeHook = async ({
	data,
}) => {
	if (!data) return data;
	if (data.type !== "healthcheck") return data;

	const metadata = data.metadata as Record<string, unknown> | null | undefined;
	if (!metadata || Object.keys(metadata).length === 0) {
		return { ...data, metadataHash: null };
	}

	// Canonical: sorted keys, no extra whitespace
	const canonical = JSON.stringify(metadata, Object.keys(metadata).sort());
	const hash = keccak256(toUtf8Bytes(canonical));
	return { ...data, metadataHash: hash };
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
		beforeValidate: [autoLinkParentActivity, guardActivityInvariants],
		beforeChange: [computeHealthcheckMetadataHash],
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
			name: "metadata",
			type: "json",
			admin: { condition: showWhenType(["healthcheck"]) },
		},
		{
			name: "metadataHash",
			type: "text",
			admin: { readOnly: true },
		},
		{
			name: "priorHealthcheck",
			type: "relationship",
			relationTo: "attestations",
			admin: { condition: showWhenType(["healthcheck"]) },
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
