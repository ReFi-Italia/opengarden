"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { submitExecutionForm } from "@/actions/forms/submitExecutionForm";
import { submitSchedulingForm } from "@/actions/forms/submitSchedulingForm";
import { submitValidationForm } from "@/actions/forms/submitValidationForm";
import { startWorkAction } from "@/actions/startWork";

export type ValidatorOption = { id: string; name: string };

export type StageFormDefaults = {
	scheduling?: {
		scheduledDate?: string | null;
		estimatedMinutes?: number | null;
	};
	validation?: {
		validator?: string | null;
		approved?: boolean | null;
		qualityScore?: number | null;
		feedback?: string | null;
	};
	execution?: {
		executionDate?: string | null;
		healthBefore?: number | null;
		healthAfter?: number | null;
	};
};

export type StageFormProps = {
	interventionId: string;
	status: string;
	defaults: StageFormDefaults;
	validators: ValidatorOption[];
};

// ─── date helpers ────────────────────────────────────────────────────
function toLocalDateTimeInput(iso: string | null | undefined): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	const off = d.getTimezoneOffset() * 60000;
	return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

function toLocalDateInput(iso: string | null | undefined): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	const off = d.getTimezoneOffset() * 60000;
	return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

// ─── switcher ────────────────────────────────────────────────────────
export function StageForm(props: StageFormProps) {
	switch (props.status) {
		case "draft":
		case "failed":
			return <DraftStageForm {...props} />;
		case "scheduled":
			return <ScheduledStageForm {...props} />;
		case "in_progress":
			return <InProgressStageForm {...props} />;
		case "validated":
			return <ValidatedStageForm {...props} />;
		case "published":
			return (
				<div className="iw-form__done">
					Intervention is <strong>published</strong> on-chain. The lifecycle is
					complete.
				</div>
			);
		case "revoked":
			return (
				<div className="iw-form__done iw-form__done--failed">
					This intervention was <strong>revoked</strong> and cannot be modified.
				</div>
			);
		default:
			return (
				<div className="iw-form__done">Unknown status: {props.status}</div>
			);
	}
}

// ─── draft → schedule ────────────────────────────────────────────────
function DraftStageForm({ interventionId, defaults }: StageFormProps) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);

	const [scheduledDate, setScheduledDate] = useState(
		toLocalDateTimeInput(defaults.scheduling?.scheduledDate),
	);
	const [estimatedMinutes, setEstimatedMinutes] = useState(
		defaults.scheduling?.estimatedMinutes ?? 60,
	);

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault();
		setError(null);
		setSuccess(false);
		startTransition(async () => {
			const result = await submitSchedulingForm({
				id: interventionId,
				scheduledDate: new Date(scheduledDate).toISOString(),
				estimatedMinutes,
			});
			if (!result.ok) {
				setError(result.error);
				return;
			}
			setSuccess(true);
			setTimeout(() => router.refresh(), 1500);
		});
	};

	return (
		<form onSubmit={handleSubmit} className="iw-form">
			<div className="iw-form__row">
				<div className="iw-form__field">
					<label className="iw-form__label" htmlFor="iw-scheduledDate">
						Scheduled date &amp; time
					</label>
					<input
						id="iw-scheduledDate"
						className="iw-form__input"
						type="datetime-local"
						value={scheduledDate}
						onChange={(e) => setScheduledDate(e.target.value)}
						required
					/>
				</div>
				<div className="iw-form__field">
					<label className="iw-form__label" htmlFor="iw-estimatedMinutes">
						Estimated minutes
					</label>
					<input
						id="iw-estimatedMinutes"
						className="iw-form__input"
						type="number"
						min={1}
						value={estimatedMinutes}
						onChange={(e) => setEstimatedMinutes(Number(e.target.value))}
						required
					/>
				</div>
			</div>
			<Submit
				pending={pending}
				success={success}
				error={error}
				label="Schedule"
				pendingLabel="Scheduling…"
				successLabel="Scheduled ✓"
				disabled={!scheduledDate || estimatedMinutes <= 0}
			/>
		</form>
	);
}

// ─── scheduled → start work ──────────────────────────────────────────
function ScheduledStageForm({ interventionId, defaults }: StageFormProps) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);

	const handleStart = () => {
		setError(null);
		setSuccess(false);
		startTransition(async () => {
			const result = await startWorkAction(interventionId);
			if (!result.ok) {
				setError(result.error);
				return;
			}
			setSuccess(true);
			setTimeout(() => router.refresh(), 800);
		});
	};

	const when = defaults.scheduling?.scheduledDate
		? new Date(defaults.scheduling.scheduledDate).toLocaleString()
		: "—";

	return (
		<div className="iw-form">
			<p className="iw-form__help">
				The intervention is scheduled for{" "}
				<strong suppressHydrationWarning>{when}</strong>. Mark it as in
				progress when the crew is on site.
			</p>
			<div className="iw-form__actions">
				<button
					type="button"
					className="iw-form__submit"
					onClick={handleStart}
					disabled={pending || success}
				>
					{pending
						? "Starting…"
						: success
							? "Started ✓"
							: "Start work →"}
				</button>
				{error && <p className="iw-form__error">{error}</p>}
				{success && <p className="iw-form__ok">Refreshing view…</p>}
			</div>
		</div>
	);
}

// ─── in_progress → validate ──────────────────────────────────────────
function InProgressStageForm({
	interventionId,
	defaults,
	validators,
}: StageFormProps) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);

	const [validator, setValidator] = useState(() => {
		const v = defaults.validation?.validator;
		if (typeof v === "string") return v;
		return validators[0]?.id ?? "";
	});
	const [approved, setApproved] = useState(
		defaults.validation?.approved ?? true,
	);
	const [qualityScore, setQualityScore] = useState(
		defaults.validation?.qualityScore ?? 8,
	);
	const [feedback, setFeedback] = useState(defaults.validation?.feedback ?? "");

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault();
		setError(null);
		setSuccess(false);
		startTransition(async () => {
			const result = await submitValidationForm({
				id: interventionId,
				validator,
				approved,
				qualityScore,
				feedback,
			});
			if (!result.ok) {
				setError(result.error);
				return;
			}
			setSuccess(true);
			setTimeout(() => router.refresh(), 1500);
		});
	};

	return (
		<form onSubmit={handleSubmit} className="iw-form">
			<div className="iw-form__row">
				<div className="iw-form__field">
					<label className="iw-form__label" htmlFor="iw-validator">
						Validator
					</label>
					<select
						id="iw-validator"
						className="iw-form__select"
						value={validator}
						onChange={(e) => setValidator(e.target.value)}
						required
					>
						<option value="">Select a validator…</option>
						{validators.map((v) => (
							<option key={v.id} value={v.id}>
								{v.name}
							</option>
						))}
					</select>
				</div>
				<div className="iw-form__field">
					<span className="iw-form__label">Decision</span>
					<div className="iw-form__toggle">
						<button
							type="button"
							className={`iw-form__toggle-opt${approved ? " iw-form__toggle-opt--approve" : ""}`}
							onClick={() => setApproved(true)}
						>
							✓ Approve
						</button>
						<button
							type="button"
							className={`iw-form__toggle-opt${!approved ? " iw-form__toggle-opt--reject" : ""}`}
							onClick={() => setApproved(false)}
						>
							Reject
						</button>
					</div>
				</div>
			</div>
			<div className="iw-form__field">
				<label className="iw-form__label" htmlFor="iw-qualityScore">
					Quality score{" "}
					<span className="iw-form__label-value">{qualityScore} / 10</span>
				</label>
				<input
					id="iw-qualityScore"
					type="range"
					min={0}
					max={10}
					step={1}
					value={qualityScore}
					onChange={(e) => setQualityScore(Number(e.target.value))}
					className="iw-form__range"
				/>
			</div>
			<div className="iw-form__field">
				<label className="iw-form__label" htmlFor="iw-feedback">
					Feedback
				</label>
				<textarea
					id="iw-feedback"
					className="iw-form__textarea"
					value={feedback}
					onChange={(e) => setFeedback(e.target.value)}
					rows={4}
					placeholder="Field notes visible in the public attestation…"
				/>
			</div>
			<Submit
				pending={pending}
				success={success}
				error={error}
				label="Validate"
				pendingLabel="Validating…"
				successLabel="Validated ✓"
				disabled={!validator}
			/>
		</form>
	);
}

// ─── validated → publish ─────────────────────────────────────────────
function ValidatedStageForm({ interventionId, defaults }: StageFormProps) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);

	const [executionDate, setExecutionDate] = useState(
		toLocalDateInput(defaults.execution?.executionDate) ||
			toLocalDateInput(new Date().toISOString()),
	);
	const [healthBefore, setHealthBefore] = useState(
		defaults.execution?.healthBefore ?? 7,
	);
	const [healthAfter, setHealthAfter] = useState(
		defaults.execution?.healthAfter ?? 9,
	);

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault();
		setError(null);
		setSuccess(false);
		startTransition(async () => {
			const result = await submitExecutionForm({
				id: interventionId,
				executionDate: new Date(executionDate).toISOString(),
				healthBefore,
				healthAfter,
			});
			if (!result.ok) {
				setError(result.error);
				return;
			}
			setSuccess(true);
			setTimeout(() => router.refresh(), 1500);
		});
	};

	return (
		<form onSubmit={handleSubmit} className="iw-form">
			<div className="iw-form__row">
				<div className="iw-form__field">
					<label className="iw-form__label" htmlFor="iw-executionDate">
						Execution date
					</label>
					<input
						id="iw-executionDate"
						className="iw-form__input"
						type="date"
						value={executionDate}
						onChange={(e) => setExecutionDate(e.target.value)}
						required
					/>
				</div>
			</div>
			<div className="iw-form__row">
				<div className="iw-form__field">
					<label className="iw-form__label" htmlFor="iw-healthBefore">
						Health before{" "}
						<span className="iw-form__label-value">{healthBefore} / 10</span>
					</label>
					<input
						id="iw-healthBefore"
						type="range"
						min={0}
						max={10}
						value={healthBefore}
						onChange={(e) => setHealthBefore(Number(e.target.value))}
						className="iw-form__range"
					/>
				</div>
				<div className="iw-form__field">
					<label className="iw-form__label" htmlFor="iw-healthAfter">
						Health after{" "}
						<span className="iw-form__label-value">{healthAfter} / 10</span>
					</label>
					<input
						id="iw-healthAfter"
						type="range"
						min={0}
						max={10}
						value={healthAfter}
						onChange={(e) => setHealthAfter(Number(e.target.value))}
						className="iw-form__range"
					/>
				</div>
			</div>
			<p className="iw-form__help">
				Publishing requires a built evidence bundle in <code>uploaded</code>{" "}
				state. If missing, this action will error — build it from the Evidence
				Bundles collection first.
			</p>
			<Submit
				pending={pending}
				success={success}
				error={error}
				label="Publish"
				pendingLabel="Publishing…"
				successLabel="Published ✓"
			/>
		</form>
	);
}

// ─── shared submit row ───────────────────────────────────────────────
function Submit({
	pending,
	success,
	error,
	label,
	pendingLabel,
	successLabel,
	disabled,
}: {
	pending: boolean;
	success: boolean;
	error: string | null;
	label: string;
	pendingLabel: string;
	successLabel: string;
	disabled?: boolean;
}) {
	return (
		<div className="iw-form__actions">
			<button
				type="submit"
				className="iw-form__submit"
				disabled={pending || success || disabled}
			>
				{pending ? pendingLabel : success ? successLabel : `${label} →`}
			</button>
			{error && <p className="iw-form__error">{error}</p>}
			{success && <p className="iw-form__ok">Refreshing view…</p>}
		</div>
	);
}

export default StageForm;
