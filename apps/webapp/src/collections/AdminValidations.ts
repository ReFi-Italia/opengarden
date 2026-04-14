import type { CollectionConfig } from "payload";
import { authenticated } from "../access/authenticated";
import { isValidator } from "../access/isValidator";
import { chainMirror } from "../fields/chainMirror";

/**
 * Revocation is NOT performed by a hook on this collection. The revoke-
 * validation server action flips `revoked: true` and wipes
 * `interventions.validation.*` in a single `req`-scoped transaction. Per-row
 * writes on this collection are create-only for validators; the revoke path
 * runs with `overrideAccess: false` under the same role gate and modifies
 * this row via the server action's authorised context.
 */
export const AdminValidations: CollectionConfig = {
	slug: "adminValidations",
	admin: {
		group: "Lifecycle",
		hidden: true,
		useAsTitle: "id",
		defaultColumns: ["intervention", "validator", "approved", "revoked"],
	},
	access: {
		read: authenticated,
		create: isValidator,
		update: isValidator,
		delete: isValidator,
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
			name: "validator",
			type: "relationship",
			relationTo: "staff",
			required: true,
			filterOptions: {
				capabilities: { contains: "validator" },
			},
		},
		{
			name: "approved",
			type: "checkbox",
			required: true,
		},
		{
			name: "qualityScore",
			type: "number",
			min: 0,
			max: 10,
		},
		{
			name: "feedback",
			type: "textarea",
		},
		{
			name: "revoked",
			type: "checkbox",
			defaultValue: false,
			admin: { readOnly: true },
		},
		{
			name: "revokedAt",
			type: "date",
			admin: { readOnly: true },
		},
		{
			name: "revocationTxHash",
			type: "text",
			admin: { readOnly: true },
		},
		{
			name: "chain",
			type: "group",
			fields: chainMirror(),
		},
	],
};
