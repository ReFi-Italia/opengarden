import type { CollectionBeforeValidateHook, CollectionConfig } from "payload";
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

export const GardenerCheckouts: CollectionConfig = {
	slug: "gardenerCheckouts",
	admin: {
		group: "Lifecycle",
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
