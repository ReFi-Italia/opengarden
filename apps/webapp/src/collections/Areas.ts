import { AreaType } from "@refi-italia/opengarden";
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
			name: "name",
			type: "text",
			label: "Name",
			required: true,
		},
		{
			name: "areaId",
			type: "text",
			label: "Area ID",
			required: true,
			unique: true,
			index: true,
			admin: {
				description: "Internal identifier such as RM-PIGN-042.",
			},
		},
		{
			name: "municipality",
			type: "text",
			label: "Municipality",
			required: true,
			index: true,
		},
		{
			name: "areaType",
			type: "select",
			label: "Type",
			required: true,
			options: AREA_TYPE_OPTIONS,
		},
		{
			type: "row",
			fields: [
				{
					name: "latitude",
					type: "number",
					label: "Latitude",
					required: true,
					min: -90,
					max: 90,
				},
				{
					name: "longitude",
					type: "number",
					label: "Longitude",
					required: true,
					min: -180,
					max: 180,
				},
			],
		},
		{
			type: "collapsible",
			label: "Extended details",
			admin: { initCollapsed: true },
			fields: [
				{
					name: "extendedMetadata",
					type: "group",
					label: false,
					fields: [
						{
							name: "surfaceAreaSqm",
							type: "number",
							label: "Surface area (m²)",
						},
						{
							name: "boundaryGeojson",
							type: "json",
							label: "Boundary (GeoJSON)",
						},
						{
							name: "coverPhoto",
							type: "upload",
							relationTo: "media",
							label: "Cover photo",
						},
						{
							name: "gallery",
							type: "relationship",
							relationTo: "media",
							hasMany: true,
							label: "Gallery",
						},
					],
				},
			],
		},
		{
			type: "collapsible",
			label: "Blockchain record",
			admin: {
				initCollapsed: true,
				description: "Populated on registration — inspect only.",
			},
			fields: [
				{
					name: "metadataHash",
					type: "text",
					label: "Verification fingerprint",
					index: true,
					admin: {
						readOnly: true,
						description: "Empty when no extended details are set.",
					},
				},
				{
					name: "chain",
					type: "group",
					label: false,
					fields: chainMirror(),
				},
			],
		},
		{
			name: "lifecycleStatus",
			type: "select",
			label: "Status",
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
		{
			name: "registerAction",
			type: "ui",
			admin: {
				position: "sidebar",
				components: {
					Field: "@/components/buttons/RegisterAreaButton",
				},
				condition: (data) =>
					data?.lifecycleStatus === "draft" ||
					data?.lifecycleStatus === "failed",
			},
		},
	],
};
