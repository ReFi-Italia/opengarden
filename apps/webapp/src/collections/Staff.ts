import type { CollectionConfig } from "payload";
import { registryAccess } from "../access/registryAccess";
import { displayNameField } from "../fields/displayName";
import { computeStaffHash } from "../hooks/computeStaffHash";
import { freezeOnFirstUse } from "../hooks/freezeOnFirstUse";

const STAFF_CAPABILITIES = [
	"validator",
	"assessor",
	"crewLead",
] as const;

export const Staff: CollectionConfig = {
	slug: "staff",
	admin: {
		useAsTitle: "displayName",
		group: "Registry",
		defaultColumns: ["displayName", "staffId", "capabilities", "frozen"],
	},
	access: registryAccess,
	hooks: {
		beforeChange: [
			computeStaffHash,
			freezeOnFirstUse({ hashInputFields: ["staffId"] }),
		],
	},
	fields: [
		displayNameField,
		{
			type: "collapsible",
			label: "Identification",
			admin: { initCollapsed: false },
			fields: [
				{
					name: "staffId",
					type: "text",
					label: "Staff ID",
					required: true,
					unique: true,
					admin: {
						description: "Organisation-issued identifier — not an email.",
					},
				},
				{
					name: "staffIdHash",
					type: "text",
					label: "Verification fingerprint",
					index: true,
					admin: { readOnly: true },
				},
			],
		},
		{
			name: "capabilities",
			type: "select",
			label: "On-site roles",
			hasMany: true,
			options: STAFF_CAPABILITIES.map((value) => ({ label: value, value })),
			admin: {
				description:
					"Drives who appears in validator, healthcheck, and crew-lead dropdowns.",
			},
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
					"Locks automatically on first on-chain reference. After that, the Staff ID can't change.",
			},
		},
		{
			name: "linkedUser",
			type: "relationship",
			relationTo: "users",
			label: "Linked admin account",
			admin: {
				position: "sidebar",
				description: "Optional — lets this person log in to the dashboard.",
			},
		},
	],
};
