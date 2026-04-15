import type {
	CollectionAfterChangeHook,
	CollectionBeforeValidateHook,
	CollectionConfig,
} from "payload";
import { APIError } from "payload";
import { authenticated } from "../access/authenticated";
import { isAuthoringOrAbove } from "../access/isAuthoringOrAbove";
import { chainMirror } from "../fields/chainMirror";

/**
 * Refuses writes unless:
 * - the referenced gardener is listed in the intervention's crew, and
 * - the intervention is in a state that accepts crew field data
 *   (`scheduled` or `in_progress`).
 *
 * Phase 1 admins author these rows on behalf of crew. Phase 2 the mobile app
 * writes here directly via a public REST surface, at which point the same
 * guard prevents a rogue gardener from checking in to an intervention they
 * aren't assigned to.
 */
const guardCheckinAgainstIntervention: CollectionBeforeValidateHook = async ({
	data,
	req,
}) => {
	if (!data?.intervention || !data?.gardener) return data;

	const intervention = await req.payload.findByID({
		collection: "interventions",
		id: data.intervention as string | number,
		depth: 0,
		req,
	});

	const state = (intervention as { lifecycleStatus?: string }).lifecycleStatus;
	if (state !== "scheduled" && state !== "in_progress") {
		throw new APIError(
			`Cannot record a checkin against an intervention in state "${state}".`,
			409,
		);
	}

	const crew = (
		intervention as {
			crew?: { gardener?: string | number | { id?: string | number } }[];
		}
	).crew;
	const gardenerId = data.gardener;
	const inCrew = crew?.some((row) => {
		const g = row.gardener;
		if (g === gardenerId) return true;
		if (g && typeof g === "object" && "id" in g && g.id === gardenerId)
			return true;
		return false;
	});
	if (!inCrew) {
		throw new APIError(
			"Gardener is not a member of this intervention's crew.",
			403,
		);
	}
	return data;
};

/**
 * On insert, queue the `gardenerCheckin` task to commit the off-chain
 * attestation and write the `chain.*` mirror back. We use Payload's
 * `after()` drain so the row's HTTP response returns immediately and
 * the operator's UI just sees a refreshed row a beat later.
 */
const queueChainCommit: CollectionAfterChangeHook = async ({
	doc,
	operation,
	req,
}) => {
	if (operation !== "create") return doc;
	if ((doc as { chain?: { chainUID?: string } }).chain?.chainUID) return doc;

	try {
		await req.payload.jobs.queue({
			task: "gardenerCheckin",
			input: { checkinId: String((doc as { id: string | number }).id) },
			queue: "default",
		});
		// Best-effort drain via Next's `after()` so the queued job runs
		// without waiting for the cron tick.
		const { after } = await import("next/server");
		after(async () => {
			try {
				await req.payload.jobs.run({ queue: "default", limit: 1 });
			} catch (err) {
				req.payload.logger.error({
					msg: "queueChainCommit (gardenerCheckin): drain failed — relying on cron safety net",
					err: err instanceof Error ? err.message : String(err),
				});
			}
		});
	} catch (err) {
		req.payload.logger.error({
			msg: "Failed to queue gardenerCheckin task on row create",
			err: err instanceof Error ? err.message : String(err),
		});
	}
	return doc;
};

export const GardenerCheckins: CollectionConfig = {
	slug: "gardenerCheckins",
	admin: {
		group: "Lifecycle",
		hidden: true,
		useAsTitle: "id",
		defaultColumns: ["intervention", "gardener", "claimedTimestamp"],
	},
	access: {
		read: authenticated,
		create: isAuthoringOrAbove,
		update: isAuthoringOrAbove,
		delete: isAuthoringOrAbove,
	},
	hooks: {
		beforeValidate: [guardCheckinAgainstIntervention],
		afterChange: [queueChainCommit],
	},
	fields: [
		{
			name: "intervention",
			type: "relationship",
			relationTo: "interventions",
			required: true,
			index: true,
		},
		{
			name: "gardener",
			type: "relationship",
			relationTo: "gardeners",
			required: true,
		},
		{
			name: "latitude",
			type: "number",
			required: true,
			min: -90,
			max: 90,
		},
		{
			name: "longitude",
			type: "number",
			required: true,
			min: -180,
			max: 180,
		},
		{
			name: "claimedTimestamp",
			type: "date",
			required: true,
			admin: {
				description:
					"Device-reported arrival time (Unix seconds under the hood).",
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
			admin: {
				readOnly: true,
				description:
					"Mirrored from media.storageHash at the time of attestation.",
			},
		},
		{
			name: "chain",
			type: "group",
			fields: chainMirror(),
		},
	],
};
