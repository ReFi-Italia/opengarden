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
			type: "tabs",
			tabs: [
				{
					label: "Overview",
					fields: [
						{
							name: "intervention",
							type: "relationship",
							relationTo: "interventions",
							label: "Intervention",
							required: true,
							unique: true,
							index: true,
							admin: {
								description: "Set at creation — can't be changed later.",
							},
						},
						{
							name: "interventionIdSnapshot",
							type: "text",
							label: "Intervention ID (snapshot)",
							admin: {
								readOnly: true,
								description: "Captured at build time.",
							},
						},
						{
							name: "areaUIDSnapshot",
							type: "text",
							label: "Area attestation ID",
							admin: { readOnly: true },
						},
						{
							name: "bundleVersion",
							type: "text",
							label: "Bundle version",
							defaultValue: "0.1.0",
							admin: { readOnly: true },
						},
						{
							name: "evidenceBundleHash",
							type: "text",
							label: "Verification fingerprint",
							index: true,
							admin: { readOnly: true },
						},
						{
							name: "crewMembers",
							type: "array",
							label: "Crew attestations",
							admin: { readOnly: true },
							fields: [
								{
									name: "gardener",
									type: "relationship",
									relationTo: "gardeners",
									label: "Gardener",
								},
								{
									name: "attesterWallet",
									type: "text",
									label: "Signer wallet",
								},
								{
									name: "checkin",
									type: "relationship",
									relationTo: "gardenerCheckins",
									label: "Check-in",
								},
								{
									name: "checkout",
									type: "relationship",
									relationTo: "gardenerCheckouts",
									label: "Check-out",
								},
								{
									name: "report",
									type: "relationship",
									relationTo: "gardenerReports",
									label: "Report",
								},
							],
						},
					],
				},
				{
					label: "Attestations",
					fields: [
						{
							name: "scheduledRef",
							type: "text",
							label: "Scheduling attestation",
							admin: { readOnly: true },
						},
						{
							name: "validationRef",
							type: "relationship",
							relationTo: "adminValidations",
							label: "Validation attestation",
							admin: { readOnly: true },
						},
						{
							name: "healthcheckBefore",
							type: "relationship",
							relationTo: "healthchecks",
							label: "Healthcheck before",
							admin: { readOnly: true },
						},
						{
							name: "healthcheckAfter",
							type: "relationship",
							relationTo: "healthchecks",
							label: "Healthcheck after",
							admin: { readOnly: true },
						},
					],
				},
				{
					label: "Verification",
					fields: [
						{
							name: "verification",
							type: "group",
							label: false,
							admin: { readOnly: true },
							fields: [
								{
									name: "valid",
									type: "checkbox",
									label: "Valid",
									defaultValue: false,
								},
								{
									name: "attestationCount",
									type: "number",
									label: "Attestations found",
								},
								{
									name: "expectedCount",
									type: "number",
									label: "Attestations expected",
								},
								{
									name: "temporalOrderValid",
									type: "checkbox",
									label: "Temporal order OK",
									defaultValue: false,
								},
								{
									name: "timestampsVerified",
									type: "checkbox",
									label: "Timestamps verified",
									defaultValue: false,
								},
								{
									name: "healthcheckOrderValid",
									type: "checkbox",
									label: "Healthcheck order OK",
									defaultValue: false,
								},
								{
									name: "executionDateBracketed",
									type: "checkbox",
									label: "Execution date in range",
									defaultValue: false,
								},
								{
									name: "validationApproved",
									type: "checkbox",
									label: "Validation approved",
									defaultValue: false,
								},
								{
									name: "lastVerifiedAt",
									type: "date",
									label: "Last verified at",
								},
								{
									type: "collapsible",
									label: "Verification details",
									admin: { initCollapsed: true },
									fields: [
										{
											name: "checksJson",
											type: "json",
											label: "Checks (raw)",
										},
									],
								},
							],
						},
					],
				},
				{
					label: "Diagnostics",
					fields: [
						{
							name: "buildIssuesJson",
							type: "json",
							label: "Build issues",
							admin: {
								readOnly: true,
								description: "Publish is disabled until empty.",
							},
						},
						{
							name: "lastError",
							type: "textarea",
							label: "Last error",
							admin: { readOnly: true },
						},
						{
							type: "collapsible",
							label: "Raw payload",
							admin: { initCollapsed: true },
							fields: [
								{
									name: "bundleJson",
									type: "json",
									label: false,
									admin: { readOnly: true },
								},
							],
						},
					],
				},
			],
		},
		{
			name: "bundleState",
			type: "select",
			label: "Status",
			required: true,
			defaultValue: "draft",
			admin: {
				readOnly: true,
				position: "sidebar",
			},
			index: true,
			options: EVIDENCE_BUNDLE_STATES.map((value) => ({ label: value, value })),
		},
		{
			name: "buildAction",
			type: "ui",
			admin: {
				position: "sidebar",
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
				position: "sidebar",
				components: {
					Field: "@/components/buttons/VerifyBundleButton",
				},
				condition: (data) => data?.bundleState === "published",
			},
		},
	],
};
