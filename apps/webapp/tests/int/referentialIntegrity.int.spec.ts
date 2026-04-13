import { AreaType, InterventionType } from "@refi-italia/opengarden";
import { getPayload, type Payload } from "payload";
import { beforeAll, describe, expect, it } from "vitest";
import config from "@/payload.config";

let payload: Payload;

const uniqueId = (prefix: string) =>
	`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("Referential integrity walkthrough", () => {
	beforeAll(async () => {
		payload = await getPayload({ config: await config });
	});

	it("persists a full intervention chain end-to-end without invoking any SDK write", async () => {
		// Registry rows.
		const sponsor = await payload.create({
			collection: "sponsors",
			data: {
				displayName: "Roma Capitale",
				kind: "municipal",
				canonicalKey: { contractNumber: uniqueId("CT") },
			},
		});
		const validatorStaff = await payload.create({
			collection: "staff",
			data: {
				displayName: "Anna Rossi",
				staffId: uniqueId("STAFF"),
				capabilities: ["validator"],
			},
		});
		const gardenerA = await payload.create({
			collection: "gardeners",
			data: {
				displayName: "Marco Verdi",
				status: "active",
			},
		});
		const gardenerB = await payload.create({
			collection: "gardeners",
			data: {
				displayName: "Giulia Neri",
				status: "active",
			},
		});
		const area = await payload.create({
			collection: "areas",
			data: {
				areaId: uniqueId("AREA"),
				name: "Villa Borghese - Pratone",
				municipality: "Roma",
				areaType: String(AreaType.PublicGreenSpace) as "1",
				latitude: 41.91,
				longitude: 12.48,
				lifecycleStatus: "registered",
			},
		});

		// Intervention draft with crew.
		const intervention = await payload.create({
			collection: "interventions",
			data: {
				interventionId: uniqueId("INT"),
				area: area.id,
				interventionType: String(InterventionType.RoutineMaintenance) as "1",
				description: "Spring cleanup",
				commissioning: { sponsor: sponsor.id },
				crew: [
					{ gardener: gardenerA.id, isCrewLead: true },
					{ gardener: gardenerB.id, isCrewLead: false },
				],
				lifecycleStatus: "draft",
			},
		});

		// Move to scheduled then in_progress (through server-action context) so
		// we can attach checkin rows.
		await payload.update({
			collection: "interventions",
			id: intervention.id,
			data: { lifecycleStatus: "scheduled" },
			context: { skipLifecycleHooks: true },
		});
		await payload.update({
			collection: "interventions",
			id: intervention.id,
			data: { lifecycleStatus: "in_progress" },
			context: { skipLifecycleHooks: true },
		});

		const t0 = new Date("2026-05-01T08:00:00Z");
		const t1 = new Date("2026-05-01T11:30:00Z");

		const checkins = [];
		const checkouts = [];
		for (const g of [gardenerA, gardenerB]) {
			const checkin = await payload.create({
				collection: "gardenerCheckins",
				data: {
					intervention: intervention.id,
					gardener: g.id,
					latitude: 41.91,
					longitude: 12.48,
					claimedTimestamp: t0.toISOString(),
				},
			});
			checkins.push(checkin);
			const checkout = await payload.create({
				collection: "gardenerCheckouts",
				data: {
					checkin: checkin.id,
					claimedTimestamp: t1.toISOString(),
					actualMinutes: 210,
				},
			});
			checkouts.push(checkout);
		}

		const validation = await payload.create({
			collection: "adminValidations",
			data: {
				intervention: intervention.id,
				validator: validatorStaff.id,
				approved: true,
				qualityScore: 9,
			},
		});

		// Reload everything and assert relationships resolve.
		const reloaded = await payload.findByID({
			collection: "interventions",
			id: intervention.id,
			depth: 2,
		});
		expect(reloaded.crew).toHaveLength(2);
		expect((reloaded as { crewSize?: number }).crewSize).toBe(2);
		const sponsorRef = reloaded.commissioning?.sponsor as
			| { id?: number | string }
			| number
			| string
			| undefined;
		const sponsorId =
			typeof sponsorRef === "object" ? sponsorRef?.id : sponsorRef;
		expect(sponsorId).toBe(sponsor.id);

		const checkinRows = await payload.find({
			collection: "gardenerCheckins",
			where: { intervention: { equals: intervention.id } },
		});
		expect(checkinRows.totalDocs).toBe(2);

		const checkoutRows = await payload.find({
			collection: "gardenerCheckouts",
			where: {
				checkin: { in: checkins.map((c) => c.id) },
			},
		});
		expect(checkoutRows.totalDocs).toBe(2);

		const validationsRows = await payload.find({
			collection: "adminValidations",
			where: { intervention: { equals: intervention.id } },
		});
		expect(validationsRows.totalDocs).toBe(1);
		expect(validationsRows.docs[0].id).toBe(validation.id);
	});

	it("rejects more than one crew lead", async () => {
		const sponsor = await payload.create({
			collection: "sponsors",
			data: {
				displayName: "ACME",
				kind: "corporate",
				canonicalKey: { sponsorId: uniqueId("ACME") },
			},
		});
		const area = await payload.create({
			collection: "areas",
			data: {
				areaId: uniqueId("AREA"),
				name: "Park",
				municipality: "Roma",
				areaType: String(AreaType.PublicGreenSpace) as "1",
				latitude: 41.9,
				longitude: 12.5,
				lifecycleStatus: "registered",
			},
		});
		const a = await payload.create({
			collection: "gardeners",
			data: { displayName: "A", status: "active" },
		});
		const b = await payload.create({
			collection: "gardeners",
			data: { displayName: "B", status: "active" },
		});

		await expect(
			payload.create({
				collection: "interventions",
				data: {
					interventionId: uniqueId("INT"),
					area: area.id,
					interventionType: String(InterventionType.RoutineMaintenance) as "1",
					description: "two leads",
					commissioning: { sponsor: sponsor.id },
					crew: [
						{ gardener: a.id, isCrewLead: true },
						{ gardener: b.id, isCrewLead: true },
					],
					lifecycleStatus: "draft",
				},
			}),
		).rejects.toThrow(/at most one crew/i);
	});
});
