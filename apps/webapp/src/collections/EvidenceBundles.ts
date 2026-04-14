import type { CollectionConfig } from "payload";
import { authenticated } from "../access/authenticated";
import { isAuthoringOrAbove } from "../access/isAuthoringOrAbove";
import {
	EVIDENCE_BUNDLE_STATES,
	enforceEvidenceBundleState,
} from "../hooks/enforceEvidenceBundleState";

export const EvidenceBundles: CollectionConfig = {
	slug: "evidenceBundles",
	admin: {
		group: "Lifecycle",
		useAsTitle: "interventionIdSnapshot",
		defaultColumns: [
			"interventionIdSnapshot",
			"bundleState",
			"verification.valid",
		],
	},
	access: {
		read: authenticated,
		create: isAuthoringOrAbove,
		update: isAuthoringOrAbove,
		delete: isAuthoringOrAbove,
	},
	hooks: {
		beforeChange: [enforceEvidenceBundleState],
	},
	fields: [
		{
			name: "intervention",
			type: "relationship",
			relationTo: "interventions",
			required: true,
			unique: true,
			index: true,
			admin: {
				description:
					"Source of truth for the 1:1 link. Set at bundle creation and never nulled.",
			},
		},
		{
			name: "bundleState",
			type: "select",
			required: true,
			defaultValue: "draft",
			admin: {
				readOnly: true,
				position: "sidebar",
				description:
					"Mutated only by build / upload / publish / verify / reset server actions.",
			},
			index: true,
			options: EVIDENCE_BUNDLE_STATES.map((value) => ({ label: value, value })),
		},
		{
			name: "interventionIdSnapshot",
			type: "text",
			admin: {
				readOnly: true,
				description:
					"Captured at build so the bundle stays legible if the parent is renamed.",
			},
		},
		{
			name: "areaUIDSnapshot",
			type: "text",
			admin: { readOnly: true },
		},
		{
			name: "scheduledRef",
			type: "text",
			admin: {
				readOnly: true,
				description: "UID of the ScheduledIntervention attestation.",
			},
		},
		{
			name: "crewMembers",
			type: "array",
			admin: {
				readOnly: true,
				description: "Denormalized per-crew-member attestation refs.",
			},
			fields: [
				{ name: "gardener", type: "relationship", relationTo: "gardeners" },
				{ name: "attesterWallet", type: "text" },
				{
					name: "checkin",
					type: "relationship",
					relationTo: "gardenerCheckins",
				},
				{
					name: "checkout",
					type: "relationship",
					relationTo: "gardenerCheckouts",
				},
				{ name: "report", type: "relationship", relationTo: "gardenerReports" },
			],
		},
		{
			name: "validationRef",
			type: "relationship",
			relationTo: "adminValidations",
			admin: { readOnly: true },
		},
		{
			name: "healthcheckBefore",
			type: "relationship",
			relationTo: "healthchecks",
			admin: { readOnly: true },
		},
		{
			name: "healthcheckAfter",
			type: "relationship",
			relationTo: "healthchecks",
			admin: { readOnly: true },
		},
		{
			name: "bundleJson",
			type: "json",
			admin: {
				readOnly: true,
				description:
					"Exact bytes uploaded to IPFS — preserved for re-verification.",
			},
		},
		{
			name: "bundleVersion",
			type: "text",
			defaultValue: "0.1.0",
			admin: { readOnly: true },
		},
		{
			name: "evidenceBundleHash",
			type: "text",
			index: true,
			admin: { readOnly: true },
		},
		{
			name: "verification",
			type: "group",
			admin: {
				readOnly: true,
				description:
					'Populated by the verify-bundle server action after publish. Drives the "valid?" column in list views.',
			},
			fields: [
				{ name: "valid", type: "checkbox", defaultValue: false },
				{ name: "attestationCount", type: "number" },
				{ name: "expectedCount", type: "number" },
				{ name: "temporalOrderValid", type: "checkbox", defaultValue: false },
				{ name: "timestampsVerified", type: "checkbox", defaultValue: false },
				{
					name: "healthcheckOrderValid",
					type: "checkbox",
					defaultValue: false,
				},
				{
					name: "executionDateBracketed",
					type: "checkbox",
					defaultValue: false,
				},
				{ name: "validationApproved", type: "checkbox", defaultValue: false },
				{ name: "lastVerifiedAt", type: "date" },
				{ name: "checksJson", type: "json" },
			],
		},
		{
			name: "buildIssuesJson",
			type: "json",
			admin: {
				readOnly: true,
				description:
					"Last validateFinalizeInput result; publish is disabled until empty.",
			},
		},
		{
			name: "lastError",
			type: "textarea",
			admin: {
				readOnly: true,
				description:
					'Captured on any "failed" transition so the admin can inspect.',
			},
		},
		{
			name: "buildAction",
			type: "ui",
			admin: {
				components: {
					Field: "@/components/buttons/BuildBundleButton",
				},
				condition: (data) =>
					data?.bundleState === "draft" || data?.bundleState === "failed",
			},
		},
		{
			name: "verifyAction",
			type: "ui",
			admin: {
				components: {
					Field: "@/components/buttons/VerifyBundleButton",
				},
				condition: (data) => data?.bundleState === "published",
			},
		},
	],
};
