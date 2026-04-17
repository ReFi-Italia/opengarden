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

		// Checkins and checkouts now live in the unified `activities` collection.
		// parentActivity for checkout is auto-resolved by autoLinkParentActivity.
		const checkins = [];
		const checkouts = [];
		for (const g of [gardenerA, gardenerB]) {
			const checkin = await payload.create({
				collection: "activities",
				data: {
					type: "checkin",
					intervention: intervention.id,
					gardener: g.id,
					claimedTimestamp: t0.toISOString(),
					data: { latitude: 41.91, longitude: 12.48 },
				},
			});
			checkins.push(checkin);
			const checkout = await payload.create({
				collection: "activities",
				data: {
					type: "checkout",
					intervention: intervention.id,
					gardener: g.id,
					claimedTimestamp: t1.toISOString(),
					data: { actualMinutes: 210 },
					// parentActivity auto-linked by hook to this gardener's open checkin
				},
			});
			checkouts.push(checkout);
		}

		// Validation is now written inline on the intervention's validation group.
		await payload.update({
			collection: "interventions",
			id: intervention.id,
			data: {
				validation: {
					validator: validatorStaff.id,
					approved: true,
					qualityScore: 9,
				},
			},
			context: { skipLifecycleHooks: true },
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

		const checkinActivities = await payload.find({
			collection: "activities",
			where: {
				and: [
					{ intervention: { equals: intervention.id } },
					{ type: { equals: "checkin" } },
				],
			},
		});
		expect(checkinActivities.totalDocs).toBe(2);

		const checkoutActivities = await payload.find({
			collection: "activities",
			where: {
				and: [
					{ intervention: { equals: intervention.id } },
					{ type: { equals: "checkout" } },
				],
			},
		});
		expect(checkoutActivities.totalDocs).toBe(2);

		// Validation fields land on the intervention itself.
		expect(reloaded.validation?.approved).toBe(true);
		expect(reloaded.validation?.qualityScore).toBe(9);
	});

	it("healthcheck with explicit area persists", async () => {
		const area = await payload.create({
			collection: "areas",
			data: {
				areaId: uniqueId("AREA"),
				name: "Standalone check area",
				municipality: "Roma",
				areaType: String(AreaType.PublicGreenSpace) as "1",
				latitude: 41.9,
				longitude: 12.5,
				lifecycleStatus: "registered",
			},
		});

		const hc = await payload.create({
			collection: "activities",
			data: {
				type: "healthcheck",
				area: area.id,
				claimedTimestamp: new Date().toISOString(),
				data: { healthScore: 7 },
			},
		});

		expect(hc.area).toBeTruthy();
		const areaId = typeof hc.area === "object" ? (hc.area as { id: unknown }).id : hc.area;
		expect(areaId).toBe(area.id);
	});

	it("healthcheck derives area from intervention when area omitted", async () => {
		const sponsor = await payload.create({
			collection: "sponsors",
			data: {
				displayName: "Test Sponsor",
				kind: "municipal",
				canonicalKey: { contractNumber: uniqueId("CT") },
			},
		});
		const area = await payload.create({
			collection: "areas",
			data: {
				areaId: uniqueId("AREA"),
				name: "Auto-link area",
				municipality: "Roma",
				areaType: String(AreaType.PublicGreenSpace) as "1",
				latitude: 41.9,
				longitude: 12.5,
				lifecycleStatus: "registered",
			},
		});
		const intervention = await payload.create({
			collection: "interventions",
			data: {
				interventionId: uniqueId("INT"),
				area: area.id,
				interventionType: String(InterventionType.RoutineMaintenance) as "1",
				description: "Healthcheck auto-link test",
				commissioning: { sponsor: sponsor.id },
				lifecycleStatus: "draft",
			},
		});
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

		const hc = await payload.create({
			collection: "activities",
			data: {
				type: "healthcheck",
				intervention: intervention.id,
				claimedTimestamp: new Date().toISOString(),
				data: { healthScore: 6 },
				// no explicit area — should be derived from intervention
			},
		});

		const areaId = typeof hc.area === "object" ? (hc.area as { id: unknown }).id : hc.area;
		expect(areaId).toBe(area.id);
	});

	it("rejects healthcheck with no area and no intervention", async () => {
		await expect(
			payload.create({
				collection: "activities",
				data: {
					type: "healthcheck",
					claimedTimestamp: new Date().toISOString(),
					data: { healthScore: 5 },
				},
			}),
		).rejects.toThrow(/requires an area/i);
	});

	it("report with valid completedTaskCodes succeeds and derives taskCount", async () => {
		const sponsor = await payload.create({
			collection: "sponsors",
			data: {
				displayName: "Test Sponsor",
				kind: "municipal",
				canonicalKey: { contractNumber: uniqueId("CT") },
			},
		});
		const area = await payload.create({
			collection: "areas",
			data: {
				areaId: uniqueId("AREA"),
				name: "Report test area",
				municipality: "Roma",
				areaType: String(AreaType.PublicGreenSpace) as "1",
				latitude: 41.9,
				longitude: 12.5,
				lifecycleStatus: "registered",
			},
		});
		const gardener = await payload.create({
			collection: "gardeners",
			data: { displayName: "Report Gardener", status: "active" },
		});
		const intervention = await payload.create({
			collection: "interventions",
			data: {
				interventionId: uniqueId("INT"),
				area: area.id,
				interventionType: String(InterventionType.RoutineMaintenance) as "1",
				description: "Task report test",
				commissioning: { sponsor: sponsor.id },
				tasks: [
					{ code: "PRUNE", label: "Prune trees" },
					{ code: "CLEAN", label: "Clean pathways" },
				],
				crew: [{ gardener: gardener.id, isCrewLead: true }],
				lifecycleStatus: "draft",
			},
		});
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

		const t0 = new Date("2026-06-01T08:00:00Z");
		const t1 = new Date("2026-06-01T10:00:00Z");
		const t2 = new Date("2026-06-01T11:00:00Z");

		const checkin = await payload.create({
			collection: "activities",
			data: {
				type: "checkin",
				intervention: intervention.id,
				gardener: gardener.id,
				claimedTimestamp: t0.toISOString(),
				data: { latitude: 41.9, longitude: 12.5 },
			},
		});
		const checkout = await payload.create({
			collection: "activities",
			data: {
				type: "checkout",
				intervention: intervention.id,
				gardener: gardener.id,
				claimedTimestamp: t1.toISOString(),
				data: { actualMinutes: 120 },
				// parentActivity auto-linked
			},
		});
		expect(checkout.parentActivity).toBeTruthy();

		const report = await payload.create({
			collection: "activities",
			data: {
				type: "report",
				intervention: intervention.id,
				gardener: gardener.id,
				claimedTimestamp: t2.toISOString(),
				data: {
					completedTaskCodes: ["PRUNE", "CLEAN"],
					notes: "All done",
				},
				// parentActivity auto-linked to checkout
			},
		});

		expect(report.id).toBeTruthy();
		const reportData = report.data as Record<string, unknown>;
		expect(reportData.completedTaskCodes).toEqual(["PRUNE", "CLEAN"]);
		expect(reportData.taskCount).toBe(2);
		expect(report.parentActivity).toBeTruthy();
		// label should be computed at create time
		expect(report.label).toMatch(/report/i);
		expect(report.label).toContain("(2 tasks)");
	});

	it("report with unknown task code is rejected", async () => {
		const sponsor = await payload.create({
			collection: "sponsors",
			data: {
				displayName: "Test Sponsor B",
				kind: "municipal",
				canonicalKey: { contractNumber: uniqueId("CT") },
			},
		});
		const area = await payload.create({
			collection: "areas",
			data: {
				areaId: uniqueId("AREA"),
				name: "Reject test area",
				municipality: "Roma",
				areaType: String(AreaType.PublicGreenSpace) as "1",
				latitude: 41.9,
				longitude: 12.5,
				lifecycleStatus: "registered",
			},
		});
		const gardener = await payload.create({
			collection: "gardeners",
			data: { displayName: "Bad Code Gardener", status: "active" },
		});
		const intervention = await payload.create({
			collection: "interventions",
			data: {
				interventionId: uniqueId("INT"),
				area: area.id,
				interventionType: String(InterventionType.RoutineMaintenance) as "1",
				description: "Reject task test",
				commissioning: { sponsor: sponsor.id },
				tasks: [{ code: "PRUNE", label: "Prune trees" }],
				crew: [{ gardener: gardener.id, isCrewLead: true }],
				lifecycleStatus: "draft",
			},
		});
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

		const t0 = new Date("2026-06-02T08:00:00Z");
		const t1 = new Date("2026-06-02T10:00:00Z");
		const t2 = new Date("2026-06-02T11:00:00Z");

		await payload.create({
			collection: "activities",
			data: {
				type: "checkin",
				intervention: intervention.id,
				gardener: gardener.id,
				claimedTimestamp: t0.toISOString(),
				data: { latitude: 41.9, longitude: 12.5 },
			},
		});
		await payload.create({
			collection: "activities",
			data: {
				type: "checkout",
				intervention: intervention.id,
				gardener: gardener.id,
				claimedTimestamp: t1.toISOString(),
				data: { actualMinutes: 120 },
			},
		});

		await expect(
			payload.create({
				collection: "activities",
				data: {
					type: "report",
					intervention: intervention.id,
					gardener: gardener.id,
					claimedTimestamp: t2.toISOString(),
					data: {
						completedTaskCodes: ["PRUNE", "NONEXISTENT"],
						notes: "",
					},
				},
			}),
		).rejects.toThrow(/task code "NONEXISTENT"/i);
	});

	it("report without completedTaskCodes is rejected", async () => {
		const sponsor = await payload.create({
			collection: "sponsors",
			data: {
				displayName: "Test Sponsor C",
				kind: "municipal",
				canonicalKey: { contractNumber: uniqueId("CT") },
			},
		});
		const area = await payload.create({
			collection: "areas",
			data: {
				areaId: uniqueId("AREA"),
				name: "Missing codes area",
				municipality: "Roma",
				areaType: String(AreaType.PublicGreenSpace) as "1",
				latitude: 41.9,
				longitude: 12.5,
				lifecycleStatus: "registered",
			},
		});
		const gardener = await payload.create({
			collection: "gardeners",
			data: { displayName: "No Codes Gardener", status: "active" },
		});
		const intervention = await payload.create({
			collection: "interventions",
			data: {
				interventionId: uniqueId("INT"),
				area: area.id,
				interventionType: String(InterventionType.RoutineMaintenance) as "1",
				description: "Missing codes test",
				commissioning: { sponsor: sponsor.id },
				tasks: [{ code: "PRUNE", label: "Prune trees" }],
				crew: [{ gardener: gardener.id, isCrewLead: true }],
				lifecycleStatus: "draft",
			},
		});
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

		const t0 = new Date("2026-06-03T08:00:00Z");
		const t1 = new Date("2026-06-03T10:00:00Z");
		const t2 = new Date("2026-06-03T11:00:00Z");

		await payload.create({
			collection: "activities",
			data: {
				type: "checkin",
				intervention: intervention.id,
				gardener: gardener.id,
				claimedTimestamp: t0.toISOString(),
				data: { latitude: 41.9, longitude: 12.5 },
			},
		});
		await payload.create({
			collection: "activities",
			data: {
				type: "checkout",
				intervention: intervention.id,
				gardener: gardener.id,
				claimedTimestamp: t1.toISOString(),
				data: { actualMinutes: 120 },
			},
		});

		await expect(
			payload.create({
				collection: "activities",
				data: {
					type: "report",
					intervention: intervention.id,
					gardener: gardener.id,
					claimedTimestamp: t2.toISOString(),
					data: { notes: "forgot to include codes" },
				},
			}),
		).rejects.toThrow(/completedTaskCodes/i);
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
