import type {
	ClientField,
	DocumentViewServerProps,
	Field,
	FormState,
} from "payload";
import { createClientFields } from "payload";
import { importMap } from "@/app/(payload)/admin/importMap.js";
import type { Intervention } from "@/payload-types";
import { RecordActivityForm } from "./RecordActivityForm";
import { SetupForm } from "./SetupForm";
import { StageForm } from "./StageForm";
import "./InterventionWorkflow.scss";

// Every activity-form subset. The form renders only these plus `type` +
// parent reference keys that are pre-filled in initialState.
const CHECKIN_FORM_FIELDS: readonly string[] = [
	"gardener",
	"latitude",
	"longitude",
	"claimedTimestamp",
	"photo",
];

const CHECKOUT_FORM_FIELDS: readonly string[] = [
	"parentActivity",
	"claimedTimestamp",
	"actualMinutes",
];

const REPORT_FORM_FIELDS: readonly string[] = [
	"parentActivity",
	"gardener",
	"claimedTimestamp",
	"tasksCompleted",
	"taskCount",
	"notes",
	"photo",
];

const HEALTHCHECK_FORM_FIELDS: readonly string[] = [
	"kind",
	"claimedTimestamp",
	"healthScore",
	"assessor",
	"assessorNotes",
	"photo",
];

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
	in_progress: "Execution & validation",
	validated: "Ready to publish",
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
				? "execution"
				: "";

	const stageClientFields = stageParentPath
		? (stageFieldsByGroup[stageParentPath] ?? [])
		: [];

	const showCrewActivity = status === "in_progress";

	let checkinClientFields: ClientField[] = [];
	let checkinInitialState: FormState = {};
	let checkoutClientFields: ClientField[] = [];
	let checkoutInitialState: FormState = {};
	let reportClientFields: ClientField[] = [];
	let reportInitialState: FormState = {};
	let healthcheckClientFields: ClientField[] = [];
	let healthcheckInitialState: FormState = {};
	let healthcheckCanRender = false;

	if (showCrewActivity) {
		// All activity form fields come from a single polymorphic collection
		// now. Each sub-form renders the subset relevant to its `type` +
		// carries the `type` + `intervention` + parent keys in form state.
		const activityFields =
			payload.collections.activities?.config.fields ?? [];
		const pickFields = (names: readonly string[]) =>
			createClientFields({
				fields: activityFields.filter(
					(f): f is Field & { name: string } =>
						"name" in f &&
						typeof f.name === "string" &&
						names.includes(f.name),
				),
				defaultIDType: payload.db.defaultIDType ?? "text",
				i18n: props.i18n,
				importMap,
			});

		checkinClientFields = pickFields(CHECKIN_FORM_FIELDS);
		checkoutClientFields = pickFields(CHECKOUT_FORM_FIELDS);

		// ─── Checkin defaults (gardener + lat/lng from area) ──────────
		const areaObj = inv?.area;
		const areaLat =
			areaObj && typeof areaObj === "object"
				? (areaObj as { latitude?: number }).latitude
				: undefined;
		const areaLng =
			areaObj && typeof areaObj === "object"
				? (areaObj as { longitude?: number }).longitude
				: undefined;

		const firstCrew = crew[0];
		const firstGardener = (firstCrew as { gardener?: unknown })?.gardener;
		const firstGardenerId =
			firstGardener && typeof firstGardener === "object"
				? String((firstGardener as { id?: string | number }).id ?? "")
				: firstGardener
					? String(firstGardener)
					: "";

		const nowISO = new Date().toISOString();

		checkinInitialState = {
			type: { value: "checkin", initialValue: "checkin" },
			intervention: {
				value: String(id),
				initialValue: String(id),
			},
			gardener: {
				value: firstGardenerId || null,
				initialValue: firstGardenerId || null,
			},
			latitude: {
				value: areaLat ?? 0,
				initialValue: areaLat ?? 0,
			},
			longitude: {
				value: areaLng ?? 0,
				initialValue: areaLng ?? 0,
			},
			claimedTimestamp: {
				value: nowISO,
				initialValue: nowISO,
			},
		} as FormState;

		// ─── Checkout defaults (parentActivity = most recent checkin without a matching checkout) ──
		const checkinActivitiesResult = await payload
			.find({
				collection: "activities",
				where: {
					and: [
						{ intervention: { equals: String(id) } },
						{ type: { equals: "checkin" } },
					],
				},
				depth: 0,
				limit: 50,
				sort: "-claimedTimestamp",
				overrideAccess: true,
			})
			.catch(() => ({
				docs: [] as Array<{ id: string | number; claimedTimestamp?: string }>,
			}));

		const checkoutActivitiesResult = await payload
			.find({
				collection: "activities",
				where: {
					and: [
						{ intervention: { equals: String(id) } },
						{ type: { equals: "checkout" } },
					],
				},
				depth: 0,
				limit: 50,
				overrideAccess: true,
			})
			.catch(() => ({
				docs: [] as Array<{ parentActivity?: string | number | { id?: string | number } }>,
			}));

		const closedCheckinIds = new Set(
			(checkoutActivitiesResult.docs ?? []).map((d) => {
				const p = d.parentActivity;
				if (typeof p === "object" && p !== null) {
					return String((p as { id?: string | number }).id ?? "");
				}
				return String(p ?? "");
			}),
		);
		const openCheckin = (checkinActivitiesResult.docs ?? []).find(
			(ci) => !closedCheckinIds.has(String(ci.id)),
		);
		const openCheckinId = openCheckin ? String(openCheckin.id) : "";

		// Default actualMinutes: now − open checkin's claimedTimestamp.
		let defaultActualMinutes = 60;
		if (openCheckin?.claimedTimestamp) {
			const startMs = new Date(openCheckin.claimedTimestamp).getTime();
			if (startMs > 0) {
				defaultActualMinutes = Math.max(
					1,
					Math.round((Date.now() - startMs) / 60000),
				);
			}
		}

		checkoutInitialState = {
			type: { value: "checkout", initialValue: "checkout" },
			intervention: {
				value: String(id),
				initialValue: String(id),
			},
			parentActivity: {
				value: openCheckinId || null,
				initialValue: openCheckinId || null,
			},
			claimedTimestamp: {
				value: nowISO,
				initialValue: nowISO,
			},
			actualMinutes: {
				value: defaultActualMinutes,
				initialValue: defaultActualMinutes,
			},
		} as FormState;

		// ─── Report defaults (parentActivity = checkout without matching report) ──
		reportClientFields = pickFields(REPORT_FORM_FIELDS);

		const reportActivitiesResult = await payload
			.find({
				collection: "activities",
				where: {
					and: [
						{ intervention: { equals: String(id) } },
						{ type: { equals: "report" } },
					],
				},
				depth: 0,
				limit: 50,
				overrideAccess: true,
			})
			.catch(() => ({
				docs: [] as Array<{
					parentActivity?: string | number | { id?: string | number };
				}>,
			}));

		const reportedCheckoutIds = new Set(
			(reportActivitiesResult.docs ?? []).map((d) => {
				const p = d.parentActivity;
				if (typeof p === "object" && p !== null) {
					return String((p as { id?: string | number }).id ?? "");
				}
				return String(p ?? "");
			}),
		);

		// Need the checkout rows with their parentActivity (=checkin) populated
		// so we can pick the right gardener via the checkin.
		const checkoutActivitiesDeep = await payload
			.find({
				collection: "activities",
				where: {
					and: [
						{ intervention: { equals: String(id) } },
						{ type: { equals: "checkout" } },
					],
				},
				depth: 2,
				limit: 50,
				sort: "-claimedTimestamp",
				overrideAccess: true,
			})
			.catch(() => ({
				docs: [] as Array<{
					id: string | number;
					parentActivity?: { gardener?: unknown } | null;
				}>,
			}));

		const openCheckoutForReport = (checkoutActivitiesDeep.docs ?? []).find(
			(co) => !reportedCheckoutIds.has(String(co.id)),
		);
		const openCheckoutId = openCheckoutForReport
			? String(openCheckoutForReport.id)
			: "";

		// Derive the gardener from the checkout's parent checkin.
		let reportGardenerId = "";
		if (openCheckoutForReport) {
			const parentCheckin = openCheckoutForReport.parentActivity;
			const g =
				parentCheckin && typeof parentCheckin === "object"
					? (parentCheckin as { gardener?: unknown }).gardener
					: undefined;
			if (g) {
				reportGardenerId =
					typeof g === "object" && g !== null
						? String((g as { id?: string | number }).id ?? "")
						: String(g);
			}
		}

		reportInitialState = {
			type: { value: "report", initialValue: "report" },
			intervention: {
				value: String(id),
				initialValue: String(id),
			},
			parentActivity: {
				value: openCheckoutId || null,
				initialValue: openCheckoutId || null,
			},
			gardener: {
				value: reportGardenerId || firstGardenerId || null,
				initialValue: reportGardenerId || firstGardenerId || null,
			},
			claimedTimestamp: {
				value: nowISO,
				initialValue: nowISO,
			},
			taskCount: { value: 1, initialValue: 1 },
			tasksCompleted: { value: "", initialValue: "" },
			notes: { value: "", initialValue: "" },
		} as FormState;

		// ─── Healthcheck defaults (pick next missing kind: before → after) ──
		healthcheckClientFields = pickFields(HEALTHCHECK_FORM_FIELDS);

		const healthcheckActivitiesResult = await payload
			.find({
				collection: "activities",
				where: {
					and: [
						{ intervention: { equals: String(id) } },
						{ type: { equals: "interventionHealthcheck" } },
					],
				},
				depth: 0,
				limit: 20,
				overrideAccess: true,
			})
			.catch(() => ({
				docs: [] as Array<{ kind?: "before" | "after" }>,
			}));

		const hasBefore = (healthcheckActivitiesResult.docs ?? []).some(
			(h) => h.kind === "before",
		);
		const hasAfter = (healthcheckActivitiesResult.docs ?? []).some(
			(h) => h.kind === "after",
		);
		// Only render if at least one kind is still missing
		healthcheckCanRender = !(hasBefore && hasAfter);
		const defaultKind: "before" | "after" = hasBefore ? "after" : "before";

		// Default assessor = currently logged-in staff if they have capabilities
		// matching a staff row; otherwise leave blank. Keep it simple: no lookup.
		healthcheckInitialState = {
			type: {
				value: "interventionHealthcheck",
				initialValue: "interventionHealthcheck",
			},
			intervention: {
				value: String(id),
				initialValue: String(id),
			},
			kind: { value: defaultKind, initialValue: defaultKind },
			claimedTimestamp: {
				value: nowISO,
				initialValue: nowISO,
			},
			healthScore: { value: 7, initialValue: 7 },
			assessorNotes: { value: "", initialValue: "" },
		} as FormState;
	}

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
								taskOverride={status === "in_progress" ? null : undefined}
							/>
						</div>
					</div>

					{status === "in_progress" ? (
						<div className="iw__panel">
							<div className="iw__panel-head">
								<div className="iw__panel-title">Validation</div>
								<div className="iw__panel-meta">
									stage {String(currentIdx + 1).padStart(2, "0")} · review
									&amp; approve
								</div>
							</div>
							<div className="iw__panel-body">
								<StageForm
									interventionId={String(id)}
									status={status}
									formState={props.formState}
									stageClientFields={stageFieldsByGroup.validation ?? []}
									stageParentPath="validation"
								/>
							</div>
						</div>
					) : null}

					{showCrewActivity ? (
						<div className="iw__panel">
							<div className="iw__panel-head">
								<div className="iw__panel-title">Crew activity</div>
								<div className="iw__panel-meta">
									check-in · check-out · report · healthcheck
								</div>
							</div>
							<div className="iw__panel-body">
								<div className="iw-form__section-label">Check-in</div>
								<RecordActivityForm
									label="Record check-in"
									doneLabel="Check-in recorded ✓"
									clientFields={checkinClientFields}
									formState={checkinInitialState}
								/>
								<div
									className="iw-form__section-label"
									style={{ marginTop: 24 }}
								>
									Check-out
								</div>
								<RecordActivityForm
									label="Record check-out"
									doneLabel="Check-out recorded ✓"
									clientFields={checkoutClientFields}
									formState={checkoutInitialState}
								/>
								<div
									className="iw-form__section-label"
									style={{ marginTop: 24 }}
								>
									Report
								</div>
								<RecordActivityForm
									label="Record report"
									doneLabel="Report recorded ✓"
									clientFields={reportClientFields}
									formState={reportInitialState}
								/>
								{healthcheckCanRender ? (
									<>
										<div
											className="iw-form__section-label"
											style={{ marginTop: 24 }}
										>
											Healthcheck
										</div>
										<RecordActivityForm
											label="Record healthcheck"
											doneLabel="Healthcheck recorded ✓"
											clientFields={healthcheckClientFields}
											formState={healthcheckInitialState}
										/>
									</>
								) : null}
							</div>
						</div>
					) : null}

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
