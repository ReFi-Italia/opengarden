import type { CollectionBeforeValidateHook, CollectionConfig } from "payload";
import { APIError } from "payload";
import { authenticated } from "../access/authenticated";
import { isAuthoringOrAbove } from "../access/isAuthoringOrAbove";
import { chainMirror } from "../fields/chainMirror";
import { computePhotoBundleHash } from "../hooks/computePhotoBundleHash";

/**
 * `tasksCompleted` is a comma-separated text field to match the SDK's
 * `GardenerReportInput.tasksCompleted: string` shape directly. The hook
 * below splits on comma and validates that every code exists in the
 * `taskCatalog` global. Payload's select `options` can't source from a
 * global at runtime; a future admin component could turn this into a
 * checkbox list, but the storage format stays as text.
 */
const validateTasksAgainstCatalog: CollectionBeforeValidateHook = async ({
	data,
	req,
}) => {
	const raw = (data as { tasksCompleted?: string }).tasksCompleted;
	if (!raw) return data;

	const catalog = await req.payload.findGlobal({
		slug: "taskCatalog",
		depth: 0,
		req,
	});
	const validCodes = new Set(
		((catalog as { tasks?: { code?: string }[] }).tasks ?? [])
			.map((t) => t.code)
			.filter((code): code is string => typeof code === "string"),
	);

	const codes = raw
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
	if (codes.length === 0) {
		throw new APIError("tasksCompleted must not be empty.", 400);
	}
	const unknown = codes.filter((code) => !validCodes.has(code));
	if (unknown.length > 0) {
		throw new APIError(
			`Unknown task codes: [${unknown.join(", ")}]. Valid codes live in the taskCatalog global.`,
			400,
		);
	}
	return {
		...data,
		tasksCompleted: codes.join(","),
		taskCount: codes.length,
	};
};

export const GardenerReports: CollectionConfig = {
	slug: "gardenerReports",
	admin: {
		group: "Lifecycle",
		useAsTitle: "id",
		defaultColumns: ["intervention", "checkout", "taskCount"],
	},
	access: {
		read: authenticated,
		create: isAuthoringOrAbove,
		update: isAuthoringOrAbove,
		delete: isAuthoringOrAbove,
	},
	hooks: {
		beforeValidate: [validateTasksAgainstCatalog],
		beforeChange: [
			computePhotoBundleHash({
				relationshipField: "photos",
				hashField: "photosHash",
			}),
		],
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
			name: "checkout",
			type: "relationship",
			relationTo: "gardenerCheckouts",
			required: true,
			unique: true,
		},
		{
			name: "tasksCompleted",
			type: "text",
			required: true,
			admin: {
				description:
					"Comma-separated task codes. Each code must exist in the taskCatalog global.",
			},
		},
		{
			name: "taskCount",
			type: "number",
			required: true,
			min: 0,
			admin: {
				readOnly: true,
				description: "Derived from tasksCompleted length on save.",
			},
		},
		{
			name: "photos",
			type: "relationship",
			relationTo: "media",
			hasMany: true,
		},
		{
			name: "photosHash",
			type: "text",
			admin: {
				readOnly: true,
				description:
					"keccak256 of the canonical manifest of media.storageHash values. Computed on save via the SDK helper.",
			},
		},
		{
			name: "notes",
			type: "textarea",
		},
		{
			name: "chain",
			type: "group",
			fields: chainMirror(),
		},
	],
};
