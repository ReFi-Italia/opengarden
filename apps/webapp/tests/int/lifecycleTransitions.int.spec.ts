import { AreaType, InterventionType } from "@refi-italia/opengarden/helpers";
import { getPayload, type Payload } from "payload";
import { beforeAll, describe, expect, it } from "vitest";
import config from "@/payload.config";

let payload: Payload;

const uniqueId = (prefix: string) =>
	`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const seedAreaAndIntervention = async () => {
	const area = await payload.create({
		collection: "areas",
		data: {
			areaId: uniqueId("AREA"),
			name: "Pignatelli Garden",
			municipality: "Roma",
			areaType: String(AreaType.PublicGreenSpace) as "1",
			latitude: 41.9,
			longitude: 12.49,
			lifecycleStatus: "registered",
		},
	});
	const sponsor = await payload.create({
		collection: "sponsors",
		data: {
			displayName: "ACME",
			kind: "corporate",
			canonicalKey: { sponsorId: uniqueId("ACME") },
		},
	});
	const gardener = await payload.create({
		collection: "gardeners",
		data: { displayName: "Lead Gardener", status: "active" },
	});
	const intervention = await payload.create({
		collection: "interventions",
		data: {
			interventionId: uniqueId("INT"),
			area: area.id,
			interventionType: String(InterventionType.RoutineMaintenance) as "1",
			description: "Routine maintenance",
			commissioning: { sponsor: sponsor.id },
			crew: [{ gardener: gardener.id, isCrewLead: true }],
			lifecycleStatus: "draft",
		},
	});
	return { area, sponsor, gardener, intervention };
};

describe("Intervention lifecycle transitions", () => {
	beforeAll(async () => {
		payload = await getPayload({ config: await config });
	});

	it("rejects creating an intervention in a non-draft state", async () => {
		const area = await payload.create({
			collection: "areas",
			data: {
				areaId: uniqueId("AREA"),
				name: "Test",
				municipality: "Roma",
				areaType: String(AreaType.PublicGreenSpace) as "1",
				latitude: 41.9,
				longitude: 12.49,
				lifecycleStatus: "registered",
			},
		});
		const sponsor = await payload.create({
			collection: "sponsors",
			data: {
				displayName: "ACME",
				kind: "corporate",
				canonicalKey: { sponsorId: uniqueId("ACME") },
			},
		});
		const gardener = await payload.create({
			collection: "gardeners",
			data: { displayName: "Lead", status: "active" },
		});
		await expect(
			payload.create({
				collection: "interventions",
				data: {
					interventionId: uniqueId("INT"),
					area: area.id,
					interventionType: String(InterventionType.RoutineMaintenance) as "1",
					description: "should fail",
					commissioning: { sponsor: sponsor.id },
					crew: [{ gardener: gardener.id, isCrewLead: true }],
					lifecycleStatus: "scheduled",
				},
			}),
		).rejects.toThrow(/draft/i);
	});

	it("rejects illegal transitions and accepts allowed ones (with skipLifecycleHooks bypass)", async () => {
		const { intervention } = await seedAreaAndIntervention();

		// draft → in_progress is illegal (must go through scheduled).
		await expect(
			payload.update({
				collection: "interventions",
				id: intervention.id,
				data: { lifecycleStatus: "in_progress" },
				context: { skipLifecycleHooks: false },
			}),
		).rejects.toThrow(/Illegal lifecycleStatus transition/i);

		// draft → scheduled is allowed when invoked from a server action.
		const scheduled = await payload.update({
			collection: "interventions",
			id: intervention.id,
			data: { lifecycleStatus: "scheduled" },
			context: { skipLifecycleHooks: true },
		});
		expect(scheduled.lifecycleStatus).toBe("scheduled");

		// published is terminal — no further forward edge.
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

		// No edge out of published.
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

		// Push to scheduled via server-action context.
		await payload.update({
			collection: "interventions",
			id: intervention.id,
			data: { lifecycleStatus: "scheduled" },
			context: { skipLifecycleHooks: true },
		});

		// Server action populates scheduling.* in one shot.
		await payload.update({
			collection: "interventions",
			id: intervention.id,
			data: {
				scheduling: {
					chainUID: "0xdeadbeef",
					scheduledDate: new Date("2026-05-01").toISOString(),
				},
			},
			context: { skipLifecycleHooks: true },
		});

		// Form write attempting to overwrite scheduling.chainUID is silently
		// reset to original (the stage group is past-stage and frozen for
		// form callers).
		const formAttempt = await payload.update({
			collection: "interventions",
			id: intervention.id,
			data: {
				description: "updated description",
				scheduling: {
					chainUID: "0xnewvalue",
				},
			},
		});
		expect(formAttempt.description).toBe("updated description");
		expect(formAttempt.scheduling?.chainUID).toBe("0xdeadbeef");
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

		// draft → uploaded is illegal — must go through built first.
		await expect(
			payload.update({
				collection: "evidenceBundles",
				id: bundle.id,
				data: { bundleState: "uploaded" },
			}),
		).rejects.toThrow(/Illegal bundleState transition/i);

		// draft → built is allowed.
		const built = await payload.update({
			collection: "evidenceBundles",
			id: bundle.id,
			data: { bundleState: "built" },
			context: { skipLifecycleHooks: true },
		});
		expect(built.bundleState).toBe("built");

		// built → uploaded → published → verified all allowed.
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

		// verified → verified self-loop is allowed (re-verification).
		const reverified = await payload.update({
			collection: "evidenceBundles",
			id: bundle.id,
			data: { bundleState: "verified" },
			context: { skipLifecycleHooks: true },
		});
		expect(reverified.bundleState).toBe("verified");

		// verified → draft is illegal.
		await expect(
			payload.update({
				collection: "evidenceBundles",
				id: bundle.id,
				data: { bundleState: "draft" },
			}),
		).rejects.toThrow(/Illegal bundleState transition/i);
	});
});
