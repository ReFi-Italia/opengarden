"use client";

import { Form, RenderFields } from "@payloadcms/ui";
import { useRouter } from "next/navigation";
import type { ClientField, FormState } from "payload";
import { useState, useTransition } from "react";
import { publishInterventionAction } from "@/actions/publishIntervention";
import { scheduleInterventionAction } from "@/actions/scheduleIntervention";
import { startWorkAction } from "@/actions/startWork";
import { validateInterventionAction } from "@/actions/validateIntervention";

export type StageFormProps = {
	interventionId: string;
	status: string;
	formState: FormState;
	stageClientFields: ClientField[];
	stageParentPath: string;
	taskOverride?: StageTask | null | undefined;
};

type TaskResult = { ok: true; jobId?: string } | { ok: false; error: string };
type TaskAction = (id: string) => Promise<TaskResult>;

type StageTask = {
	label: string;
	pendingLabel: string;
	doneLabel: string;
	action: TaskAction;
};

function stageTask(status: string): StageTask | null {
	switch (status) {
		case "draft":
		case "failed":
			return {
				label: "Schedule",
				pendingLabel: "Scheduling…",
				doneLabel: "Scheduled ✓",
				action: scheduleInterventionAction,
			};
		case "scheduled":
			return {
				label: "Start work",
				pendingLabel: "Starting…",
				doneLabel: "Started ✓",
				action: startWorkAction,
			};
		case "in_progress":
			return {
				label: "Validate",
				pendingLabel: "Validating…",
				doneLabel: "Validated ✓",
				action: validateInterventionAction,
			};
		case "validated":
			return {
				label: "Publish",
				pendingLabel: "Publishing…",
				doneLabel: "Published ✓",
				action: publishInterventionAction,
			};
		default:
			return null;
	}
}

// Keep only the stage-relevant entries so Form submits a minimal diff and
// Payload's guard hooks don't see stale chain-mirror fields.
function scopeFormState(
	formState: FormState,
	parentPath: string,
): FormState {
	if (!parentPath) return {};
	const scoped: FormState = {};
	const prefix = `${parentPath}.`;
	for (const key in formState) {
		if (key === parentPath || key.startsWith(prefix)) {
			scoped[key] = formState[key];
		}
	}
	return scoped;
}

export function StageForm(props: StageFormProps) {
	const { status, stageClientFields, stageParentPath, interventionId } = props;

	if (status === "published") {
		return (
			<div className="iw-form__done">
				Intervention is <strong>published</strong> on-chain. The lifecycle is
				complete.
			</div>
		);
	}

	if (status === "revoked") {
		return (
			<div className="iw-form__done iw-form__done--failed">
				This intervention was <strong>revoked</strong> and cannot be modified.
			</div>
		);
	}

	const task =
		props.taskOverride !== undefined ? props.taskOverride : stageTask(status);

	// `scheduled` has no editable fields — just a direct start-work button.
	if (status === "scheduled" && task) {
		return (
			<TriggerOnlyAction interventionId={interventionId} task={task} />
		);
	}

	return (
		<StageEditForm
			interventionId={interventionId}
			stageClientFields={stageClientFields}
			stageParentPath={stageParentPath}
			formState={props.formState}
			task={task}
		/>
	);
}

// ─── stage with editable fields (draft / in_progress / validated) ─────
function StageEditForm({
	interventionId,
	stageClientFields,
	stageParentPath,
	formState,
	task,
}: {
	interventionId: string;
	stageClientFields: ClientField[];
	stageParentPath: string;
	formState: FormState;
	/** Optional — pass null for a save-only form with no transition trigger. */
	task: StageTask | null;
}) {
	const router = useRouter();
	const [trigger, startTrigger] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);

	const scopedInitialState = scopeFormState(formState, stageParentPath);

	const onSuccess = () => {
		setError(null);
		// Save-only mode: no task trigger, just refresh the doc view.
		if (!task) {
			setSaved(true);
			setTimeout(() => router.refresh(), 800);
			return;
		}
		setSaved(false);
		// Save landed on Payload's REST. Now queue the lifecycle task so the
		// state machine actually advances. The existing task action reads the
		// (now-updated) doc and triggers the chain job.
		startTrigger(async () => {
			try {
				const result = await task.action(interventionId);
				if (!result.ok) {
					setError(result.error);
					return;
				}
				setSaved(true);
				// Give Payload's `after()` a beat to drain the queued task, then
				// refresh so the rail picks up the new lifecycleStatus.
				setTimeout(() => router.refresh(), 1500);
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			}
		});
	};

	return (
		<Form
			initialState={scopedInitialState}
			method="PATCH"
			action={`/api/interventions/${interventionId}`}
			isDocumentForm
			onSuccess={onSuccess}
			disableValidationOnSubmit
		>
			<RenderFields
				fields={stageClientFields}
				parentPath={stageParentPath}
				parentIndexPath=""
				parentSchemaPath={`interventions.${stageParentPath}`}
				permissions={true}
				forceRender
			/>
			<div className="iw-form__actions">
				<button
					type="submit"
					className="iw-form__submit"
					disabled={trigger || saved}
				>
					{task
						? trigger
							? task.pendingLabel
							: saved
								? task.doneLabel
								: `${task.label} →`
						: saved
							? "Saved ✓"
							: "Save"}
				</button>
				{error && <p className="iw-form__error">{error}</p>}
				{saved && <p className="iw-form__ok">Refreshing view…</p>}
			</div>
		</Form>
	);
}

// ─── scheduled → in_progress (no form fields) ─────────────────────────
function TriggerOnlyAction({
	interventionId,
	task,
}: {
	interventionId: string;
	task: StageTask;
}) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);

	const handleClick = () => {
		setError(null);
		setSuccess(false);
		startTransition(async () => {
			try {
				const result = await task.action(interventionId);
				if (!result.ok) {
					setError(result.error);
					return;
				}
				setSuccess(true);
				setTimeout(() => router.refresh(), 800);
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			}
		});
	};

	return (
		<div className="iw-form">
			<p className="iw-form__help">
				The crew is scheduled. Mark this intervention as in progress once
				they're on site.
			</p>
			<div className="iw-form__actions">
				<button
					type="button"
					className="iw-form__submit"
					onClick={handleClick}
					disabled={pending || success}
				>
					{pending
						? task.pendingLabel
						: success
							? task.doneLabel
							: `${task.label} →`}
				</button>
				{error && <p className="iw-form__error">{error}</p>}
				{success && <p className="iw-form__ok">Refreshing view…</p>}
			</div>
		</div>
	);
}

export default StageForm;
