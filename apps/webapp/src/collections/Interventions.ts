import { InterventionType } from "@refi-italia/opengarden";
import type {
	CollectionAfterReadHook,
	CollectionBeforeValidateHook,
	CollectionConfig,
	Field,
	FieldAccess,
} from "payload";
import { APIError } from "payload";
import { authenticated } from "../access/authenticated";
import { isAuthoringOrAbove } from "../access/isAuthoringOrAbove";
import { chainMirror } from "../fields/chainMirror";
import {
	INTERVENTION_LIFECYCLE_STATUSES,
	lifecycleStatusField,
} from "../fields/lifecycleStatus";
import { commissioningFields } from "../fields/sponsorRef";
import { validateInterventionTransition } from "../hooks/validateInterventionTransition";

/**
 * InterventionType enum values are stored as string-encoded integers
 * ("0".."5") to round-trip through Payload's string-based select. Server
 * actions parse them back to the numeric enum before calling the SDK.
 */
const INTERVENTION_TYPE_OPTIONS = [
	{ label: "Unspecified", value: String(InterventionType.Unspecified) },
	{
		label: "Routine maintenance",
		value: String(InterventionType.RoutineMaintenance),
	},
	{ label: "Restoration", value: String(InterventionType.Restoration) },
	{ label: "Emergency", value: String(InterventionType.Emergency) },
	{ label: "Seasonal", value: String(InterventionType.Seasonal) },
	{ label: "New planting", value: String(InterventionType.NewPlanting) },
];

/**
 * Per-stage form-write rules. Each stage group exposes a small set of
 * operator-editable input fields while the row is in the matching
 * `lifecycleStatus`; everything else (chain mirrors, snapshots, task-set
 * fields) is always frozen at the form level. Server actions still bypass
 * via `req.context.skipLifecycleHooks: true`.
 *
 * The `revocation` group is always frozen at the form level — only the
 * (future) revocation server action writes it.
 */
const STAGE_INPUT_RULES: Record<
	"scheduling" | "validation" | "execution",
	{ editableIn: ReadonlyArray<string>; inputFields: ReadonlyArray<string> }
> = {
	scheduling: {
		editableIn: ["draft", "failed"],
		inputFields: ["scheduledDate", "estimatedMinutes"],
	},
	// Validation inputs land while the doc is `pending_validation` — the new
	// gate state between in_progress (crew activity) and validated (validator
	// signed off).
	validation: {
		editableIn: ["pending_validation"],
		inputFields: ["validator", "approved", "qualityScore", "feedback"],
	},
	// Execution summary fields are filled while the work is happening (or
	// being reviewed), so they're editable in both `in_progress` and
	// `pending_validation`. This puts the date/health observations next to
	// the crew activity that produced them.
	execution: {
		editableIn: ["in_progress", "pending_validation"],
		inputFields: ["executionDate", "healthBefore", "healthAfter"],
	},
};

/**
 * UI-only condition: stage groups (scheduling/validation/execution/revocation)
 * are hidden during create so the create form only renders identity fields.
 * Server-side guards in `guardInterventionInvariants` still enforce per-stage
 * editability — this only affects what Payload's stock form displays.
 */
const showInUpdateOnly = (
	_data: Record<string, unknown>,
	_siblingData: Record<string, unknown>,
	{ operation }: { operation: "create" | "read" | "update" | "delete" },
) => operation === "update";

/**
 * Derives a field-level `access.update` from `STAGE_INPUT_RULES` so the admin
 * UI disables inputs in stages where `guardInterventionInvariants` would merge
 * them back to their stored values anyway. Keeps the UI and server gates
 * driven by a single table.
 */
const stageAccess = (
	stage: keyof typeof STAGE_INPUT_RULES,
): FieldAccess => {
	const editableIn = STAGE_INPUT_RULES[stage].editableIn;
	return ({ doc }) => {
		if (!doc) return true;
		const status = (doc as { lifecycleStatus?: string }).lifecycleStatus;
		return !!status && editableIn.includes(status);
	};
};

const guardInterventionInvariants: CollectionBeforeValidateHook = async ({
	data,
	originalDoc,
	operation,
	context,
}) => {
	if (!data) return data;

	if (Array.isArray(data.crew)) {
		const leadCount = data.crew.filter(
			(row: { isCrewLead?: boolean }) => row?.isCrewLead === true,
		).length;
		if (leadCount > 1) {
			throw new APIError(
				"At most one crew member can be marked as crew lead.",
				400,
			);
		}
	}

	if (context?.skipLifecycleHooks) return data;
	if (operation !== "update" || !originalDoc) return data;

	const guarded: Record<string, unknown> = { ...data };
	const currentStatus = (originalDoc as { lifecycleStatus?: string })
		.lifecycleStatus;

	for (const [groupName, rule] of Object.entries(STAGE_INPUT_RULES)) {
		const incomingGroup = (data as Record<string, unknown>)[groupName] as
			| Record<string, unknown>
			| undefined;
		const originalGroup =
			((originalDoc as Record<string, unknown>)[groupName] as
				| Record<string, unknown>
				| undefined) ?? {};

		if (!incomingGroup) {
			guarded[groupName] = originalGroup;
			continue;
		}

		const allowEdit =
			currentStatus !== undefined && rule.editableIn.includes(currentStatus);
		if (!allowEdit) {
			guarded[groupName] = originalGroup;
			continue;
		}

		// Merge: input fields from `incoming`, everything else from `original`.
		// Chain mirror sub-fields and task-set snapshots stay frozen even while
		// the input fields are open for edit.
		const merged: Record<string, unknown> = { ...originalGroup };
		for (const fieldName of rule.inputFields) {
			if (fieldName in incomingGroup) {
				merged[fieldName] = incomingGroup[fieldName];
			}
		}
		guarded[groupName] = merged;
	}

	guarded.revocation = (originalDoc as Record<string, unknown>).revocation;
	return guarded;
};

const deriveCrewSize: CollectionAfterReadHook = async ({ doc }) => {
	const crew = (doc as { crew?: unknown[] }).crew;
	(doc as Record<string, unknown>).crewSize = Array.isArray(crew)
		? crew.length
		: 0;
	return doc;
};

const schedulingGroup: Field = {
	name: "scheduling",
	type: "group",
	label: "Scheduling",
	admin: { condition: showInUpdateOnly },
	fields: [
		{
			name: "scheduledDate",
			type: "date",
			label: "Scheduled date",
			access: { update: stageAccess("scheduling") },
		},
		{
			name: "estimatedMinutes",
			type: "number",
			label: "Estimated minutes",
			access: { update: stageAccess("scheduling") },
		},
		{
			type: "collapsible",
			label: "Blockchain record",
			admin: { initCollapsed: true },
			fields: chainMirror(),
		},
	],
};

const validationGroup: Field = {
	name: "validation",
	type: "group",
	label: "Validation",
	admin: { condition: showInUpdateOnly },
	fields: [
		{
			name: "validator",
			type: "relationship",
			relationTo: "staff",
			label: "Validator",
			filterOptions: {
				capabilities: { contains: "validator" },
			},
			access: { update: stageAccess("validation") },
		},
		{
			name: "approved",
			type: "checkbox",
			label: "Approved",
			access: { update: stageAccess("validation") },
		},
		{
			name: "qualityScore",
			type: "number",
			label: "Quality score",
			min: 0,
			max: 10,
			access: { update: stageAccess("validation") },
		},
		{
			name: "feedback",
			type: "textarea",
			label: "Feedback",
			access: { update: stageAccess("validation") },
		},
		{
			type: "collapsible",
			label: "Blockchain record",
			admin: { initCollapsed: true },
			fields: [
				{
					name: "validatorIdHashAtValidation",
					type: "text",
					label: "Validator fingerprint (snapshot)",
					admin: { readOnly: true },
				},
				{
					name: "currentAttestation",
					type: "relationship",
					relationTo: "adminValidations",
					label: "Current attestation",
					admin: { readOnly: true },
				},
				...chainMirror(),
			],
		},
	],
};

const executionGroup: Field = {
	name: "execution",
	type: "group",
	label: "Execution",
	admin: { condition: showInUpdateOnly },
	fields: [
		{
			name: "executionDate",
			type: "date",
			label: "Execution date",
			access: { update: stageAccess("execution") },
		},
		{
			name: "healthBefore",
			type: "number",
			label: "Health before",
			min: 0,
			max: 10,
			access: { update: stageAccess("execution") },
		},
		{
			name: "healthAfter",
			type: "number",
			label: "Health after",
			min: 0,
			max: 10,
			access: { update: stageAccess("execution") },
		},
		{
			name: "evidenceBundle",
			type: "relationship",
			relationTo: "evidenceBundles",
			label: "Evidence bundle",
			admin: { readOnly: true },
		},
		{
			name: "offchainCount",
			type: "number",
			label: "Off-chain records",
			admin: { readOnly: true },
		},
		{
			type: "collapsible",
			label: "Blockchain record",
			admin: { initCollapsed: true },
			fields: chainMirror(),
		},
	],
};

const revocationGroup: Field = {
	name: "revocation",
	type: "group",
	label: "Incidents",
	admin: {
		readOnly: true,
		condition: showInUpdateOnly,
		description:
			"Populated when the intervention is revoked or fails mid-lifecycle.",
	},
	fields: [
		{ name: "reason", type: "textarea", label: "Reason" },
		{ name: "revokedAt", type: "date", label: "Revoked at" },
		{
			name: "revokedScheduleUID",
			type: "text",
			label: "Revoked attestation ID",
		},
		{
			name: "failedFrom",
			type: "select",
			label: "Failed from stage",
			options: INTERVENTION_LIFECYCLE_STATUSES.filter(
				(s) =>
					s === "draft" ||
					s === "scheduled" ||
					s === "in_progress" ||
					s === "pending_validation" ||
					s === "validated",
			).map((value) => ({ label: value, value })),
		},
	],
};

export const Interventions: CollectionConfig = {
	slug: "interventions",
	admin: {
		useAsTitle: "interventionId",
		group: "Lifecycle",
		defaultColumns: [
			"interventionId",
			"area",
			"lifecycleStatus",
			"scheduling.scheduledDate",
		],
		components: {
			views: {
				edit: {
					default: {
						Component: "@/components/views/InterventionWorkflow#default",
					},
				},
			},
		},
	},
	access: {
		read: authenticated,
		create: isAuthoringOrAbove,
		update: isAuthoringOrAbove,
		delete: isAuthoringOrAbove,
	},
	versions: false,
	hooks: {
		beforeValidate: [guardInterventionInvariants],
		beforeChange: [validateInterventionTransition],
		afterRead: [deriveCrewSize],
	},
	fields: [
		{
			name: "interventionId",
			type: "text",
			label: "Intervention ID",
			required: true,
			unique: true,
			index: true,
		},
		{
			name: "area",
			type: "relationship",
			relationTo: "areas",
			label: "Area",
			required: true,
			filterOptions: {
				lifecycleStatus: { equals: "registered" },
			},
		},
		{
			name: "interventionType",
			type: "select",
			label: "Type",
			required: true,
			options: INTERVENTION_TYPE_OPTIONS,
		},
		{
			name: "description",
			type: "textarea",
			label: "Description",
			required: true,
		},
		{
			name: "commissioning",
			type: "group",
			label: "Commissioning",
			fields: commissioningFields(),
		},
		{
			name: "crew",
			type: "array",
			label: "Crew",
			minRows: 1,
			fields: [
				{
					name: "gardener",
					type: "relationship",
					relationTo: "gardeners",
					label: "Gardener",
					required: true,
					filterOptions: {
						status: { equals: "active" },
					},
				},
				{
					name: "isCrewLead",
					type: "checkbox",
					label: "Crew lead",
					defaultValue: false,
				},
			],
		},
		{
			name: "crewSize",
			type: "number",
			label: "Crew size",
			virtual: true,
			admin: {
				readOnly: true,
				condition: showInUpdateOnly,
			},
		},
		schedulingGroup,
		validationGroup,
		executionGroup,
		revocationGroup,
		lifecycleStatusField(),
		{
			name: "scheduleAction",
			type: "ui",
			admin: {
				position: "sidebar",
				components: {
					Field: "@/components/buttons/ScheduleButton",
				},
				condition: (data) =>
					data?.lifecycleStatus === "draft" ||
					data?.lifecycleStatus === "failed",
			},
		},
		{
			name: "startWorkAction",
			type: "ui",
			admin: {
				position: "sidebar",
				components: {
					Field: "@/components/buttons/StartWorkButton",
				},
				condition: (data) => data?.lifecycleStatus === "scheduled",
			},
		},
		{
			name: "validateAction",
			type: "ui",
			admin: {
				position: "sidebar",
				components: {
					Field: "@/components/buttons/ValidateButton",
				},
				condition: (data) => data?.lifecycleStatus === "in_progress",
			},
		},
		{
			name: "publishAction",
			type: "ui",
			admin: {
				position: "sidebar",
				components: {
					Field: "@/components/buttons/PublishInterventionButton",
				},
				condition: (data) => data?.lifecycleStatus === "validated",
			},
		},
	],
};
