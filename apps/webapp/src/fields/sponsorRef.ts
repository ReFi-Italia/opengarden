import type { Field } from "payload";

/**
 * Field factory for the `interventions.commissioning` group. Per spec §9.1
 * the commissionRef hash is derived by the SDK from the sponsor's
 * `canonicalJson` at schedule time — the webapp does NOT precompute it.
 * Post-schedule, the authoritative hash lives on the schedule Activity's
 * on-chain attestation. For sponsor-level UI search, use
 * `sponsors.commissionRefHash` which is a stable sponsor property.
 */
export const commissioningFields = (): Field[] => [
	{
		name: "sponsor",
		type: "relationship",
		relationTo: "sponsors",
		label: "Sponsor",
		required: true,
	},
];
