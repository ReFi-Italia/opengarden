import type { CollectionBeforeValidateHook, CollectionConfig } from "payload";
import { APIError } from "payload";
import { authenticated } from "../access/authenticated";
import { isManagerOrAdmin } from "../access/isManagerOrAdmin";

const GARDENER_STATUSES = ["onboarding", "active", "inactive"] as const;

/**
 * Application-level partial unique constraint on `wallet`: wallets must be
 * unique across gardeners when set, but `null` is allowed for Phase 1
 * gardeners without wallets. A DB-level partial unique index requires a hand-
 * edited migration (`CREATE UNIQUE INDEX ... WHERE wallet IS NOT NULL`) and
 * can be added later as defense-in-depth.
 */
const enforceUniqueWallet: CollectionBeforeValidateHook = async ({
	data,
	originalDoc,
	req,
}) => {
	const wallet = data?.wallet;
	if (!wallet) return data;

	const existing = await req.payload.find({
		collection: "gardeners",
		where: { wallet: { equals: wallet } },
		limit: 2,
		depth: 0,
		overrideAccess: true,
	});
	const duplicate = existing.docs.find(
		(doc) => !originalDoc || doc.id !== originalDoc.id,
	);
	if (duplicate) {
		throw new APIError(
			`Wallet ${wallet} is already assigned to another gardener.`,
			409,
		);
	}
	return data;
};

export const Gardeners: CollectionConfig = {
	slug: "gardeners",
	admin: {
		useAsTitle: "displayName",
		group: "Registry",
		defaultColumns: ["displayName", "wallet", "status"],
	},
	access: {
		read: authenticated,
		create: isManagerOrAdmin,
		update: isManagerOrAdmin,
		delete: isManagerOrAdmin,
	},
	hooks: {
		beforeValidate: [enforceUniqueWallet],
	},
	fields: [
		{
			name: "displayName",
			type: "text",
			required: true,
			label: "Display name",
		},
		{
			name: "email",
			type: "text",
			label: "Email",
		},
		{
			name: "wallet",
			type: "text",
			label: "Wallet address",
			index: true,
			admin: {
				description:
					"Optional for now — required once gardeners self-attest from the mobile app.",
			},
		},
		{
			name: "notes",
			type: "textarea",
		},
		{
			name: "status",
			type: "select",
			label: "Status",
			required: true,
			defaultValue: "onboarding",
			options: GARDENER_STATUSES.map((value) => ({ label: value, value })),
			admin: {
				position: "sidebar",
				description:
					"Only active gardeners can be assigned to intervention crews.",
			},
		},
	],
};
