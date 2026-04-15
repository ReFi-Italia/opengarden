import type { CollectionConfig } from "payload";
import { authenticated } from "../access/authenticated";

const CHAIN_TRANSACTION_KINDS = [
	"registerSchema",
	"registerArea",
	"scheduleIntervention",
	"gardenerCheckin",
	"gardenerCheckout",
	"gardenerReport",
	"healthcheck",
	"validateIntervention",
	"publishIntervention",
	"buildBundle",
	"verifyBundle",
	"timestamp",
	"validate",
	"publish",
	"revoke",
] as const;

const CHAIN_TRANSACTION_STATUS = ["pending", "success", "failed"] as const;

/**
 * Append-only audit log of every SDK call. Writes are reserved for internal
 * action handlers (server actions run with `overrideAccess: true` and a
 * trusted `req`); regular users can only read.
 */
export const ChainTransactions: CollectionConfig = {
	slug: "chainTransactions",
	admin: {
		group: "Settlement",
		hidden: true,
		useAsTitle: "id",
		defaultColumns: [
			"kind",
			"status",
			"relatedCollection",
			"relatedId",
			"txHash",
		],
	},
	access: {
		read: authenticated,
		create: () => false,
		update: () => false,
		delete: () => false,
	},
	fields: [
		{
			name: "kind",
			type: "select",
			required: true,
			options: CHAIN_TRANSACTION_KINDS.map((value) => ({
				label: value,
				value,
			})),
		},
		{ name: "relatedCollection", type: "text" },
		{ name: "relatedId", type: "text" },
		{ name: "txHash", type: "text", index: true },
		{ name: "chainUID", type: "text", index: true },
		{ name: "chainId", type: "number" },
		{ name: "attesterWallet", type: "text" },
		{
			name: "status",
			type: "select",
			required: true,
			options: CHAIN_TRANSACTION_STATUS.map((value) => ({
				label: value,
				value,
			})),
		},
		{ name: "error", type: "textarea" },
		{ name: "payloadJson", type: "json" },
		{ name: "resultJson", type: "json" },
	],
};
