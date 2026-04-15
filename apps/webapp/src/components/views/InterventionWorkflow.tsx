import type {
	ClientField,
	DocumentViewServerProps,
	Field,
} from "payload";
import { createClientFields } from "payload";
import { importMap } from "@/app/(payload)/admin/importMap.js";
import type { Intervention } from "@/payload-types";
import { SetupForm } from "./SetupForm";
import { StageForm } from "./StageForm";
import "./InterventionWorkflow.scss";

// Which field names inside each group are operator-editable per stage. Mirrors
// `STAGE_INPUT_RULES` in the Interventions collection so the custom form only
// exposes fields the server-side guard will actually accept.
const STAGE_INPUTS: Record<string, readonly string[]> = {
	scheduling: ["scheduledDate", "estimatedMinutes"],
	validation: ["validator", "approved", "qualityScore", "feedback"],
	execution: ["executionDate", "healthBefore", "healthAfter"],
};

function findGroupFields(
	fields: readonly Field[],
	groupName: string,
): Field[] | undefined {
	for (const field of fields) {
		if (
			"type" in field &&
			field.type === "group" &&
			"name" in field &&
			field.name === groupName
		) {
			return field.fields;
		}
	}
	return undefined;
}

const STAGE_FORM_TITLES: Record<string, string> = {
	draft: "Scheduling",
	failed: "Re-scheduling",
	scheduled: "Ready to start",
	in_progress: "Validation",
	validated: "Execution & publish",
	published: "Lifecycle complete",
	revoked: "Revoked",
};

const INTERVENTION_TYPE_LABELS: Record<string, string> = {
	"0": "Unspecified",
	"1": "Routine maintenance",
	"2": "Restoration",
	"3": "Emergency",
	"4": "Seasonal",
	"5": "New planting",
};

const MAIN_PATH = [
	"draft",
	"scheduled",
	"in_progress",
	"validated",
	"published",
] as const;

const STAGE_LABELS: Record<string, string> = {
	draft: "Drafted",
	scheduled: "Scheduled",
	in_progress: "In progress",
	validated: "Validated",
	published: "Published",
	revoked: "Revoked",
	failed: "Failed",
};

async function InterventionWorkflow(props: DocumentViewServerProps) {
	const { doc, payload, initPageResult } = props;
	const id = (doc as { id?: string | number })?.id;

	// Collection fields are used in both create and edit paths below.
	const collectionFields =
		payload.collections.interventions?.config.fields ?? [];

	// ─── Create mode ──────────────────────────────────────────────────
	// The custom view handles both /create and /:id. When there's no doc
	// id, defer to Payload's stock `DefaultEditView` (wrapped via
	// `SetupForm`) so the create flow gets the fully-wired collection
	// form — relationship pickers, crew array, validation, save, and the
	// post-create redirect — for free. Stage groups (scheduling/validation
	// /execution/revocation) are hidden via `admin.condition` in the
	// collection config, so create mode shows only identity fields.
	if (id === undefined) {
		return (
			<SetupForm
				documentSubViewType={props.documentSubViewType}
				formState={props.formState}
				viewType={props.viewType}
			/>
		);
	}

	// ─── Edit mode ────────────────────────────────────────────────────
	// Repopulate at depth 2 so area/sponsor/crew-gardener relationships render as
	// objects instead of bare IDs.
	const intervention =
		id !== undefined
			? await payload
					.findByID({
						collection: "interventions",
						id: String(id),
						depth: 2,
						overrideAccess: false,
						user: initPageResult?.req?.user ?? undefined,
					})
					.catch(() => doc as unknown as Intervention)
			: (doc as unknown as Intervention);

	const inv = intervention as Intervention | undefined;
	const status = (inv?.lifecycleStatus ?? "draft") as keyof typeof STAGE_LABELS;
	const typeLabel =
		INTERVENTION_TYPE_LABELS[String(inv?.interventionType ?? "")] ?? "—";

	const area = inv?.area;
	const areaName =
		area && typeof area === "object"
			? ((area as { name?: string }).name ?? "—")
			: "—";

	const commissioning = inv?.commissioning as
		| { sponsor?: unknown }
		| undefined;
	const sponsor = commissioning?.sponsor;
	const sponsorName =
		sponsor && typeof sponsor === "object"
			? ((sponsor as { displayName?: string }).displayName ?? "—")
			: "—";

	const crew = Array.isArray(inv?.crew) ? inv.crew : [];
	const currentIdx = (MAIN_PATH as readonly string[]).indexOf(status);
	const isTerminal = status === "failed" || status === "revoked";

	const executionGroup = inv?.execution as
		| { evidenceBundle?: unknown }
		| undefined;

	// Extract the editable ClientField[] for each stage group. We pass the group
	// children directly (not the wrapping group) so the group's readOnly admin
	// flag doesn't cascade to our form, and render them under `parentPath` so
	// their form-state keys match the doc shape (`scheduling.scheduledDate`).
	const buildStageFields = (groupName: string): ClientField[] => {
		const allowed = STAGE_INPUTS[groupName];
		const groupFields = findGroupFields(collectionFields, groupName);
		if (!allowed || !groupFields) return [];
		const editable = groupFields.filter(
			(f): f is Field & { name: string } =>
				"name" in f && typeof f.name === "string" && allowed.includes(f.name),
		);
		return createClientFields({
			fields: editable,
			defaultIDType: payload.db.defaultIDType ?? "text",
			i18n: props.i18n,
			importMap,
		});
	};

	const stageFieldsByGroup: Record<string, ClientField[]> = {
		scheduling: buildStageFields("scheduling"),
		validation: buildStageFields("validation"),
		execution: buildStageFields("execution"),
	};

	const stageParentPath =
		status === "draft" || status === "failed"
			? "scheduling"
			: status === "in_progress"
				? "validation"
				: status === "validated"
					? "execution"
					: "";

	const stageClientFields = stageParentPath
		? (stageFieldsByGroup[stageParentPath] ?? [])
		: [];

	return (
		<div className="iw">
			<header className="iw__header">
				<div className="iw__eyebrow">
					<span className="iw__eyebrow-dot" />
					<span>
						{typeLabel} · {areaName}
					</span>
				</div>
				{inv?.description ? (
					<p className="iw__description">{inv.description}</p>
				) : null}
				<div className="iw__meta-row">
					<span className={`iw__pill iw__pill--${status}`}>
						{STAGE_LABELS[status] ?? status}
					</span>
					<span className="iw__tag">{typeLabel}</span>
					<span className="iw__tag">
						{crew.length} {crew.length === 1 ? "crew member" : "crew"}
					</span>
				</div>
			</header>

			<section className="iw__rail-section">
				<div className="iw__section-label">Lifecycle</div>
				<div className="iw__rail">
					{MAIN_PATH.map((stage, idx) => {
						const state = isTerminal
							? idx <= currentIdx
								? "done"
								: "blocked"
							: idx < currentIdx
								? "done"
								: idx === currentIdx
									? "active"
									: "future";
						return (
							<div key={stage} className={`iw__stage iw__stage--${state}`}>
								<div className="iw__stage-head">
									<span className="iw__stage-num">
										{String(idx + 1).padStart(2, "0")}
									</span>
									<span className="iw__stage-dot" />
								</div>
								<div className="iw__stage-name">{STAGE_LABELS[stage]}</div>
								<div className="iw__stage-sub">
									{state === "done"
										? "done"
										: state === "active"
											? "current"
											: state === "blocked"
												? "blocked"
												: "pending"}
								</div>
							</div>
						);
					})}
				</div>
				{isTerminal ? (
					<div className={`iw__terminal iw__terminal--${status}`}>
						This intervention is <strong>{STAGE_LABELS[status]}</strong>. Later
						stages won't run.
					</div>
				) : null}
			</section>

			<section className="iw__action">
				<div className="iw__action-eyebrow">
					Current stage · awaiting next transition
				</div>
				<h2 className="iw__action-title">
					Stage is <em>{STAGE_LABELS[status] ?? status}</em>
				</h2>
				<p className="iw__action-sub">
					The stage-specific action (Schedule · Start work · Validate · Publish)
					will wire in next, calling the same server actions that back the
					existing sidebar buttons.
				</p>
			</section>

			<div className="iw__grid">
				<aside className="iw__col iw__col--identity">
					<div className="iw__block">
						<div className="iw__block-label">Site</div>
						<div className="iw__block-value">
							<span className="iw__block-strong">{areaName}</span>
						</div>
					</div>

					{inv?.description ? (
						<div className="iw__block">
							<div className="iw__block-label">Brief</div>
							<div className="iw__block-value iw__block-value--prose">
								{inv.description}
							</div>
						</div>
					) : null}

					<div className="iw__block">
						<div className="iw__block-label">Sponsor</div>
						<div className="iw__block-value">
							<span className="iw__block-strong">{sponsorName}</span>
						</div>
					</div>

					<div className="iw__block">
						<div className="iw__block-label">Crew · {crew.length}</div>
						{crew.length === 0 ? (
							<div className="iw__block-value iw__block-value--muted">
								No crew assigned
							</div>
						) : (
							<ul className="iw__crew">
								{crew.map((member, i) => {
									const g = (member as { gardener?: unknown }).gardener;
									const lead = Boolean(
										(member as { isCrewLead?: boolean }).isCrewLead,
									);
									const name =
										g && typeof g === "object"
											? ((g as { displayName?: string }).displayName ?? "—")
											: "—";
									return (
										<li
											// biome-ignore lint/suspicious/noArrayIndexKey: stable order from server
											key={i}
											className={`iw__crew-row${lead ? " iw__crew-row--lead" : ""}`}
										>
											<span className="iw__crew-name">{name}</span>
											<span className="iw__crew-role">
												{lead ? "Lead" : "Gardener"}
											</span>
										</li>
									);
								})}
							</ul>
						)}
					</div>
				</aside>

				<div className="iw__col iw__col--main">
					<div className="iw__panel">
						<div className="iw__panel-head">
							<div className="iw__panel-title">
								{STAGE_FORM_TITLES[status] ?? "Stage form"}
							</div>
							<div className="iw__panel-meta">
								stage {String(currentIdx + 1).padStart(2, "0")} ·{" "}
								{STAGE_LABELS[status] ?? status}
							</div>
						</div>
						<div className="iw__panel-body">
							<StageForm
								interventionId={String(id)}
								status={status}
								formState={props.formState}
								stageClientFields={stageClientFields}
								stageParentPath={stageParentPath}
							/>
						</div>
					</div>

					<div className="iw__panel">
						<div className="iw__panel-head">
							<div className="iw__panel-title">Evidence bundle</div>
							<div className="iw__panel-meta">
								{(inv?.execution as { evidenceBundle?: unknown })
									?.evidenceBundle
									? "linked"
									: "not yet built"}
							</div>
						</div>
						<div className="iw__panel-body">
							<p className="iw__placeholder">
								Photos, verification checks, and the bundle fingerprint will
								embed here once the execution stage produces a bundle.
							</p>
						</div>
					</div>
				</div>

				<aside className="iw__col iw__col--ledger">
					<div className="iw__ledger-head">
						<div className="iw__ledger-title">Chain ledger</div>
						<div className="iw__ledger-sub">Base Sepolia · EAS</div>
					</div>
					<p className="iw__placeholder">
						Chain events timeline will render here.
					</p>
				</aside>
			</div>
		</div>
	);
}

export default InterventionWorkflow;
