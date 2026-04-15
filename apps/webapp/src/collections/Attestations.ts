import type { CollectionConfig } from "payload";
import { authenticated } from "../access/authenticated";

export const ATTESTATION_STATUS = ["committed", "failed"] as const;

export const ATTESTATION_SCHEMAS = [
	"ScheduledIntervention",
	"AdminValidation",
	"PublishedIntervention",
	"AreaRegistration",
	"GardenerCheckin",
	"GardenerCheckout",
	"GardenerReport",
	"Healthcheck",
] as const;

/**
 * Canonical store for signed off-chain attestations. Every chain commit
 * performed by a task handler creates a row here and links it back from
 * the entity that owns the attestation (for `activities` today, for
 * `interventions`/`areas` in a follow-up refactor).
 *
 * The collection is read-only from the admin UI: creation is driven by
 * task handlers via `overrideAccess: true`. `relatedCollection` +
 * `relatedId` exist as informational back-references so an operator can
 * query "give me every attestation for intervention X" without joining
 * through the activity relationships.
 */
export const Attestations: CollectionConfig = {
	slug: "attestations",
	admin: {
		group: "System",
		hidden: true,
		useAsTitle: "uid",
		defaultColumns: [
			"uid",
			"schemaName",
			"status",
			"relatedCollection",
			"relatedId",
			"createdAt",
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
			name: "uid",
			type: "text",
			required: true,
			unique: true,
			index: true,
		},
		{
			name: "schemaName",
			type: "select",
			required: true,
			options: ATTESTATION_SCHEMAS.map((value) => ({ label: value, value })),
			index: true,
		},
		{
			name: "signedAttestation",
			type: "json",
			required: true,
		},
		{
			name: "timestampTxHash",
			type: "text",
			index: true,
		},
		{
			name: "onchainTimestamp",
			type: "number",
		},
		{
			name: "chainIdSnapshot",
			type: "number",
		},
		{
			name: "attesterWallet",
			type: "text",
		},
		{
			name: "status",
			type: "select",
			required: true,
			defaultValue: "committed",
			options: ATTESTATION_STATUS.map((value) => ({ label: value, value })),
		},
		{
			name: "error",
			type: "textarea",
		},
		{
			name: "relatedCollection",
			type: "text",
		},
		{
			name: "relatedId",
			type: "text",
		},
	],
};
