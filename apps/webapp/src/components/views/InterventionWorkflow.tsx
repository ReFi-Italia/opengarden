import type { DocumentViewServerProps } from "payload";
import type { Intervention } from "@/payload-types";
import { StageForm, type ValidatorOption } from "./StageForm";
import "./InterventionWorkflow.scss";

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
			? ((sponsor as { name?: string }).name ?? "—")
			: "—";

	const crew = Array.isArray(inv?.crew) ? inv.crew : [];
	const currentIdx = (MAIN_PATH as readonly string[]).indexOf(status);
	const isTerminal = status === "failed" || status === "revoked";

	// Validators for the in_progress stage form. Mirrors the Interventions
	// collection filterOptions: `{ capabilities: { contains: "validator" } }`.
	const validatorsResult = await payload
		.find({
			collection: "staff",
			where: { capabilities: { contains: "validator" } },
			limit: 100,
			depth: 0,
			overrideAccess: false,
			user: initPageResult?.req?.user ?? undefined,
		})
		.catch(() => ({ docs: [] as Array<{ id: string; name?: string }> }));

	const validators: ValidatorOption[] = (
		validatorsResult.docs as Array<{ id: string | number; name?: string }>
	).map((s) => ({
		id: String(s.id),
		name: s.name ?? String(s.id),
	}));

	const schedulingGroup = inv?.scheduling as
		| {
				scheduledDate?: string | null;
				estimatedMinutes?: number | null;
		  }
		| undefined;
	const validationGroup = inv?.validation as
		| {
				validator?: { id?: string | number } | string | number | null;
				approved?: boolean | null;
				qualityScore?: number | null;
				feedback?: string | null;
		  }
		| undefined;
	const executionGroup = inv?.execution as
		| {
				executionDate?: string | null;
				healthBefore?: number | null;
				healthAfter?: number | null;
				evidenceBundle?: unknown;
		  }
		| undefined;

	const validatorDefault =
		validationGroup?.validator && typeof validationGroup.validator === "object"
			? String(
					(validationGroup.validator as { id?: string | number }).id ?? "",
				)
			: validationGroup?.validator
				? String(validationGroup.validator)
				: null;

	const defaults = {
		scheduling: {
			scheduledDate: schedulingGroup?.scheduledDate ?? null,
			estimatedMinutes: schedulingGroup?.estimatedMinutes ?? null,
		},
		validation: {
			validator: validatorDefault,
			approved: validationGroup?.approved ?? null,
			qualityScore: validationGroup?.qualityScore ?? null,
			feedback: validationGroup?.feedback ?? null,
		},
		execution: {
			executionDate: executionGroup?.executionDate ?? null,
			healthBefore: executionGroup?.healthBefore ?? null,
			healthAfter: executionGroup?.healthAfter ?? null,
		},
	};

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
											? ((g as { name?: string }).name ?? "—")
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
								defaults={defaults}
								validators={validators}
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
