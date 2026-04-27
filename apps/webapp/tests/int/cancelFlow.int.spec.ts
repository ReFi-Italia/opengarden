import { getPayload, type Payload } from "payload";
import { beforeAll, describe, expect, it, vi } from "vitest";
import config from "@/payload.config";
import {
	createArea,
	createGardener,
	createIntervention,
	createSponsor,
	uniqueId,
} from "../helpers/fixtures";

let payload: Payload;

// Mock Next's auth header readers before importing the server actions. The
// actions call `headers()` from next/headers and `payload.auth({ headers })`
// to resolve the current user. In node test context there's no HTTP request,
// so we route both through a stub that always resolves the seeded admin user.
const adminUserPromise = (async () => {
	const p = await getPayload({ config: await config });
	return p.create({
		collection: "users",
		data: {
			email: `cancel-admin-${uniqueId("u")}@test.local`,
			password: "test1234",
			displayName: "Cancel Admin",
			roles: ["admin"],
		},
	});
})();

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
}));

vi.mock("payload", async (importOriginal) => {
	const mod = await importOriginal<typeof import("payload")>();
	return mod;
});

// Patch payload.auth so the server action's role check resolves to admin.
// Done inside beforeAll so the same payload singleton is consistent.
const patchAuth = async (user: { id: string | number; roles?: string[] }) => {
	const original = payload.auth.bind(payload);
	payload.auth = (async () => ({ user }) as never) as typeof payload.auth;
	return () => {
		payload.auth = original;
	};
};

describe("cancelIntervention action", () => {
	beforeAll(async () => {
		payload = await getPayload({ config: await config });
	});

	const seedIntervention = async (status?: string) => {
		const area = await createArea(payload);
		const sponsor = await createSponsor(payload, {
			kind: "corporate",
			canonicalKey: { sponsorId: uniqueId("ACME") },
		});
		const gardener = await createGardener(payload, {
			displayName: "Crew Lead",
		});
		const intervention = await createIntervention(payload, {
			areaId: area.id,
			sponsorId: sponsor.id,
			description: "Cancel test",
			crew: [{ gardener: gardener.id, isCrewLead: true }],
		});
		if (status && status !== "draft") {
			await payload.update({
				collection: "interventions",
				id: intervention.id,
				data: { lifecycleStatus: status as "scheduled" },
				context: { skipLifecycleHooks: true },
			});
		}
		return { area, sponsor, gardener, intervention };
	};

	it("cancels from draft and writes cancellation group", async () => {
		const admin = await adminUserPromise;
		const restore = await patchAuth(admin);
		try {
			const { intervention } = await seedIntervention("draft");
			const { cancelInterventionAction } = await import(
				"@/actions/cancelIntervention"
			);
			const result = await cancelInterventionAction({
				interventionId: String(intervention.id),
				reason: "Weather",
			});
			expect(result.ok).toBe(true);

			const reloaded = await payload.findByID({
				collection: "interventions",
				id: intervention.id,
				depth: 0,
				overrideAccess: true,
			});
			expect(reloaded.lifecycleStatus).toBe("cancelled");
			expect(reloaded.cancellation?.reason).toBe("Weather");
			expect(reloaded.cancellation?.cancelledFrom).toBe("draft");
			expect(reloaded.cancellation?.cancelledAt).toBeTruthy();
		} finally {
			restore();
		}
	});

	it("cancels from each non-terminal state recording the originating stage", async () => {
		const admin = await adminUserPromise;
		const restore = await patchAuth(admin);
		try {
			const stages = [
				"scheduled",
				"in_progress",
				"completed",
			] as const;
			for (const stage of stages) {
				const { intervention } = await seedIntervention(stage);
				const { cancelInterventionAction } = await import(
					"@/actions/cancelIntervention"
				);
				const result = await cancelInterventionAction({
					interventionId: String(intervention.id),
					reason: `Abort from ${stage}`,
				});
				expect(result.ok).toBe(true);

				const reloaded = await payload.findByID({
					collection: "interventions",
					id: intervention.id,
					depth: 0,
					overrideAccess: true,
				});
				expect(reloaded.lifecycleStatus).toBe("cancelled");
				expect(reloaded.cancellation?.cancelledFrom).toBe(stage);
			}
		} finally {
			restore();
		}
	});

	it("rejects cancel from terminal states (published / cancelled)", async () => {
		const admin = await adminUserPromise;
		const restore = await patchAuth(admin);
		try {
			const { cancelInterventionAction } = await import(
				"@/actions/cancelIntervention"
			);

			const { intervention: pub } = await seedIntervention("draft");
			// Walk through scheduled → in_progress → completed → published
			for (const stage of [
				"scheduled",
				"in_progress",
				"completed",
				"published",
			] as const) {
				await payload.update({
					collection: "interventions",
					id: pub.id,
					data: { lifecycleStatus: stage },
					context: { skipLifecycleHooks: true },
				});
			}
			const pubResult = await cancelInterventionAction({
				interventionId: String(pub.id),
				reason: "nope",
			});
			expect(pubResult.ok).toBe(false);
			expect(pubResult.ok === false && pubResult.error).toMatch(/cannot cancel/i);

			const { intervention: already } = await seedIntervention("draft");
			await payload.update({
				collection: "interventions",
				id: already.id,
				data: { lifecycleStatus: "cancelled" },
				context: { skipLifecycleHooks: true },
			});
			const cancelledResult = await cancelInterventionAction({
				interventionId: String(already.id),
				reason: "nope",
			});
			expect(cancelledResult.ok).toBe(false);
		} finally {
			restore();
		}
	});

	it("requires a non-empty reason", async () => {
		const admin = await adminUserPromise;
		const restore = await patchAuth(admin);
		try {
			const { intervention } = await seedIntervention("draft");
			const { cancelInterventionAction } = await import(
				"@/actions/cancelIntervention"
			);
			const result = await cancelInterventionAction({
				interventionId: String(intervention.id),
				reason: "   ",
			});
			expect(result.ok).toBe(false);
			expect(result.ok === false && result.error).toMatch(/reason/i);
		} finally {
			restore();
		}
	});

	it("rejects without admin/manager role", async () => {
		// Seed a viewer user, swap auth to resolve to them.
		const viewer = await payload.create({
			collection: "users",
			data: {
				email: `cancel-viewer-${uniqueId("u")}@test.local`,
				password: "test1234",
				displayName: "Cancel Viewer",
				roles: ["viewer"],
			},
		});
		const restore = await patchAuth(viewer);
		try {
			const { intervention } = await seedIntervention("draft");
			const { cancelInterventionAction } = await import(
				"@/actions/cancelIntervention"
			);
			const result = await cancelInterventionAction({
				interventionId: String(intervention.id),
				reason: "no permission",
			});
			expect(result.ok).toBe(false);
			expect(result.ok === false && result.error).toMatch(/forbidden/i);
		} finally {
			restore();
		}
	});
});

describe("supersedeIntervention action", () => {
	beforeAll(async () => {
		payload = await getPayload({ config: await config });
	});

	it("creates fresh draft with cloned area/crew/tasks and back-links supersededBy", async () => {
		const admin = await adminUserPromise;
		const restore = await patchAuth(admin);
		try {
			const area = await createArea(payload);
			const sponsor = await createSponsor(payload, {
				kind: "municipal",
				canonicalKey: { contractNumber: uniqueId("CT") },
			});
			const g1 = await createGardener(payload, { displayName: "Lead" });
			const g2 = await createGardener(payload, { displayName: "Crew 2" });
			const source = await createIntervention(payload, {
				areaId: area.id,
				sponsorId: sponsor.id,
				description: "Original plan",
				crew: [
					{ gardener: g1.id, isCrewLead: true },
					{ gardener: g2.id, isCrewLead: false },
				],
				tasks: [
					{ code: "PRUNE", label: "Prune" },
					{ code: "CLEAN", label: "Clean" },
				],
			});
			await payload.update({
				collection: "interventions",
				id: source.id,
				data: { lifecycleStatus: "scheduled" },
				context: { skipLifecycleHooks: true },
			});

			const { supersedeInterventionAction } = await import(
				"@/actions/cancelIntervention"
			);
			const newId = uniqueId("INT-NEW");
			const result = await supersedeInterventionAction({
				sourceId: String(source.id),
				newInterventionId: newId,
				reason: "Reschedule",
			});
			if (!result.ok) {
				throw new Error(`supersede failed: ${result.error}`);
			}
			expect(result.newId).toBeTruthy();

			// Source is cancelled with supersededBy → new row
			const sourceReloaded = await payload.findByID({
				collection: "interventions",
				id: source.id,
				depth: 1,
				overrideAccess: true,
			});
			expect(sourceReloaded.lifecycleStatus).toBe("cancelled");
			expect(sourceReloaded.cancellation?.reason).toBe("Reschedule");
			expect(sourceReloaded.cancellation?.cancelledFrom).toBe("scheduled");
			const supersededBy = sourceReloaded.supersededBy as
				| { id?: string | number }
				| string
				| number
				| undefined;
			const supersededId =
				typeof supersededBy === "object" ? supersededBy?.id : supersededBy;
			expect(String(supersededId)).toBe(result.ok ? result.newId : "");

			// New row exists in draft with cloned structure
			const newRow = await payload.findByID({
				collection: "interventions",
				id: (result.ok && result.newId) as string,
				depth: 1,
				overrideAccess: true,
			});
			expect(newRow.lifecycleStatus).toBe("draft");
			expect(newRow.interventionId).toBe(newId);
			expect(newRow.description).toBe("Original plan");
			expect(newRow.crew).toHaveLength(2);
			expect(newRow.tasks).toHaveLength(2);
		} finally {
			restore();
		}
	});
});
