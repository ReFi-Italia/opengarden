import type { CollectionBeforeValidateHook, CollectionConfig } from "payload";
import { APIError } from "payload";
import { authenticated } from "../access/authenticated";
import { isAssessor } from "../access/isAssessor";
import { chainMirror } from "../fields/chainMirror";

const HEALTHCHECK_KINDS = ["standalone", "before", "after"] as const;

/**
 * Enforces `kind === 'standalone'` ↔ `intervention === null`. A healthcheck
 * either anchors to a specific intervention (`before` / `after`) or stands
 * alone for trend reporting on an area.
 */
const guardHealthcheckKind: CollectionBeforeValidateHook = async ({ data }) => {
	if (!data) return data;
	const kind = data.kind as string | undefined;
	const hasIntervention =
		data.intervention !== undefined &&
		data.intervention !== null &&
		data.intervention !== "";

	if (kind === "standalone" && hasIntervention) {
		throw new APIError(
			"Standalone healthchecks must not reference an intervention.",
			400,
		);
	}
	if ((kind === "before" || kind === "after") && !hasIntervention) {
		throw new APIError(
			`Healthchecks of kind "${kind}" require an intervention reference.`,
			400,
		);
	}
	return data;
};

export const Healthchecks: CollectionConfig = {
	slug: "healthchecks",
	admin: {
		group: "Lifecycle",
		hidden: true,
		useAsTitle: "id",
		defaultColumns: ["area", "kind", "healthScore", "assessor"],
	},
	access: {
		read: authenticated,
		create: isAssessor,
		update: isAssessor,
		delete: isAssessor,
	},
	hooks: {
		beforeValidate: [guardHealthcheckKind],
	},
	fields: [
		{
			name: "area",
			type: "relationship",
			relationTo: "areas",
			required: true,
			index: true,
		},
		{
			name: "intervention",
			type: "relationship",
			relationTo: "interventions",
		},
		{
			name: "kind",
			type: "select",
			required: true,
			options: HEALTHCHECK_KINDS.map((value) => ({ label: value, value })),
		},
		{
			name: "healthScore",
			type: "number",
			required: true,
			min: 1,
			max: 10,
		},
		{
			name: "assessor",
			type: "relationship",
			relationTo: "staff",
			filterOptions: {
				capabilities: { contains: "assessor" },
			},
		},
		{
			name: "assessorIdHashSnapshot",
			type: "text",
			admin: {
				readOnly: true,
				description:
					"Snapshotted from staff.staffIdHash at attestation time; ZERO_BYTES32 when no assessor is assigned.",
			},
		},
		{
			name: "assessorNotes",
			type: "textarea",
		},
		{
			name: "interventionNeeded",
			type: "checkbox",
			defaultValue: false,
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
