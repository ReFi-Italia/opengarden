import { AreaType } from "@refi-italia/opengarden";
import type { CollectionBeforeValidateHook, CollectionConfig } from "payload";
import { APIError } from "payload";
import { authenticated } from "../access/authenticated";
import { isAuthoringOrAbove } from "../access/isAuthoringOrAbove";

const AREA_LIFECYCLE_STATUSES = ["draft", "registered", "cancelled"] as const;

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
 * Once an area is `registered`, the hash-affecting inputs (`coordinates`,
 * `areaType`, `boundary`, `metadata`) must not change — they would
 * orphan the on-chain `AreaRegistration`. Display-only fields (`name`,
 * `municipality`, cover photo, gallery) remain editable.
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
		"coordinates",
		"areaType",
		"boundary",
		"metadata",
	] as const;
	for (const field of frozenFields) {
		const before = (originalDoc as Record<string, unknown>)[field];
		const after = (data as Record<string, unknown>)[field];
		if (
			after !== undefined &&
			JSON.stringify(after) !== JSON.stringify(before)
		) {
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
			name: "coordinates",
			type: "point",
		},
		{
			name: "boundary",
			type: "json",
			label: "Boundary (GeoJSON polygon)",
			admin: {
				description:
					"Optional polygon defining the area's extent. SDK hashes canonical JSON at publish time and commits keccak256 as boundariesHash.",
			},
		},
		{
			name: "metadata",
			type: "text",
			label: "Inline metadata (JSON)",
			admin: {
				description:
					"Optional small JSON string (≤512 bytes) for extras such as surface area, access hours, institutional labels. Signed inline with the attestation.",
			},
		},
		{
			type: "collapsible",
			label: "Presentation",
			admin: { initCollapsed: true },
			fields: [
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
		{
			name: "attestation",
			type: "relationship",
			relationTo: "attestations",
			label: "Registration attestation",
			admin: {
				readOnly: true,
				description: "Populated on registration — inspect only.",
			},
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
					data?.lifecycleStatus === "cancelled",
			},
		},
		{
			name: "activities",
			type: "join",
			collection: "activities",
			on: "area",
		},
	],
};
