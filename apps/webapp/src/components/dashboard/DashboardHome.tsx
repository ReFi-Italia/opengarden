import { headers as getHeaders } from "next/headers.js";
import { getPayload } from "payload";
import type { ActivityType } from "@/collections/Activities";
import config from "@/payload.config";
import type { Activity, Area, Gardener, Intervention } from "@/payload-types";
import "./DashboardHome.scss";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getGreeting(now: Date): string {
	const h = now.getHours();
	if (h < 12) return "Good morning";
	if (h < 17) return "Good afternoon";
	return "Good evening";
}

function formatFullDate(d: Date): string {
	return d.toLocaleDateString("en-GB", {
		weekday: "long",
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}

function formatShortDate(d: Date): string {
	return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatTime(iso: string): string {
	return new Date(iso).toLocaleTimeString("en-GB", {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
}

/** Local YYYY-MM-DD string — avoids UTC-shift from toISOString() */
function localDateStr(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getInitials(name: string): string {
	return name
		.split(/\s+/)
		.slice(0, 2)
		.map((w) => w[0]?.toUpperCase() ?? "")
		.join("");
}

function resolveArea(area: string | Area | null | undefined): Area | null {
	if (!area || typeof area === "string") return null;
	return area;
}

function getAreaName(inv: Intervention): string {
	return resolveArea(inv.area)?.name ?? "—";
}

function getAreaMunicipality(inv: Intervention): string {
	return resolveArea(inv.area)?.municipality ?? "";
}

function getAreaLabel(inv: Intervention): string {
	const m = getAreaMunicipality(inv);
	return m ? `${getAreaName(inv)} · ${m}` : getAreaName(inv);
}

function getCrewLead(
	inv: Intervention,
): { name: string; initials: string } | null {
	const entry = (inv.crew ?? []).find((c) => c.isCrewLead);
	if (!entry) return null;
	if (typeof entry.gardener === "string") return null;
	const name = entry.gardener?.displayName ?? null;
	if (!name) return null;
	return { name, initials: getInitials(name) };
}

function getDaysStalled(inv: Intervention, now: Date): number {
	return Math.floor(
		(now.getTime() - new Date(inv.createdAt).getTime()) / (1000 * 60 * 60 * 24),
	);
}

interface WeekDayItem {
	areaName: string;
	leadInitials: string;
	type: "progress" | "done" | "scheduled";
}

interface WeekDay {
	label: string;
	num: number;
	isToday: boolean;
	isWeekend: boolean;
	isPast: boolean;
	items: WeekDayItem[];
}

const WEEK_ITEM_TYPE_BY_STATUS: Record<
	Intervention["lifecycleStatus"],
	WeekDayItem["type"]
> = {
	draft: "scheduled",
	scheduled: "scheduled",
	in_progress: "progress",
	completed: "done",
	published: "done",
	cancelled: "scheduled",
};

function getStage(
	inv: Intervention,
	now: Date,
): { class: string; label: string } {
	switch (inv.lifecycleStatus) {
		case "completed":
			return { class: "urgent", label: "Validation pending" };
		case "in_progress":
			return { class: "starting", label: "In progress" };
		case "scheduled":
			return { class: "stalled", label: "Starts today" };
		default:
			return {
				class: "stalled",
				label: `Draft · ${getDaysStalled(inv, now)}d stalled`,
			};
	}
}

const ACTIVITY_TYPE_CLASS: Record<ActivityType, string> = {
	schedule: "schedule",
	checkin: "checkin",
	checkout: "checkin",
	report: "validation",
	healthcheck: "schedule",
};

const PIPELINE_STAGES = [
	{ key: "draft", label: "Draft", cls: "draft" },
	{ key: "scheduled", label: "Scheduled", cls: "scheduled" },
	{ key: "in_progress", label: "In progress", cls: "progress" },
	{ key: "completed", label: "Pending validation", cls: "pending" },
	{ key: "published", label: "Published", cls: "published" },
] as const;

function computeWeekDays(now: Date, interventions: Intervention[]): WeekDay[] {
	const dayOfWeek = now.getDay(); // 0 = Sun
	const monday = new Date(now);
	monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
	monday.setHours(0, 0, 0, 0);

	const todayStr = localDateStr(now);
	const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

	const byDate = new Map<string, Intervention[]>();
	for (const inv of interventions) {
		const sd = inv.scheduling?.scheduledDate;
		if (!sd) continue;
		const key = sd.slice(0, 10);
		const bucket = byDate.get(key);
		if (bucket) bucket.push(inv);
		else byDate.set(key, [inv]);
	}

	return Array.from({ length: 7 }, (_, i) => {
		const date = new Date(monday);
		date.setDate(monday.getDate() + i);
		const dateStr = localDateStr(date);
		const dayInvs = byDate.get(dateStr) ?? [];

		return {
			label: dayLabels[i] ?? "",
			num: date.getDate(),
			isToday: dateStr === todayStr,
			isWeekend: i >= 5,
			isPast: dateStr < todayStr,
			items: dayInvs.map((inv) => ({
				areaName: getAreaName(inv),
				leadInitials: getCrewLead(inv)?.initials ?? "—",
				type: WEEK_ITEM_TYPE_BY_STATUS[inv.lifecycleStatus],
			})),
		};
	});
}

// ─── Component ───────────────────────────────────────────────────────────────

export default async function DashboardHome() {
	const requestHeaders = await getHeaders();
	const payloadConfig = await config;
	const payload = await getPayload({ config: payloadConfig });
	const { user } = await payload.auth({ headers: requestHeaders });

	const now = new Date();
	const todayStart = new Date(now);
	todayStart.setHours(0, 0, 0, 0);
	const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
	const todayStr = localDateStr(todayStart);

	const [invResult, gardenerResult, todayCheckinsResult, recentActivities] =
		await Promise.all([
			payload.find({
				collection: "interventions",
				depth: 1,
				limit: 200,
				overrideAccess: true,
			}),
			payload.find({
				collection: "gardeners",
				where: { status: { in: ["active", "onboarding"] } },
				limit: 50,
			}),
			payload.count({
				collection: "activities",
				where: {
					and: [
						{ type: { equals: "checkin" } },
						{
							claimedTimestamp: {
								greater_than_equal: todayStart.toISOString(),
							},
						},
					],
				},
				overrideAccess: true,
			}),
			payload.find({
				collection: "activities",
				depth: 1,
				limit: 10,
				sort: "-claimedTimestamp",
				overrideAccess: true,
			}),
		]);

	const interventions = invResult.docs as Intervention[];
	const gardeners = gardenerResult.docs as Gardener[];
	const activities = recentActivities.docs as Activity[];

	// ── Derived data ──────────────────────────────────────────────────────────

	// Single pass: status counts + focus buckets + hero pick.
	// Focus order: validated (oldest first) → in_progress → scheduled today → stalled drafts.
	const statusCounts: Record<string, number> = {};
	const completedBucket: Intervention[] = [];
	const inProgressBucket: Intervention[] = [];
	const scheduledTodayBucket: Intervention[] = [];
	const stalledDraftsBucket: Intervention[] = [];
	let heroIntervention: Intervention | null = null;

	for (const inv of interventions) {
		statusCounts[inv.lifecycleStatus] =
			(statusCounts[inv.lifecycleStatus] ?? 0) + 1;

		if (inv.lifecycleStatus === "completed") {
			completedBucket.push(inv);
		} else if (inv.lifecycleStatus === "in_progress") {
			inProgressBucket.push(inv);
		} else if (
			inv.lifecycleStatus === "scheduled" &&
			inv.scheduling?.scheduledDate?.startsWith(todayStr)
		) {
			scheduledTodayBucket.push(inv);
		} else if (
			inv.lifecycleStatus === "draft" &&
			new Date(inv.createdAt) < sevenDaysAgo
		) {
			stalledDraftsBucket.push(inv);
		}

		if (
			!heroIntervention &&
			(inv.lifecycleStatus === "completed" ||
				inv.lifecycleStatus === "in_progress")
		) {
			heroIntervention = inv;
		}
	}
	completedBucket.sort(
		(a, b) =>
			new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
	);
	const focusItems = [
		...completedBucket,
		...inProgressBucket,
		...scheduledTodayBucket,
		...stalledDraftsBucket,
	].slice(0, 5);

	const heroLead = heroIntervention ? getCrewLead(heroIntervention) : null;

	const weekDays = computeWeekDays(now, interventions);

	// Gardener → current in_progress intervention mapping
	const gardenerAssignments = new Map<
		string,
		{ intervention: Intervention; isLead: boolean }
	>();
	for (const inv of interventions) {
		if (inv.lifecycleStatus !== "in_progress") continue;
		for (const entry of inv.crew ?? []) {
			const gId =
				typeof entry.gardener === "string"
					? entry.gardener
					: entry.gardener.id;
			if (!gardenerAssignments.has(gId)) {
				gardenerAssignments.set(gId, {
					intervention: inv,
					isLead: entry.isCrewLead ?? false,
				});
			}
		}
	}

	const inProgressCount = statusCounts["in_progress"] ?? 0;
	const completedCount = statusCounts["completed"] ?? 0;
	const incidentCount = statusCounts["cancelled"] ?? 0;
	const todayCheckinCount = todayCheckinsResult.totalDocs;
	const inMotionCount = interventions.filter(
		(i) => !["published", "cancelled"].includes(i.lifecycleStatus),
	).length;

	const pipelineSegments = PIPELINE_STAGES.flatMap(({ key, cls }) => {
		const count = statusCounts[key] ?? 0;
		const flex = key === "published" ? Math.max(count, 1) : count;
		return flex > 0 ? [{ key, cls, flex }] : [];
	});

	const weekStart = weekDays[0];
	const weekEnd = weekDays[6];
	const weekLabel = weekStart && weekEnd
		? `${weekStart.num}–${weekEnd.num} ${formatShortDate(new Date(now.getFullYear(), now.getMonth()))}`
		: "";

	// ── Render ────────────────────────────────────────────────────────────────

	return (
		<div className="dash-root">
			<div className="dash-page">
				{/* ─── Greeting ─────────────────────────────────────────────────── */}
				<header className="dash-greet">
					<div>
						<div className="dash-greet-meta">{formatFullDate(now)}</div>
						<h1 className="dash-greet-name">
							{getGreeting(now)},{" "}
							<span className="dash-u">
								{user?.displayName ?? user?.email ?? "there"}
							</span>
							.
						</h1>
					</div>
					<div className="dash-greet-sub">
						<span className="dash-v">{inProgressCount}</span> on site
						{completedCount > 0 && (
							<>
								{" "}
								·{" "}
								<span className="dash-v">{completedCount}</span> awaiting
								sign-off
							</>
						)}
					</div>
				</header>

				{/* ─── Asymmetric grid ──────────────────────────────────────────── */}
				<div className="dash-asym">
					{/* ═══ LEFT: act-now flow ══════════════════════════════════════ */}
					<div className="dash-left">
						{/* Focus hero */}
						{heroIntervention ? (
							<section className="dash-focus-hero">
								<div className="fh-meta">
									{heroIntervention.lifecycleStatus === "completed"
										? "Awaiting your sign-off · validator queue"
										: "In progress · execution underway"}
								</div>
								<h2 className="fh-title">
									<a
										href={`/admin/collections/interventions/${heroIntervention.id}`}
										className="fh-link"
									>
										{heroIntervention.description}
									</a>
								</h2>
								<p className="fh-sub">
									{getAreaLabel(heroIntervention)}
									{" · "}
									{heroIntervention.interventionId}
									{heroLead ? ` · led by ${heroLead.name}` : ""}
								</p>
								<div className="fh-actions">
									<a
										href="/admin/collections/interventions"
										className="btn-secondary"
									>
										See all
									</a>
									<a
										href={`/admin/collections/interventions/${heroIntervention.id}`}
										className="btn-primary"
									>
										{heroIntervention.lifecycleStatus === "completed"
											? "Open validation"
											: "Open workflow"}
									</a>
								</div>
							</section>
						) : (
							<section className="dash-focus-hero dash-focus-empty">
								<div className="fh-meta">Queue clear</div>
								<h2 className="fh-title">
									No interventions need immediate attention.
								</h2>
								<p className="fh-sub">
									All caught up. Interventions appear here when they need your
									input.
								</p>
							</section>
						)}

						{/* Needs attention */}
						{focusItems.length > 0 && (
							<div className="dash-panel">
								<div className="dash-panel-header">
									<div className="dash-panel-title">
										Needs attention{" "}
										<small>{focusItems.length} items</small>
									</div>
									<div className="dash-panel-meta">
										<a href="/admin/collections/interventions">Open list →</a>
									</div>
								</div>
								<ul className="dash-focus-list">
									{focusItems.map((inv) => {
										const lead = getCrewLead(inv);
										const stage = getStage(inv, now);
										return (
											<li key={inv.id} className="dash-focus-row">
												<a
													href={`/admin/collections/interventions/${inv.id}`}
													className="dash-fr-link"
												>
													<div className="dash-fr-body">
														<div className="dash-fr-title">
															{inv.description}
														</div>
														<div className="dash-fr-area">
															<strong>{getAreaName(inv)}</strong>
															{getAreaMunicipality(inv)
																? ` · ${getAreaMunicipality(inv)}`
																: ""}
															{lead ? ` · lead ${lead.name}` : ""}
														</div>
														<div className="dash-fr-code">
															{inv.interventionId}
														</div>
													</div>
													<div className={`dash-fr-stage ${stage.class}`}>
														{stage.label}
													</div>
												</a>
											</li>
										);
									})}
								</ul>
							</div>
						)}

						{/* Week calendar */}
						<div className="dash-panel">
							<div className="dash-panel-header">
								<div className="dash-panel-title">
									Week schedule <small>{weekLabel}</small>
								</div>
							</div>
							<div className="dash-cal-week">
								{weekDays.map((day, i) => (
									<div
										key={i}
										className={[
											"dash-cal-day",
											day.isToday ? "today" : "",
											day.isWeekend ? "weekend" : "",
											day.isPast ? "past" : "",
										]
											.filter(Boolean)
											.join(" ")}
									>
										<div className="dash-day-head">
											<div className="dash-day-name">{day.label}</div>
											<div className="dash-day-num">{day.num}</div>
										</div>
										<div className="dash-day-items">
											{day.items.map((item, j) => (
												<div
													key={j}
													className={`dash-day-item ${item.type}`}
												>
													<div className="it-area">{item.areaName}</div>
													<div className="it-lead">{item.leadInitials}</div>
												</div>
											))}
										</div>
									</div>
								))}
							</div>
						</div>
					</div>

					{/* ═══ RIGHT: context rail ═════════════════════════════════════ */}
					<div className="dash-right">
						{/* Pipeline */}
						<div className="dash-panel">
							<div className="dash-panel-header">
								<div className="dash-panel-title">Pipeline</div>
								<div className="dash-panel-meta">
									<span style={{ color: "var(--dash-ink)" }}>
										{inMotionCount}
									</span>{" "}
									in motion
								</div>
							</div>

							<div className="dash-pipe-bar-wrap">
								<div className="dash-pipe-bar">
									{pipelineSegments.map(({ key, cls, flex }) => (
										<span
											key={key}
											className={`b-${cls}`}
											style={{ flexGrow: flex }}
										/>
									))}
									{interventions.length === 0 && (
										<span className="b-draft" style={{ flexGrow: 1 }} />
									)}
								</div>
							</div>

							<ul className="dash-pipe-list">
								{PIPELINE_STAGES.map(({ key, label, cls }) => (
									<li key={key} className={`dash-pipe-row ${cls}`}>
										<span className="pr-dot" />
										<span className="pr-name">{label}</span>
										<span className="pr-count">{statusCounts[key] ?? 0}</span>
										{key === "in_progress" && (statusCounts[key] ?? 0) > 0 && (
											<span className="pr-delta warn">on site</span>
										)}
										{key === "completed" && (statusCounts[key] ?? 0) > 0 && (
											<span className="pr-delta alert">
												{statusCounts[key]}×
											</span>
										)}
									</li>
								))}
							</ul>

							<div className="dash-pipe-total">
								<span>
									<span className="v">{statusCounts["published"] ?? 0}</span>{" "}
									published total
								</span>
								{incidentCount > 0 && (
									<span className="fail">
										<span className="v">{incidentCount}</span> incidents
									</span>
								)}
							</div>

							{/* Today pulse */}
							<div className="dash-pulse-divider">
								<div className="dash-section-label">
									Today · {formatShortDate(now)}
								</div>
								<div className="dash-pulse-grid">
									<div
										className={`dash-pulse-cell ${todayCheckinCount > 0 ? "ok" : "zero"}`}
									>
										<div className="pc-num">{todayCheckinCount}</div>
										<div className="pc-label">Check-ins</div>
									</div>
									<div
										className={`dash-pulse-cell ${inProgressCount > 0 ? "warn" : "zero"}`}
									>
										<div className="pc-num">{inProgressCount}</div>
										<div className="pc-label">On site</div>
									</div>
									<div
										className={`dash-pulse-cell ${completedCount > 0 ? "warn" : "zero"}`}
									>
										<div className="pc-num">{completedCount}</div>
										<div className="pc-label">Validation</div>
									</div>
									<div
										className={`dash-pulse-cell ${incidentCount > 0 ? "warn" : "zero"}`}
									>
										<div className="pc-num">{incidentCount}</div>
										<div className="pc-label">Incidents</div>
									</div>
								</div>
							</div>
						</div>

						{/* Gardener team */}
						<div className="dash-panel">
							<div className="dash-panel-header">
								<div className="dash-panel-title">
									Gardeners <small>{gardeners.length} active</small>
								</div>
								<div className="dash-panel-meta">
									<a href="/admin/collections/gardeners">All →</a>
								</div>
							</div>
							<ul className="dash-team-list">
								{gardeners.slice(0, 5).map((g) => {
									const assignment = gardenerAssignments.get(g.id);
									const isLive = !!assignment;
									const isLead = assignment?.isLead ?? false;
									const assignedArea = assignment
										? getAreaName(assignment.intervention)
										: null;
									return (
										<li
											key={g.id}
											className={`dash-team-row ${isLead ? "lead" : ""}`}
										>
											<a
												href={`/admin/collections/gardeners/${g.id}`}
												className="dash-team-link"
											>
												<div className="dash-team-av">
													{getInitials(g.displayName)}
													{isLive && <span className="live" />}
												</div>
												<div className="dash-team-info">
													<div className="dash-team-name">{g.displayName}</div>
													<div className="dash-team-detail">
														{isLead && "Lead · "}
														{assignedArea ??
															(g.status === "onboarding"
																? "Onboarding"
																: "Available")}
													</div>
												</div>
											</a>
										</li>
									);
								})}
								{gardeners.length === 0 && (
									<li style={{ padding: "8px 0", color: "var(--dash-ink-3)", fontSize: "13px" }}>
										No active gardeners yet.
									</li>
								)}
							</ul>
						</div>

						{/* Activity ledger */}
						<div className="dash-panel">
							<div className="dash-panel-header">
								<div className="dash-panel-title">
									Activity <small>recent</small>
								</div>
								<div className="dash-panel-meta">
									<a href="/admin/collections/activities">All →</a>
								</div>
							</div>
							{activities.length === 0 ? (
								<div className="dash-empty-ledger">No recent activity.</div>
							) : (
								<ul className="dash-ledger-list">
									{activities.map((act) => {
										const inv =
											typeof act.intervention === "object" && act.intervention
												? (act.intervention as Intervention)
												: null;
										const typeClass = ACTIVITY_TYPE_CLASS[act.type];
										const label = act.label ?? act.type;
										return (
											<li
												key={act.id}
												className={`dash-ledger-row ${typeClass}`}
											>
												<div className="ledger-time">
													{formatTime(act.claimedTimestamp)}
												</div>
												<div className="ledger-body">
													<div className="act">{label}</div>
													{inv?.id && (
														<div className="sub">
															<a
																href={`/admin/collections/interventions/${inv.id}`}
																className="code"
															>
																{inv.interventionId}
															</a>
														</div>
													)}
												</div>
											</li>
										);
									})}
								</ul>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
