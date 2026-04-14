import { randomBytes } from "node:crypto";
import { AreaType, InterventionType } from "@refi-italia/opengarden";
import { getPayload, type Payload, type PayloadRequest } from "payload";
import { beforeAll, describe, expect, it, vi } from "vitest";
import config from "@/payload.config";
import { scheduleInterventionTask } from "@/tasks/scheduleIntervention";

// Replace `getOpenGardenContext` with a vi mock so task handlers can be
// exercised in-process without any real chain / signer / RPC setup. Tests
// configure the stub per-case with `mockResolvedValueOnce`.
vi.mock("@/lib/openGardenClient", () => ({
	getOpenGardenContext: vi.fn(),
}));

// Re-import the mocked module so `vi.mocked(...)` narrows correctly.
import * as openGardenClientModule from "@/lib/openGardenClient";

const getOpenGardenContext = vi.mocked(
	openGardenClientModule.getOpenGardenContext,
);

let payload: Payload;

const uniqueId = (prefix: string) =>
	`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const uniqueWallet = () => `0x${randomBytes(20).toString("hex")}`;

const uniqueChainUID = () =>
	`0x${randomBytes(32).toString("hex")}` as `0x${string}`;

/**
 * Constructs a minimal `PayloadRequest` for direct task-handler invocation.
 * Task handlers only use `req.payload` (for updates / finds) and a few
 * header/context fields — nothing that requires a real HTTP request.
 */
function fakeReq(): PayloadRequest {
	return {
		payload,
		user: null,
		headers: new Headers(),
		context: {},
		// biome-ignore lint/suspicious/noExplicitAny: minimal req stub
	} as any;
}

describe("Task handlers", () => {
	beforeAll(async () => {
		payload = await getPayload({ config: await config });
	});

	describe("scheduleInterventionTask", () => {
		it("schedules a draft intervention: transitions state, mirrors chain fields, records audit", async () => {
			const sponsor = await payload.create({
				collection: "sponsors",
				data: {
					displayName: "City of Testville",
					kind: "municipal",
					canonicalKey: { contractNumber: uniqueId("CT") },
				},
			});
			const leadGardener = await payload.create({
				collection: "gardeners",
				data: {
					displayName: "Lead Gardener",
					status: "active",
					wallet: uniqueWallet(),
				},
			});
			const area = await payload.create({
				collection: "areas",
				data: {
					areaId: uniqueId("AREA"),
					name: "Task Test Garden",
					municipality: "Testville",
					areaType: String(AreaType.PublicGreenSpace) as "1",
					latitude: 41.9,
					longitude: 12.5,
					lifecycleStatus: "registered",
					chain: {
						chainUID: uniqueChainUID(),
						txHash: "0xarea",
						chainIdSnapshot: 11155420,
					},
				},
			});
			const intervention = await payload.create({
				collection: "interventions",
				data: {
					interventionId: uniqueId("INT"),
					area: area.id,
					interventionType: String(InterventionType.RoutineMaintenance) as "1",
					description: "Spring cleanup",
					commissioning: { sponsor: sponsor.id },
					crew: [{ gardener: leadGardener.id, isCrewLead: true }],
					lifecycleStatus: "draft",
				},
			});

			// Populate scheduling.scheduledDate + estimatedMinutes via the
			// skipLifecycleHooks bypass — this is what the `schedule` server
			// action will eventually do before queuing the task.
			await payload.update({
				collection: "interventions",
				id: intervention.id,
				data: {
					scheduling: {
						scheduledDate: new Date("2026-05-01T10:00:00Z").toISOString(),
						estimatedMinutes: 90,
					},
				},
				overrideAccess: true,
				context: { skipLifecycleHooks: true },
			});

			getOpenGardenContext.mockResolvedValueOnce({
				client: {
					scheduleIntervention: vi.fn().mockResolvedValue({
						uid: "0xscheduleduid",
						signedAttestation: { sig: "fake" },
						timestampTxHash: "0xscheduledts",
						onchainTimestamp: 1_717_000_000n,
						timestampReceipt: null,
					}),
					// biome-ignore lint/suspicious/noExplicitAny: minimal fake client
				} as any,
				chainId: 11155420,
				attesterWallet: "0x2222222222222222222222222222222222222222",
			});

			const runScheduleHandler = scheduleInterventionTask.handler as (
				// biome-ignore lint/suspicious/noExplicitAny: jobs runtime shape
				args: any,
				// biome-ignore lint/suspicious/noExplicitAny: jobs runtime shape
			) => Promise<any>;
			const result = await runScheduleHandler({
				input: { interventionId: intervention.id },
				req: fakeReq(),
			});

			expect(result.output.chainUID).toBe("0xscheduleduid");
			expect(result.output.timestampTxHash).toBe("0xscheduledts");

			const updated = await payload.findByID({
				collection: "interventions",
				id: intervention.id,
				depth: 0,
			});
			expect(updated.lifecycleStatus).toBe("scheduled");
			expect(updated.scheduling?.chainUID).toBe("0xscheduleduid");
			expect(updated.scheduling?.txHash).toBe("0xscheduledts");
			expect(updated.scheduling?.onchainTimestamp).toBe(1_717_000_000);
			expect(updated.scheduling?.attesterWallet).toBe(
				"0x2222222222222222222222222222222222222222",
			);
			expect(updated.scheduling?.chainIdSnapshot).toBe(11155420);

			const audit = await payload.find({
				collection: "chainTransactions",
				where: {
					and: [
						{ kind: { equals: "scheduleIntervention" } },
						{ relatedId: { equals: String(intervention.id) } },
					],
				},
				limit: 1,
				depth: 0,
			});
			expect(audit.totalDocs).toBe(1);
			expect(audit.docs[0]?.status).toBe("success");
			expect(audit.docs[0]?.chainUID).toBe("0xscheduleduid");
		});

		it("flips to failed and records a failure audit row when the SDK throws", async () => {
			const sponsor = await payload.create({
				collection: "sponsors",
				data: {
					displayName: "Failure City",
					kind: "municipal",
					canonicalKey: { contractNumber: uniqueId("CT") },
				},
			});
			const leadGardener = await payload.create({
				collection: "gardeners",
				data: {
					displayName: "Lead",
					status: "active",
					wallet: uniqueWallet(),
				},
			});
			const area = await payload.create({
				collection: "areas",
				data: {
					areaId: uniqueId("AREA"),
					name: "Failure Garden",
					municipality: "Testville",
					areaType: String(AreaType.PublicGreenSpace) as "1",
					latitude: 41.9,
					longitude: 12.5,
					lifecycleStatus: "registered",
					chain: {
						chainUID: uniqueChainUID(),
						txHash: "0xarea2",
						chainIdSnapshot: 11155420,
					},
				},
			});
			const intervention = await payload.create({
				collection: "interventions",
				data: {
					interventionId: uniqueId("INT"),
					area: area.id,
					interventionType: String(InterventionType.RoutineMaintenance) as "1",
					description: "Should fail",
					commissioning: { sponsor: sponsor.id },
					crew: [{ gardener: leadGardener.id, isCrewLead: true }],
					lifecycleStatus: "draft",
				},
			});
			await payload.update({
				collection: "interventions",
				id: intervention.id,
				data: {
					scheduling: {
						scheduledDate: new Date("2026-05-02T10:00:00Z").toISOString(),
						estimatedMinutes: 60,
					},
				},
				overrideAccess: true,
				context: { skipLifecycleHooks: true },
			});

			getOpenGardenContext.mockResolvedValueOnce({
				client: {
					scheduleIntervention: vi
						.fn()
						.mockRejectedValue(new Error("Forced SDK failure")),
					// biome-ignore lint/suspicious/noExplicitAny: minimal fake client
				} as any,
				chainId: 11155420,
				attesterWallet: "0x4444444444444444444444444444444444444444",
			});

			const runScheduleHandler = scheduleInterventionTask.handler as (
				// biome-ignore lint/suspicious/noExplicitAny: jobs runtime shape
				args: any,
				// biome-ignore lint/suspicious/noExplicitAny: jobs runtime shape
			) => Promise<any>;
			await expect(
				runScheduleHandler({
					input: { interventionId: intervention.id },
					req: fakeReq(),
				}),
			).rejects.toThrow("Forced SDK failure");

			const updated = await payload.findByID({
				collection: "interventions",
				id: intervention.id,
				depth: 0,
			});
			expect(updated.lifecycleStatus).toBe("failed");
			expect(updated.revocation?.failedFrom).toBe("draft");

			const audit = await payload.find({
				collection: "chainTransactions",
				where: {
					and: [
						{ kind: { equals: "scheduleIntervention" } },
						{ relatedId: { equals: String(intervention.id) } },
					],
				},
				limit: 1,
				depth: 0,
			});
			expect(audit.totalDocs).toBe(1);
			expect(audit.docs[0]?.status).toBe("failed");
			expect(audit.docs[0]?.error).toContain("Forced SDK failure");
		});
	});
});
