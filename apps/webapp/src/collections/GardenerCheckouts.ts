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
 * Refuses checkouts whose claimed timestamp is at or before the referenced
 * checkin's claimed timestamp — spec §4.2 temporal ordering.
 */
const guardCheckoutOrdering: CollectionBeforeValidateHook = async ({
	data,
	req,
}) => {
	if (!data?.checkin || !data?.claimedTimestamp) return data;
	const checkin = await req.payload.findByID({
		collection: "gardenerCheckins",
		id: data.checkin as string | number,
		depth: 0,
		req,
	});
	const checkinTs = (checkin as { claimedTimestamp?: string }).claimedTimestamp;
	if (!checkinTs) return data;

	const checkoutTime = new Date(data.claimedTimestamp as string).getTime();
	const checkinTime = new Date(checkinTs).getTime();
	if (!(checkoutTime > checkinTime)) {
		throw new APIError(
			"Checkout claimed timestamp must be strictly after its checkin.",
			400,
		);
	}
	return data;
};

/**
 * On insert, queue the `gardenerCheckout` task to commit the off-chain
 * attestation. Uses Next.js `after()` to drain the job without blocking
 * the HTTP response.
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
			task: "gardenerCheckout",
			input: { checkoutId: String((doc as { id: string | number }).id) },
			queue: "default",
		});
		const { after } = await import("next/server");
		after(async () => {
			try {
				await req.payload.jobs.run({ queue: "default", limit: 1 });
			} catch (err) {
				req.payload.logger.error({
					msg: "queueChainCommit (gardenerCheckout): drain failed — relying on cron safety net",
					err: err instanceof Error ? err.message : String(err),
				});
			}
		});
	} catch (err) {
		req.payload.logger.error({
			msg: "Failed to queue gardenerCheckout task on row create",
			err: err instanceof Error ? err.message : String(err),
		});
	}
	return doc;
};

export const GardenerCheckouts: CollectionConfig = {
	slug: "gardenerCheckouts",
	admin: {
		group: "Lifecycle",
		hidden: true,
		useAsTitle: "id",
		defaultColumns: ["checkin", "claimedTimestamp", "actualMinutes"],
	},
	access: {
		read: authenticated,
		create: isAuthoringOrAbove,
		update: isAuthoringOrAbove,
		delete: isAuthoringOrAbove,
	},
	hooks: {
		beforeValidate: [guardCheckoutOrdering],
		afterChange: [queueChainCommit],
	},
	fields: [
		{
			name: "checkin",
			type: "relationship",
			relationTo: "gardenerCheckins",
			required: true,
			unique: true,
		},
		{
			name: "claimedTimestamp",
			type: "date",
			required: true,
		},
		{
			name: "actualMinutes",
			type: "number",
			required: true,
			min: 0,
		},
		{
			name: "chain",
			type: "group",
			fields: chainMirror(),
		},
	],
};
