import { AreaType } from "@refi-italia/opengarden/helpers";
import type { CollectionBeforeValidateHook, CollectionConfig } from "payload";
import { APIError } from "payload";
import { authenticated } from "../access/authenticated";
import { isAuthoringOrAbove } from "../access/isAuthoringOrAbove";
import { chainMirror } from "../fields/chainMirror";

export const AREA_LIFECYCLE_STATUSES = [
	"draft",
	"registering",
	"registered",
	"failed",
] as const;

/**
 * AreaType enum values are stored as string-encoded integers ("0".."4") to
 * round-trip through Payload's string-based select field. Server actions
 * parse them back to the numeric enum before calling the SDK.
 */
const AREA_TYPE_OPTIONS = [
	{ label: "Unspecified", value: String(AreaType.Unspecified) },
	{ label: "Public green space", value: String(AreaType.PublicGreenSpace) },
	{ label: "Private garden", value: String(AreaType.PrivateGarden) },
	{
		label: "Institutional grounds",
		value: String(AreaType.InstitutionalGrounds),
	},
	{ label: "Roadside / median", value: String(AreaType.RoadsideMedian) },
];

/**
 * Once an area is `registered`, the hash-affecting inputs (`latitude`,
 * `longitude`, `areaType`, `metadataHash`) must not change — they would
 * orphan the on-chain `AreaRegistration`. Display-only fields (`name`,
 * `municipality`, extended metadata display fields) remain editable.
 *
 * Server actions that populate the chain mirror pass
 * `req.context.skipLifecycleHooks: true` to bypass this guard.
 */
const freezeRegisteredAreaInputs: CollectionBeforeValidateHook = async ({
	data,
	originalDoc,
	operation,
	context,
}) => {
	if (context?.skipLifecycleHooks) return data;
	if (operation !== "update" || !originalDoc) return data;
	if (originalDoc.lifecycleStatus !== "registered") return data;

	const frozenFields = [
		"latitude",
		"longitude",
		"areaType",
		"metadataHash",
	] as const;
	for (const field of frozenFields) {
		const before = (originalDoc as Record<string, unknown>)[field];
		const after = (data as Record<string, unknown>)[field];
		if (after !== undefined && after !== before) {
			throw new APIError(
				`Cannot modify "${field}" on a registered area — it would orphan the on-chain AreaRegistration.`,
				403,
			);
		}
	}
	return data;
};

export const Areas: CollectionConfig = {
	slug: "areas",
	admin: {
		useAsTitle: "name",
		group: "Registry",
		defaultColumns: ["name", "areaId", "municipality", "lifecycleStatus"],
	},
	access: {
		read: authenticated,
		create: isAuthoringOrAbove,
		update: isAuthoringOrAbove,
		delete: isAuthoringOrAbove,
	},
	versions: {
		drafts: true,
		maxPerDoc: 100,
	},
	hooks: {
		beforeValidate: [freezeRegisteredAreaInputs],
	},
	fields: [
		{
			name: "areaId",
			type: "text",
			required: true,
			unique: true,
			index: true,
			admin: {
				description: "Internal identifier such as RM-PIGN-042.",
			},
		},
		{
			name: "name",
			type: "text",
			required: true,
		},
		{
			name: "municipality",
			type: "text",
			required: true,
			index: true,
		},
		{
			name: "areaType",
			type: "select",
			required: true,
			options: AREA_TYPE_OPTIONS,
		},
		{
			name: "latitude",
			type: "number",
			required: true,
			min: -90,
			max: 90,
		},
		{
			name: "longitude",
			type: "number",
			required: true,
			min: -180,
			max: 180,
		},
		{
			name: "extendedMetadata",
			type: "group",
			fields: [
				{ name: "surfaceAreaSqm", type: "number" },
				{ name: "boundaryGeojson", type: "json" },
				{ name: "coverPhoto", type: "upload", relationTo: "media" },
				{
					name: "gallery",
					type: "relationship",
					relationTo: "media",
					hasMany: true,
				},
			],
		},
		{
			name: "metadataHash",
			type: "text",
			index: true,
			admin: {
				readOnly: true,
				description:
					"IPFS CID of the extended metadata JSON uploaded by the register-area server action. ZERO_BYTES32 if none.",
			},
		},
		{
			name: "chain",
			type: "group",
			admin: {
				description:
					"Populated by the register-area server action. Empty until the area is registered on-chain.",
			},
			fields: chainMirror(),
		},
		{
			name: "lifecycleStatus",
			type: "select",
			required: true,
			defaultValue: "draft",
			admin: {
				readOnly: true,
				position: "sidebar",
			},
			options: AREA_LIFECYCLE_STATUSES.map((value) => ({
				label: value,
				value,
			})),
			index: true,
		},
	],
};
