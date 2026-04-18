import { getPayload, type Payload } from "payload";
import { beforeAll, describe, expect, it } from "vitest";
import config from "@/payload.config";
import {
	advanceToInProgress,
	createArea,
	createGardener,
	createIntervention,
	createSponsor,
	uniqueId,
} from "../helpers/fixtures";

let payload: Payload;

const seedAreaAndIntervention = async () => {
	const area = await createArea(payload, { name: "Pignatelli Garden", coordinates: [12.49, 41.9] as [number, number] });
	const sponsor = await createSponsor(payload, { kind: "corporate", canonicalKey: { sponsorId: uniqueId("ACME") } });
	const gardener = await createGardener(payload, { displayName: "Lead Gardener" });
	const intervention = await createIntervention(payload, {
		areaId: area.id,
		sponsorId: sponsor.id,
		description: "Routine maintenance",
		crew: [{ gardener: gardener.id, isCrewLead: true }],
	});
	return { area, sponsor, gardener, intervention };
};

describe("Intervention lifecycle transitions", () => {
	beforeAll(async () => {
		payload = await getPayload({ config: await config });
	});

	it("rejects creating an intervention in a non-draft state", async () => {
		const area = await createArea(payload, { coordinates: [12.49, 41.9] as [number, number] });
		const sponsor = await createSponsor(payload, { kind: "corporate", canonicalKey: { sponsorId: uniqueId("ACME") } });
		const gardener = await createGardener(payload, { displayName: "Lead" });

		await expect(
			createIntervention(payload, {
				areaId: area.id,
				sponsorId: sponsor.id,
				description: "should fail",
				crew: [{ gardener: gardener.id, isCrewLead: true }],
				lifecycleStatus: "scheduled",
			}),
		).rejects.toThrow(/draft/i);
	});

	it("rejects illegal transitions and accepts allowed ones (with skipLifecycleHooks bypass)", async () => {
		const { intervention } = await seedAreaAndIntervention();

		await expect(
			payload.update({
				collection: "interventions",
				id: intervention.id,
				data: { lifecycleStatus: "in_progress" },
				context: { skipLifecycleHooks: false },
			}),
		).rejects.toThrow(/Illegal lifecycleStatus transition/i);

		const scheduled = await payload.update({
			collection: "interventions",
			id: intervention.id,
			data: { lifecycleStatus: "scheduled" },
			context: { skipLifecycleHooks: true },
		});
		expect(scheduled.lifecycleStatus).toBe("scheduled");

		const inProgress = await payload.update({
			collection: "interventions",
			id: intervention.id,
			data: { lifecycleStatus: "in_progress" },
			context: { skipLifecycleHooks: true },
		});
		expect(inProgress.lifecycleStatus).toBe("in_progress");

		const validated = await payload.update({
			collection: "interventions",
			id: intervention.id,
			data: { lifecycleStatus: "validated" },
			context: { skipLifecycleHooks: true },
		});
		expect(validated.lifecycleStatus).toBe("validated");

		const published = await payload.update({
			collection: "interventions",
			id: intervention.id,
			data: { lifecycleStatus: "published" },
			context: { skipLifecycleHooks: true },
		});
		expect(published.lifecycleStatus).toBe("published");

		await expect(
			payload.update({
				collection: "interventions",
				id: intervention.id,
				data: { lifecycleStatus: "revoked" },
				context: { skipLifecycleHooks: false },
			}),
		).rejects.toThrow(/Illegal lifecycleStatus transition/i);
	});

	it("refuses form-level edits to stage groups while server actions can write them", async () => {
		const { intervention } = await seedAreaAndIntervention();

		await payload.update({
			collection: "interventions",
			id: intervention.id,
			data: { lifecycleStatus: "scheduled" },
			context: { skipLifecycleHooks: true },
		});

		await payload.update({
			collection: "interventions",
			id: intervention.id,
			data: {
				scheduling: {
					scheduledDate: new Date("2026-05-01").toISOString(),
					estimatedMinutes: 120,
				},
			},
			context: { skipLifecycleHooks: true },
		});

		const formAttempt = await payload.update({
			collection: "interventions",
			id: intervention.id,
			data: {
				description: "updated description",
				scheduling: { estimatedMinutes: 999 },
			},
		});
		expect(formAttempt.description).toBe("updated description");
		expect(formAttempt.scheduling?.estimatedMinutes).toBe(120);
	});
});

describe("Evidence bundle build state machine", () => {
	beforeAll(async () => {
		payload = await getPayload({ config: await config });
	});

	it("rejects illegal bundleState edges and accepts the happy path under skipLifecycleHooks", async () => {
		const { intervention } = await seedAreaAndIntervention();

		const bundle = await payload.create({
			collection: "evidenceBundles",
			data: { intervention: intervention.id, bundleState: "draft" },
		});
		expect(bundle.bundleState).toBe("draft");

		await expect(
			payload.update({
				collection: "evidenceBundles",
				id: bundle.id,
				data: { bundleState: "uploaded" },
			}),
		).rejects.toThrow(/Illegal bundleState transition/i);

		const built = await payload.update({
			collection: "evidenceBundles",
			id: bundle.id,
			data: { bundleState: "built" },
			context: { skipLifecycleHooks: true },
		});
		expect(built.bundleState).toBe("built");

		await payload.update({
			collection: "evidenceBundles",
			id: bundle.id,
			data: { bundleState: "uploaded" },
			context: { skipLifecycleHooks: true },
		});
		await payload.update({
			collection: "evidenceBundles",
			id: bundle.id,
			data: { bundleState: "published" },
			context: { skipLifecycleHooks: true },
		});
		const verified = await payload.update({
			collection: "evidenceBundles",
			id: bundle.id,
			data: { bundleState: "verified" },
			context: { skipLifecycleHooks: true },
		});
		expect(verified.bundleState).toBe("verified");

		const reverified = await payload.update({
			collection: "evidenceBundles",
			id: bundle.id,
			data: { bundleState: "verified" },
			context: { skipLifecycleHooks: true },
		});
		expect(reverified.bundleState).toBe("verified");

		await expect(
			payload.update({
				collection: "evidenceBundles",
				id: bundle.id,
				data: { bundleState: "draft" },
			}),
		).rejects.toThrow(/Illegal bundleState transition/i);
	});
});
