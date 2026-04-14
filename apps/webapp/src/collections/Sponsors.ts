import type { CollectionConfig } from "payload";
import { authenticated } from "../access/authenticated";
import { isManagerOrAdmin } from "../access/isManagerOrAdmin";
import { computeSponsorHash } from "../hooks/computeSponsorHash";
import { freezeOnFirstUse } from "../hooks/freezeOnFirstUse";

export const SPONSOR_KINDS = [
	"corporate",
	"municipal",
	"grant",
	"volunteer",
] as const;

export const Sponsors: CollectionConfig = {
	slug: "sponsors",
	admin: {
		useAsTitle: "displayName",
		group: "Registry",
		defaultColumns: ["displayName", "kind", "frozen", "archived"],
	},
	access: {
		read: authenticated,
		create: isManagerOrAdmin,
		update: isManagerOrAdmin,
		delete: isManagerOrAdmin,
	},
	versions: {
		drafts: false,
		maxPerDoc: 50,
	},
	hooks: {
		beforeChange: [
			computeSponsorHash,
			freezeOnFirstUse({ hashInputFields: ["canonicalJson"] }),
		],
	},
	fields: [
		{
			name: "displayName",
			type: "text",
			required: true,
			label: "Display name",
		},
		{
			type: "collapsible",
			label: "Identification",
			admin: { initCollapsed: false },
			fields: [
				{
					name: "kind",
					type: "select",
					label: "Type",
					required: true,
					options: SPONSOR_KINDS.map((value) => ({ label: value, value })),
				},
				{
					name: "canonicalKey",
					type: "group",
					label: false,
					fields: [
						{
							name: "sponsorId",
							type: "text",
							label: "Sponsor ID",
							admin: {
								condition: (data) => data?.kind === "corporate",
							},
						},
						{
							name: "contractNumber",
							type: "text",
							label: "Contract number",
							admin: {
								condition: (data) => data?.kind === "municipal",
							},
						},
						{
							name: "grantId",
							type: "text",
							label: "Grant ID",
							admin: {
								condition: (data) => data?.kind === "grant",
							},
						},
					],
				},
			],
		},
		{
			name: "notes",
			type: "textarea",
		},
		{
			type: "collapsible",
			label: "Blockchain record",
			admin: {
				initCollapsed: true,
				description: "Populated automatically — inspect only.",
			},
			fields: [
				{
					name: "canonicalJson",
					type: "text",
					label: "Signed payload",
					index: true,
					admin: { readOnly: true },
				},
				{
					name: "commissionRefHash",
					type: "text",
					label: "Verification fingerprint",
					index: true,
					admin: {
						readOnly: true,
						description: "Empty for volunteer sponsors.",
					},
				},
			],
		},
		{
			name: "frozen",
			type: "checkbox",
			label: "Locked",
			defaultValue: false,
			admin: {
				position: "sidebar",
				readOnly: true,
				description:
					"Locks automatically on first use. After that, identification fields can't change.",
			},
		},
		{
			name: "archived",
			type: "checkbox",
			defaultValue: false,
			admin: {
				position: "sidebar",
				description: "Hide from dropdowns without deleting history.",
			},
		},
	],
};
