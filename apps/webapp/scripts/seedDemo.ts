import { AreaType, InterventionType } from "@refi-italia/opengarden";
import { getPayload } from "payload";
import config from "../src/payload.config";

/**
 * Idempotent demo data seeder.
 *
 * Creates a full slice of the platform across every lifecycle stage so the
 * dashboard home and intervention workflow can be explored without running
 * any chain-write tasks:
 *
 *   Registry   → 1 sponsor, 1 staff validator, 5 gardeners
 *   Areas      → 1 draft, 3 registered (Demo, Villa Borghese, Parco Acquedotti)
 *   Interventions →
 *     DEMO-INT-001   draft      → walk full lifecycle via admin UI
 *     DEMO-INT-SCHED scheduled  → shows in week schedule panel (Apr 19)
 *     DEMO-INT-PROG  in_progress → has checkin/checkout/report/healthcheck activities
 *   Activities → 4 rows for DEMO-INT-PROG (feeds the activity ledger)
 *
 * Re-running is a no-op: every entity is found-or-created by a stable key.
 */

// ── Existing keys (do not change — idempotency) ───────────────────────
const SPONSOR_KEY = "DEMO-CT-001";
const STAFF_ID = "DEMO-STAFF-001";
const GARDENER_WALLET = "0xdde11000000000000000000000000000000000d3b1f";
const AREA_DRAFT_ID = "DEMO-AREA-DRAFT";
const AREA_REGISTERED_ID = "DEMO-AREA-REGISTERED";
const INTERVENTION_ID = "DEMO-INT-001";

// ── New keys ──────────────────────────────────────────────────────────
const GARDENER_2_WALLET = "0xde11000000000000000000000000000000000002";
const GARDENER_3_WALLET = "0xde11000000000000000000000000000000000003";
const GARDENER_4_WALLET = "0xde11000000000000000000000000000000000004";
const GARDENER_5_WALLET = "0xde11000000000000000000000000000000000005";
const AREA_VILLA_ID = "DEMO-AREA-VILLA";
const AREA_PARCO_ID = "DEMO-AREA-PARCO";
const INTERVENTION_SCHED_ID = "DEMO-INT-SCHED";
const INTERVENTION_PROG_ID = "DEMO-INT-PROG";

// ── Mock on-chain UIDs (look valid; no real attestations behind them) ─
const MOCK_AREA_CHAIN_UID =
	"0xde11000000000000000000000000000000000000000000000000000000000001";
const MOCK_VILLA_CHAIN_UID =
	"0xde11000000000000000000000000000000000000000000000000000000000002";
const MOCK_PARCO_CHAIN_UID =
	"0xde11000000000000000000000000000000000000000000000000000000000003";
const MOCK_SCHED_ATT_UID =
	"0xde11000000000000000000000000000000000000000000000000000000000010";
const MOCK_PROG_SCHED_ATT_UID =
	"0xde11000000000000000000000000000000000000000000000000000000000011";

// ── Activity timestamps (today = 2026-04-17) ──────────────────────────
const T_CHECKIN = "2026-04-17T08:30:00.000Z";
const T_CHECKOUT = "2026-04-17T11:00:00.000Z";
const T_REPORT = "2026-04-17T11:15:00.000Z";
const T_HEALTHCHECK = "2026-04-17T11:30:00.000Z";

// ─────────────────────────────────────────────────────────────────────

const payload = await getPayload({ config: await config });

async function findOrCreate<T>(
	label: string,
	find: () => Promise<T | null>,
	// biome-ignore lint/suspicious/noExplicitAny: variadic create return
	create: () => Promise<any>,
): Promise<T> {
	const existing = await find();
	if (existing) {
		console.log(`  ${label}: already exists`);
		return existing;
	}
	const created = await create();
	console.log(`  ${label}: created`);
	return created;
}

async function findOne<T extends string>(
	collection: T,
	// biome-ignore lint/suspicious/noExplicitAny: payload where types vary
	where: any,
	// biome-ignore lint/suspicious/noExplicitAny: doc shape varies per collection
): Promise<any | null> {
	const result = await payload.find({
		// biome-ignore lint/suspicious/noExplicitAny: generic helper
		collection: collection as any,
		where,
		limit: 1,
		depth: 0,
		overrideAccess: true,
	});
	return result.docs[0] ?? null;
}

async function findActivity(
	interventionId: string | number,
	type: string,
	// biome-ignore lint/suspicious/noExplicitAny: doc shape varies
): Promise<any | null> {
	return findOne("activities", {
		and: [
			{ intervention: { equals: String(interventionId) } },
			{ type: { equals: type } },
		],
	});
}

/** Find or create a committed attestation by UID. */
async function ensureAttestation(uid: string, data: Record<string, unknown>) {
	const existing = await findOne("attestations", { uid: { equals: uid } });
	if (existing) return existing;
	// biome-ignore lint/suspicious/noExplicitAny: seed helper
	return payload.create({ collection: "attestations", data: data as any, overrideAccess: true });
}

// ─────────────────────────────────────────────────────────────────────

console.log("\nSeeding demo data…\n");

// ── Phase 1: Registry ─────────────────────────────────────────────────

console.log("── Registry ──");

const sponsor = await findOrCreate(
	"sponsor (Demo Municipality)",
	() => findOne("sponsors", { "canonicalKey.contractNumber": { equals: SPONSOR_KEY } }),
	() =>
		payload.create({
			collection: "sponsors",
			data: {
				displayName: "Demo Municipality",
				kind: "municipal",
				canonicalKey: { contractNumber: SPONSOR_KEY },
			},
		}),
);

const staff = await findOrCreate(
	"staff (Demo Validator)",
	() => findOne("staff", { staffId: { equals: STAFF_ID } }),
	() =>
		payload.create({
			collection: "staff",
			data: {
				displayName: "Demo Validator",
				staffId: STAFF_ID,
				capabilities: ["validator"],
			},
		}),
);

// 5 gardeners so the dashboard team panel is fully populated
const gardener = await findOrCreate(
	"gardener (Demo Gardener — crew lead)",
	() => findOne("gardeners", { wallet: { equals: GARDENER_WALLET } }),
	() =>
		payload.create({
			collection: "gardeners",
			data: { displayName: "Demo Gardener", wallet: GARDENER_WALLET, status: "active" },
		}),
);

const gardener2 = await findOrCreate(
	"gardener (Carlo Bianchi)",
	() => findOne("gardeners", { wallet: { equals: GARDENER_2_WALLET } }),
	() =>
		payload.create({
			collection: "gardeners",
			data: { displayName: "Carlo Bianchi", wallet: GARDENER_2_WALLET, status: "active" },
		}),
);

const gardener3 = await findOrCreate(
	"gardener (Luca Moretti — in progress)",
	() => findOne("gardeners", { wallet: { equals: GARDENER_3_WALLET } }),
	() =>
		payload.create({
			collection: "gardeners",
			data: { displayName: "Luca Moretti", wallet: GARDENER_3_WALLET, status: "active" },
		}),
);

const gardener4 = await findOrCreate(
	"gardener (Sofia Romano)",
	() => findOne("gardeners", { wallet: { equals: GARDENER_4_WALLET } }),
	() =>
		payload.create({
			collection: "gardeners",
			data: { displayName: "Sofia Romano", wallet: GARDENER_4_WALLET, status: "active" },
		}),
);

await findOrCreate(
	"gardener (Matteo Gentile — onboarding)",
	() => findOne("gardeners", { wallet: { equals: GARDENER_5_WALLET } }),
	() =>
		payload.create({
			collection: "gardeners",
			data: { displayName: "Matteo Gentile", wallet: GARDENER_5_WALLET, status: "onboarding" },
		}),
);

// ── Phase 2: Areas ────────────────────────────────────────────────────

console.log("\n── Areas ──");

await findOrCreate(
	"area (Demo Garden — draft)",
	() => findOne("areas", { areaId: { equals: AREA_DRAFT_ID } }),
	() =>
		payload.create({
			collection: "areas",
			data: {
				areaId: AREA_DRAFT_ID,
				name: "Demo Garden (draft)",
				municipality: "Demo City",
				areaType: String(AreaType.PublicGreenSpace) as "1",
				latitude: 41.9028,
				longitude: 12.4964,
				lifecycleStatus: "draft",
			},
		}),
);

const registeredArea = await findOrCreate(
	"area (Demo Garden — registered)",
	() => findOne("areas", { areaId: { equals: AREA_REGISTERED_ID } }),
	async () => {
		const att = await ensureAttestation(MOCK_AREA_CHAIN_UID, {
			uid: MOCK_AREA_CHAIN_UID,
			schemaName: "AreaRegistration",
			signedAttestation: {},
			timestampTxHash: "0xdemo",
			chainIdSnapshot: 11_155_420,
			status: "committed",
			relatedCollection: "areas",
			relatedId: AREA_REGISTERED_ID,
		});
		return payload.create({
			collection: "areas",
			data: {
				areaId: AREA_REGISTERED_ID,
				name: "Demo Garden (registered)",
				municipality: "Demo City",
				areaType: String(AreaType.PublicGreenSpace) as "1",
				latitude: 41.9101,
				longitude: 12.502,
				lifecycleStatus: "registered",
				attestation: att.id,
			},
			overrideAccess: true,
		});
	},
);

const villaArea = await findOrCreate(
	"area (Villa Borghese — Pratone)",
	() => findOne("areas", { areaId: { equals: AREA_VILLA_ID } }),
	async () => {
		const att = await ensureAttestation(MOCK_VILLA_CHAIN_UID, {
			uid: MOCK_VILLA_CHAIN_UID,
			schemaName: "AreaRegistration",
			signedAttestation: {},
			timestampTxHash: "0xdemo",
			chainIdSnapshot: 11_155_420,
			status: "committed",
			relatedCollection: "areas",
			relatedId: AREA_VILLA_ID,
		});
		return payload.create({
			collection: "areas",
			data: {
				areaId: AREA_VILLA_ID,
				name: "Villa Borghese — Pratone",
				municipality: "Roma",
				areaType: String(AreaType.PublicGreenSpace) as "1",
				latitude: 41.9134,
				longitude: 12.4922,
				lifecycleStatus: "registered",
				attestation: att.id,
			},
			overrideAccess: true,
		});
	},
);

const parcoArea = await findOrCreate(
	"area (Parco degli Acquedotti)",
	() => findOne("areas", { areaId: { equals: AREA_PARCO_ID } }),
	async () => {
		const att = await ensureAttestation(MOCK_PARCO_CHAIN_UID, {
			uid: MOCK_PARCO_CHAIN_UID,
			schemaName: "AreaRegistration",
			signedAttestation: {},
			timestampTxHash: "0xdemo",
			chainIdSnapshot: 11_155_420,
			status: "committed",
			relatedCollection: "areas",
			relatedId: AREA_PARCO_ID,
		});
		return payload.create({
			collection: "areas",
			data: {
				areaId: AREA_PARCO_ID,
				name: "Parco degli Acquedotti",
				municipality: "Roma",
				areaType: String(AreaType.PublicGreenSpace) as "1",
				latitude: 41.8499,
				longitude: 12.5547,
				lifecycleStatus: "registered",
				attestation: att.id,
			},
			overrideAccess: true,
		});
	},
);

// ── Phase 3: Interventions ────────────────────────────────────────────

console.log("\n── Interventions ──");

await findOrCreate(
	"intervention (Demo Intervention — draft)",
	() => findOne("interventions", { interventionId: { equals: INTERVENTION_ID } }),
	() =>
		payload.create({
			collection: "interventions",
			data: {
				interventionId: INTERVENTION_ID,
				area: (registeredArea as { id: string }).id,
				interventionType: String(InterventionType.RoutineMaintenance) as "1",
				description: "Spring cleanup and routine maintenance for the demo garden.",
				commissioning: { sponsor: (sponsor as { id: string }).id },
				crew: [{ gardener: (gardener as { id: string }).id, isCrewLead: true }],
				lifecycleStatus: "draft",
			},
		}),
);

// Scheduled intervention — shows in week schedule panel (Apr 19)
await findOrCreate(
	"intervention (Spring Pruning — scheduled)",
	() => findOne("interventions", { interventionId: { equals: INTERVENTION_SCHED_ID } }),
	async () => {
		const schedAtt = await ensureAttestation(MOCK_SCHED_ATT_UID, {
			uid: MOCK_SCHED_ATT_UID,
			schemaName: "ScheduledIntervention",
			signedAttestation: {},
			timestampTxHash: "0xdemo",
			chainIdSnapshot: 11_155_420,
			status: "committed",
			relatedCollection: "interventions",
			relatedId: INTERVENTION_SCHED_ID,
		});
		return payload.create({
			collection: "interventions",
			data: {
				interventionId: INTERVENTION_SCHED_ID,
				area: (villaArea as { id: string }).id,
				interventionType: String(InterventionType.RoutineMaintenance) as "1",
				description: "Spring pruning, hedge trimming, and path clearing at Villa Borghese.",
				commissioning: { sponsor: (sponsor as { id: string }).id },
				crew: [
					{ gardener: (gardener as { id: string }).id, isCrewLead: true },
					{ gardener: (gardener2 as { id: string }).id, isCrewLead: false },
				],
				lifecycleStatus: "scheduled",
				scheduling: {
					scheduledDate: "2026-04-19T09:00:00.000Z",
					estimatedMinutes: 180,
					attestation: (schedAtt as { id: string }).id,
				},
			},
			overrideAccess: true,
			context: { skipLifecycleHooks: true },
		});
	},
);

// In-progress intervention — has activities for the ledger + live gardener
const progIntervention = await findOrCreate(
	"intervention (Storm cleanup — in progress)",
	() => findOne("interventions", { interventionId: { equals: INTERVENTION_PROG_ID } }),
	async () => {
		const schedAtt = await ensureAttestation(MOCK_PROG_SCHED_ATT_UID, {
			uid: MOCK_PROG_SCHED_ATT_UID,
			schemaName: "ScheduledIntervention",
			signedAttestation: {},
			timestampTxHash: "0xdemo",
			chainIdSnapshot: 11_155_420,
			status: "committed",
			relatedCollection: "interventions",
			relatedId: INTERVENTION_PROG_ID,
		});
		return payload.create({
			collection: "interventions",
			data: {
				interventionId: INTERVENTION_PROG_ID,
				area: (parcoArea as { id: string }).id,
				interventionType: String(InterventionType.RoutineMaintenance) as "1",
				description:
					"Emergency debris removal following storm damage at Parco degli Acquedotti.",
				commissioning: { sponsor: (sponsor as { id: string }).id },
				crew: [
					{ gardener: (gardener3 as { id: string }).id, isCrewLead: true },
					{ gardener: (gardener4 as { id: string }).id, isCrewLead: false },
				],
				lifecycleStatus: "in_progress",
				scheduling: {
					scheduledDate: "2026-04-17T08:00:00.000Z",
					estimatedMinutes: 150,
					attestation: (schedAtt as { id: string }).id,
				},
			},
			overrideAccess: true,
			context: { skipLifecycleHooks: true },
		});
	},
);

// ── Phase 4: Activities ───────────────────────────────────────────────

console.log("\n── Activities (DEMO-INT-PROG) ──");

const progId = (progIntervention as { id: string }).id;
const g3Id = (gardener3 as { id: string }).id;

// checkin — position at Parco degli Acquedotti
await findOrCreate(
	"activity (checkin — Luca Moretti)",
	() => findActivity(progId, "checkin"),
	() =>
		payload.create({
			collection: "activities",
			data: {
				type: "checkin",
				intervention: progId,
				gardener: g3Id,
				claimedTimestamp: T_CHECKIN,
				data: { latitude: 41.8499, longitude: 12.5547 },
			},
			overrideAccess: true,
		}),
);

// checkout — auto-linked to checkin by autoLinkParentActivity hook
await findOrCreate(
	"activity (checkout — Luca Moretti)",
	() => findActivity(progId, "checkout"),
	() =>
		payload.create({
			collection: "activities",
			data: {
				type: "checkout",
				intervention: progId,
				gardener: g3Id,
				claimedTimestamp: T_CHECKOUT,
				data: { actualMinutes: 150 },
			},
			overrideAccess: true,
		}),
);

// report — auto-linked to checkout
await findOrCreate(
	"activity (report — Luca Moretti)",
	() => findActivity(progId, "report"),
	() =>
		payload.create({
			collection: "activities",
			data: {
				type: "report",
				intervention: progId,
				gardener: g3Id,
				claimedTimestamp: T_REPORT,
				data: {
					tasksCompleted:
						"Cleared fallen branches from main pathways, removed debris from fountain area, secured two unstable fence sections, freed partially blocked storm drain",
					taskCount: 9,
					notes:
						"Storm drain on the south path is still partially restricted — flagged for municipal maintenance. Fence repairs are temporary; permanent fix needed within 2 weeks.",
				},
			},
			overrideAccess: true,
		}),
);

// healthcheck — records area condition before/after
await findOrCreate(
	"activity (healthcheck)",
	() => findActivity(progId, "healthcheck"),
	() =>
		payload.create({
			collection: "activities",
			data: {
				type: "healthcheck",
				intervention: progId,
				assessor: (staff as { id: string }).id,
				claimedTimestamp: T_HEALTHCHECK,
				data: {
					healthScore: 7,
					metadata: {
						version: 1,
						baseline: { score: 4 },
					},
				},
			},
			overrideAccess: true,
		}),
);

console.log(
	"\nDone.\n\n" +
		"Dashboard home → shows 5 gardeners, 3 interventions in pipeline, activity ledger, week schedule.\n\n" +
		"Walk the lifecycle via admin UI:\n" +
		"  1. Areas → Demo Garden (draft) → click Register area\n" +
		"  2. Interventions → Demo Intervention (DEMO-INT-001) → fill scheduling.* → Schedule → Start work\n" +
		"     → fill validation.* → Validate → (build bundle) → Publish\n" +
		"  3. DEMO-INT-SCHED is pre-scheduled for Apr 19 — visible in week schedule panel.\n" +
		"  4. DEMO-INT-PROG is in progress with 4 activities — visible in activity ledger.\n",
);

process.exit(0);
