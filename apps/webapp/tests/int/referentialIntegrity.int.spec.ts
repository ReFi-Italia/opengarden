import { getPayload, type Payload } from "payload";
import { beforeAll, describe, expect, it } from "vitest";
import config from "@/payload.config";
import {
	advanceToInProgress,
	createArea,
	createGardener,
	createIntervention,
	createSponsor,
	createStaff,
	uniqueId,
} from "../helpers/fixtures";

let payload: Payload;

describe("Referential integrity walkthrough", () => {
	beforeAll(async () => {
		payload = await getPayload({ config: await config });
	});

	it("persists a full intervention chain end-to-end without invoking any SDK write", async () => {
		const sponsor = await createSponsor(payload, { displayName: "Roma Capitale", kind: "municipal" });
		const validatorStaff = await createStaff(payload, { displayName: "Anna Rossi" });
		const gardenerA = await createGardener(payload, { displayName: "Marco Verdi" });
		const gardenerB = await createGardener(payload, { displayName: "Giulia Neri" });
		const area = await createArea(payload, {
			name: "Villa Borghese - Pratone",
			coordinates: [12.48, 41.91] as [number, number],
		});
		const intervention = await createIntervention(payload, {
			areaId: area.id,
			sponsorId: sponsor.id,
			description: "Spring cleanup",
			crew: [
				{ gardener: gardenerA.id, isCrewLead: true },
				{ gardener: gardenerB.id, isCrewLead: false },
			],
		});

		await advanceToInProgress(payload, intervention.id);

		const t0 = new Date("2026-05-01T08:00:00Z");
		const t1 = new Date("2026-05-01T11:30:00Z");

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
				},
			});
			checkouts.push(checkout);
		}

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

		expect(reloaded.validation?.approved).toBe(true);
		expect(reloaded.validation?.qualityScore).toBe(9);
	});

	it("healthcheck with explicit area persists", async () => {
		const area = await createArea(payload, { name: "Standalone check area" });

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
		const areaId =
			typeof hc.area === "object" ? (hc.area as { id: unknown }).id : hc.area;
		expect(areaId).toBe(area.id);
	});

	it("healthcheck derives area from intervention when area omitted", async () => {
		const sponsor = await createSponsor(payload);
		const area = await createArea(payload, { name: "Auto-link area" });
		const intervention = await createIntervention(payload, {
			areaId: area.id,
			sponsorId: sponsor.id,
			description: "Healthcheck auto-link test",
			crew: [],
		});
		await advanceToInProgress(payload, intervention.id);

		const hc = await payload.create({
			collection: "activities",
			data: {
				type: "healthcheck",
				intervention: intervention.id,
				claimedTimestamp: new Date().toISOString(),
				data: { healthScore: 6 },
			},
		});

		const areaId =
			typeof hc.area === "object" ? (hc.area as { id: unknown }).id : hc.area;
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
		const sponsor = await createSponsor(payload);
		const area = await createArea(payload, { name: "Report test area" });
		const gardener = await createGardener(payload, { displayName: "Report Gardener" });
		const intervention = await createIntervention(payload, {
			areaId: area.id,
			sponsorId: sponsor.id,
			description: "Task report test",
			crew: [{ gardener: gardener.id, isCrewLead: true }],
			tasks: [
				{ code: "PRUNE", label: "Prune trees" },
				{ code: "CLEAN", label: "Clean pathways" },
			],
		});
		await advanceToInProgress(payload, intervention.id);

		const t0 = new Date("2026-06-01T08:00:00Z");
		const t1 = new Date("2026-06-01T10:00:00Z");
		const t2 = new Date("2026-06-01T11:00:00Z");

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
		const checkout = await payload.create({
			collection: "activities",
			data: {
				type: "checkout",
				intervention: intervention.id,
				gardener: gardener.id,
				claimedTimestamp: t1.toISOString(),
				data: { actualMinutes: 120 },
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
				data: { completedTaskCodes: ["PRUNE", "CLEAN"], notes: "All done" },
			},
		});

		expect(report.id).toBeTruthy();
		const reportData = report.data as Record<string, unknown>;
		expect(reportData.completedTaskCodes).toEqual(["PRUNE", "CLEAN"]);
		expect(reportData.taskCount).toBe(2);
		expect(report.parentActivity).toBeTruthy();
		expect(report.label).toMatch(/report/i);
		expect(report.label).toContain("(2 tasks)");
	});

	it("report with unknown task code is rejected", async () => {
		const sponsor = await createSponsor(payload, { displayName: "Test Sponsor B" });
		const area = await createArea(payload, { name: "Reject test area" });
		const gardener = await createGardener(payload, { displayName: "Bad Code Gardener" });
		const intervention = await createIntervention(payload, {
			areaId: area.id,
			sponsorId: sponsor.id,
			description: "Reject task test",
			crew: [{ gardener: gardener.id, isCrewLead: true }],
			tasks: [{ code: "PRUNE", label: "Prune trees" }],
		});
		await advanceToInProgress(payload, intervention.id);

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
					data: { completedTaskCodes: ["PRUNE", "NONEXISTENT"], notes: "" },
				},
			}),
		).rejects.toThrow(/task code "NONEXISTENT"/i);
	});

	it("report without completedTaskCodes is rejected", async () => {
		const sponsor = await createSponsor(payload, { displayName: "Test Sponsor C" });
		const area = await createArea(payload, { name: "Missing codes area" });
		const gardener = await createGardener(payload, { displayName: "No Codes Gardener" });
		const intervention = await createIntervention(payload, {
			areaId: area.id,
			sponsorId: sponsor.id,
			description: "Missing codes test",
			crew: [{ gardener: gardener.id, isCrewLead: true }],
			tasks: [{ code: "PRUNE", label: "Prune trees" }],
		});
		await advanceToInProgress(payload, intervention.id);

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
		const sponsor = await createSponsor(payload, {
			kind: "corporate",
			canonicalKey: { sponsorId: uniqueId("ACME") },
		});
		const area = await createArea(payload, { name: "Park" });
		const a = await createGardener(payload, { displayName: "A" });
		const b = await createGardener(payload, { displayName: "B" });

		await expect(
			createIntervention(payload, {
				areaId: area.id,
				sponsorId: sponsor.id,
				description: "two leads",
				crew: [
					{ gardener: a.id, isCrewLead: true },
					{ gardener: b.id, isCrewLead: true },
				],
			}),
		).rejects.toThrow(/at most one crew/i);
	});
});
