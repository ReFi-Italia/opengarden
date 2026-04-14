import { AreaType, InterventionType } from "@refi-italia/opengarden";
import { getPayload } from "payload";
import config from "../src/payload.config";

/**
 * Idempotent demo data seeder. Creates one of each registry row plus
 * two areas (one draft for the Register area button, one
 * pre-registered so the intervention can link to it) and a draft
 * intervention so an operator can walk the full lifecycle through the
 * admin UI buttons:
 *   Areas → Demo Garden (draft) → click Register area → registered
 *   Interventions → Demo Intervention → fill scheduling.* → click
 *     Schedule → Start work → fill validation.* → Validate →
 *     fill execution.* → Publish
 *
 * Re-running is a no-op: every entity is found-or-created by a stable
 * unique key (areaId, interventionId, staffId, sponsor canonical key,
 * gardener wallet).
 */

const SPONSOR_KEY = "DEMO-CT-001";
const STAFF_ID = "DEMO-STAFF-001";
const GARDENER_WALLET = "0xdde11000000000000000000000000000000d3b1f";
const AREA_DRAFT_ID = "DEMO-AREA-DRAFT";
const AREA_REGISTERED_ID = "DEMO-AREA-REGISTERED";
const INTERVENTION_ID = "DEMO-INT-001";

// Mock on-chain UID for the pre-registered demo area. Looks valid (32-byte
// hex) so Payload's filterOptions accepts the link, but doesn't reference
// any real on-chain attestation — chain-write tasks queued from the demo
// flow will produce real attestations whose `refUID` points at this
// non-existent UID. Fine for click-through demos; not for production.
const MOCK_AREA_CHAIN_UID =
	"0xde11000000000000000000000000000000000000000000000000000000000001";

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
	});
	return result.docs[0] ?? null;
}

console.log("Seeding demo data…");

const sponsor = await findOrCreate(
	"sponsor (Demo Municipality)",
	() =>
		findOne("sponsors", { "canonicalKey.contractNumber": { equals: SPONSOR_KEY } }),
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

const gardener = await findOrCreate(
	"gardener (Demo Gardener)",
	() => findOne("gardeners", { wallet: { equals: GARDENER_WALLET } }),
	() =>
		payload.create({
			collection: "gardeners",
			data: {
				displayName: "Demo Gardener",
				wallet: GARDENER_WALLET,
				status: "active",
			},
		}),
);

// Draft area — exists so the operator can test the Register area button.
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

// Pre-registered area — needed so the intervention's relationship
// `filterOptions: lifecycleStatus = registered` accepts the link.
const registeredArea = await findOrCreate(
	"area (Demo Garden — registered)",
	() => findOne("areas", { areaId: { equals: AREA_REGISTERED_ID } }),
	() =>
		payload.create({
			collection: "areas",
			data: {
				areaId: AREA_REGISTERED_ID,
				name: "Demo Garden (registered)",
				municipality: "Demo City",
				areaType: String(AreaType.PublicGreenSpace) as "1",
				latitude: 41.9101,
				longitude: 12.502,
				lifecycleStatus: "registered",
				chain: {
					chainUID: MOCK_AREA_CHAIN_UID,
					txHash: "0xdemo",
					chainIdSnapshot: 11_155_420,
				},
			},
		}),
);

await findOrCreate(
	"intervention (Demo Intervention — draft)",
	() => findOne("interventions", { interventionId: { equals: INTERVENTION_ID } }),
	() =>
		payload.create({
			collection: "interventions",
			data: {
				interventionId: INTERVENTION_ID,
				area: (registeredArea as { id: number }).id,
				interventionType: String(InterventionType.RoutineMaintenance) as "1",
				description:
					"Spring cleanup and routine maintenance for the demo garden.",
				commissioning: {
					sponsor: (sponsor as { id: number }).id,
				},
				crew: [
					{
						gardener: (gardener as { id: number }).id,
						isCrewLead: true,
					},
				],
				lifecycleStatus: "draft",
			},
		}),
);

console.log(
	"\nDone. Walk the lifecycle through the admin UI:\n" +
		"  1. Areas → Demo Garden → click Register area\n" +
		"  2. Interventions → Demo Intervention → fill scheduling.scheduledDate + estimatedMinutes → click Schedule\n" +
		"  3. Click Start work → fill validation.* → click Validate → fill execution.* → click Publish\n" +
		"  4. Manually create an evidenceBundles row linked to the intervention → click Build bundle → Verify bundle\n",
);

process.exit(0);
