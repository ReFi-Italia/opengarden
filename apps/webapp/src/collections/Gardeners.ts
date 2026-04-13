import type { CollectionBeforeValidateHook, CollectionConfig } from "payload";
import { APIError } from "payload";
import { authenticated } from "../access/authenticated";
import { isManagerOrAdmin } from "../access/isManagerOrAdmin";

export const GARDENER_STATUSES = ["onboarding", "active", "inactive"] as const;

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
		req,
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
		},
		{
			name: "wallet",
			type: "text",
			index: true,
			admin: {
				description:
					"Optional until the mobile app ships; required once gardeners self-attest.",
			},
		},
		{
			name: "email",
			type: "text",
		},
		{
			name: "status",
			type: "select",
			required: true,
			defaultValue: "onboarding",
			options: GARDENER_STATUSES.map((value) => ({ label: value, value })),
		},
		{
			name: "notes",
			type: "textarea",
		},
	],
};
