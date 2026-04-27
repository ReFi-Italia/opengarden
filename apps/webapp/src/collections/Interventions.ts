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
	"scheduling" | "completion",
	{ editableIn: ReadonlyArray<string>; inputFields: ReadonlyArray<string> }
> = {
	scheduling: {
		editableIn: ["draft"],
		inputFields: ["scheduledDate", "plannedDuration"],
	},
	completion: {
		editableIn: ["in_progress"],
		inputFields: ["reviewer", "approved", "qualityScore", "feedback"],
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
const stageAccess = (stage: keyof typeof STAGE_INPUT_RULES): FieldAccess => {
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

	guarded.cancellation = (originalDoc as Record<string, unknown>).cancellation;
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
			name: "plannedDuration",
			type: "number",
			label: "Planned duration (minutes)",
			min: 0,
			access: { update: stageAccess("scheduling") },
		},
		{
			name: "attestation",
			type: "relationship",
			relationTo: "attestations",
			label: "Schedule attestation",
			admin: {
				readOnly: true,
				description:
					"Attestation row for the schedule Activity. FIXME (spec-refactor): also surface the corresponding activities row once the scheduleIntervention task creates one.",
			},
		},
	],
};

const completionGroup: Field = {
	name: "completion",
	type: "group",
	label: "Completion review",
	admin: { condition: showInUpdateOnly },
	fields: [
		{
			name: "reviewer",
			type: "relationship",
			relationTo: "staff",
			label: "Reviewer",
			filterOptions: {
				capabilities: { contains: "validator" },
			},
			access: { update: stageAccess("completion") },
		},
		{
			name: "approved",
			type: "checkbox",
			label: "Approved",
			access: { update: stageAccess("completion") },
		},
		{
			name: "qualityScore",
			type: "number",
			label: "Quality score",
			min: 0,
			max: 10,
			access: { update: stageAccess("completion") },
		},
		{
			name: "feedback",
			type: "textarea",
			label: "Feedback",
			access: { update: stageAccess("completion") },
		},
	],
};

const cancellationGroup: Field = {
	name: "cancellation",
	type: "group",
	label: "Cancellation",
	admin: {
		readOnly: true,
		condition: showInUpdateOnly,
		description:
			"Populated when the intervention is cancelled. A replacement (if any) is linked via supersededBy.",
	},
	fields: [
		{ name: "reason", type: "textarea", label: "Reason" },
		{ name: "cancelledAt", type: "date", label: "Cancelled at" },
		{
			name: "cancelledFrom",
			type: "select",
			label: "Cancelled from stage",
			options: INTERVENTION_LIFECYCLE_STATUSES.filter(
				(s) =>
					s === "draft" ||
					s === "scheduled" ||
					s === "in_progress" ||
					s === "completed",
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
			name: "tasks",
			type: "array",
			label: "Tasks",
			fields: [
				{ name: "code", type: "text", label: "Code", required: true },
				{ name: "label", type: "text", label: "Label", required: true },
			],
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
		completionGroup,

		cancellationGroup,
		lifecycleStatusField(),
		{
			name: "supersededBy",
			type: "relationship",
			relationTo: "interventions",
			label: "Superseded by",
			admin: {
				readOnly: true,
				condition: (data) => data?.lifecycleStatus === "cancelled",
				description:
					"Replacement intervention created after this one was cancelled.",
			},
		},
		{
			name: "scheduleAction",
			type: "ui",
			admin: {
				position: "sidebar",
				components: {
					Field: "@/components/buttons/ScheduleButton",
				},
				condition: (data) => data?.lifecycleStatus === "draft",
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
			name: "completeAction",
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
				condition: (data) => data?.lifecycleStatus === "completed",
			},
		},
		{
			name: "cancelAction",
			type: "ui",
			admin: {
				position: "sidebar",
				components: {
					Field: "@/components/buttons/CancelInterventionButton",
				},
				condition: (data) =>
					["draft", "scheduled", "in_progress", "completed"].includes(
						data?.lifecycleStatus ?? "",
					),
			},
		},
		{
			name: "publishAttestation",
			type: "relationship",
			relationTo: "attestations",
			label: "Publication attestation",
			admin: { readOnly: true, condition: showInUpdateOnly },
		},
		{
			name: "activities",
			type: "join",
			collection: "activities",
			on: "intervention",
			admin: { condition: showInUpdateOnly },
		},
	],
};
