import type { CollectionConfig } from "payload";
import { authenticated } from "../access/authenticated";
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
		create: () => false,
		update: () => false,
		delete: () => false,
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
						},
						{
							name: "interventionIdSnapshot",
							type: "text",
							label: "Intervention ID (snapshot)",
							admin: { description: "Captured at build time." },
						},
						{
							name: "areaUIDSnapshot",
							type: "text",
							label: "Area attestation ID",
						},
						{
							name: "bundleVersion",
							type: "text",
							label: "Bundle version",
							defaultValue: "0.1.0",
						},
						{
							name: "evidenceBundleHash",
							type: "text",
							label: "Verification fingerprint",
							index: true,
						},
						{
							name: "offchainCount",
							type: "number",
							label: "Off-chain attestation count",
							admin: { readOnly: true },
						},
						{
							name: "crewMembers",
							type: "array",
							label: "Crew attestations",
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
									relationTo: "activities",
									label: "Check-in",
								},
								{
									name: "checkout",
									type: "relationship",
									relationTo: "activities",
									label: "Check-out",
								},
								{
									name: "report",
									type: "relationship",
									relationTo: "activities",
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
						},
						{
							name: "validationRef",
							type: "relationship",
							relationTo: "attestations",
							label: "Validation attestation",
						},
						{
							name: "healthcheckActivity",
							type: "relationship",
							relationTo: "activities",
							label: "Healthcheck",
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
								description: "Publish is disabled until empty.",
							},
						},
						{
							name: "lastError",
							type: "textarea",
							label: "Last error",
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
			admin: { position: "sidebar" },
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
