import { getPayload, type Payload, type PayloadRequest } from "payload";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import config from "@/payload.config";
import { setOpenGardenContextOverride } from "@/lib/openGardenClient";
import { commitActivityChainTask } from "@/tasks/commitActivityChain";
import { publishInterventionTask } from "@/tasks/publishIntervention";
import { scheduleInterventionTask } from "@/tasks/scheduleIntervention";
import { verifyBundleTask } from "@/tasks/verifyBundle";
import {
	createGardener,
	createIntervention,
	createRegisteredAreaWithAttestation,
	createSponsor,
	uniqueId,
} from "../helpers/fixtures";
import {
	ensureMockReady,
	makeBundleVerification,
	makeMockContext,
	makeOnChainResult,
} from "../helpers/mockClient";

let payload: Payload;

const reqOf = (p: Payload): PayloadRequest =>
	({ payload: p }) as unknown as PayloadRequest;

const seedReadyToSchedule = async () => {
	const area = await createRegisteredAreaWithAttestation(payload);
	const sponsor = await createSponsor(payload, {
		kind: "corporate",
		canonicalKey: { sponsorId: uniqueId("ACME") },
	});
	const gardener = await createGardener(payload, { displayName: "Lead" });
	const intervention = await createIntervention(payload, {
		areaId: area.id,
		sponsorId: sponsor.id,
		description: "Routine maintenance",
		crew: [{ gardener: gardener.id, isCrewLead: true }],
		tasks: [
			{ code: "PRUNE", label: "Prune trees" },
			{ code: "CLEAN", label: "Clean pathways" },
		],
	});
	// Server-action fields written via skipLifecycleHooks (matches action behavior).
	await payload.update({
		collection: "interventions",
		id: intervention.id,
		data: {
			scheduling: {
				scheduledDate: new Date("2026-05-01T08:00:00Z").toISOString(),
				plannedDuration: 90,
			},
		},
		context: { skipLifecycleHooks: true },
	});
	return { area, sponsor, gardener, intervention };
};

beforeAll(async () => {
	payload = await getPayload({ config: await config });
	await ensureMockReady();
});

afterEach(() => {
	setOpenGardenContextOverride(null);
});

// ─── scheduleIntervention task ───────────────────────────────────────

describe("scheduleIntervention task", () => {
	it("calls SDK, creates activities row + attestation, flips status", async () => {
		const { intervention, gardener } = await seedReadyToSchedule();
		const { context, calls } = makeMockContext();
		setOpenGardenContextOverride(context);

		const result = await (scheduleInterventionTask.handler as Function)({
			input: { interventionId: String(intervention.id) },
			req: reqOf(payload),
			// biome-ignore lint/suspicious/noExplicitAny: minimal task ctx
		} as any);

		// SDK was called with spec-shaped input
		expect(calls.scheduleIntervention).toHaveLength(1);
		const sdkInput = calls.scheduleIntervention[0]
			.payload as Record<string, unknown>;
		expect(sdkInput.interventionId).toBe(intervention.interventionId);
		expect(sdkInput.crewSize).toBe(1);
		expect(sdkInput.plannedDuration).toBe(90);
		expect(sdkInput.tasksPlanned).toEqual(["PRUNE", "CLEAN"]);
		expect(sdkInput.areaUID).toBeTruthy();

		// Activities row exists with type=schedule + linked attestation
		const activities = await payload.find({
			collection: "activities",
			where: {
				and: [
					{ intervention: { equals: intervention.id } },
					{ type: { equals: "schedule" } },
				],
			},
			depth: 2,
			overrideAccess: true,
		});
		expect(activities.docs).toHaveLength(1);
		const schedule = activities.docs[0];
		expect(schedule.type).toBe("schedule");
		expect(schedule.attestation).toBeTruthy();
		const attestation = schedule.attestation as unknown as Record<string, unknown>;
		expect(attestation.uid).toBe(result.output.chainUID);
		expect(attestation.payload).toBeTruthy();
		expect((attestation.payload as Record<string, unknown>).crewSize).toBe(1);

		// Activities.gardener is set to crew lead
		const sg = schedule.gardener as { id?: string | number } | string | number;
		const sgId = typeof sg === "object" ? sg?.id : sg;
		expect(String(sgId)).toBe(String(gardener.id));

		// Intervention status flipped to scheduled
		const reloaded = await payload.findByID({
			collection: "interventions",
			id: intervention.id,
			depth: 1,
			overrideAccess: true,
		});
		expect(reloaded.lifecycleStatus).toBe("scheduled");

		// activityId returned points at the created row
		expect(result.output.activityId).toBe(String(schedule.id));
	});

	it("short-circuits idempotently on re-queue", async () => {
		const { intervention } = await seedReadyToSchedule();
		const { context, calls } = makeMockContext();
		setOpenGardenContextOverride(context);

		await (scheduleInterventionTask.handler as Function)({
			input: { interventionId: String(intervention.id) },
			req: reqOf(payload),
			// biome-ignore lint/suspicious/noExplicitAny: minimal task ctx
		} as any);

		// Re-run while already scheduled — must not call SDK again
		await (scheduleInterventionTask.handler as Function)({
			input: { interventionId: String(intervention.id) },
			req: reqOf(payload),
			// biome-ignore lint/suspicious/noExplicitAny: minimal task ctx
		} as any);

		expect(calls.scheduleIntervention).toHaveLength(1);
	});

	it("rejects when intervention is not in draft state", async () => {
		const { intervention } = await seedReadyToSchedule();
		await payload.update({
			collection: "interventions",
			id: intervention.id,
			data: { lifecycleStatus: "in_progress" },
			context: { skipLifecycleHooks: true },
		});

		const { context } = makeMockContext();
		setOpenGardenContextOverride(context);

		await expect(
			(scheduleInterventionTask.handler as Function)({
				input: { interventionId: String(intervention.id) },
				req: reqOf(payload),
				// biome-ignore lint/suspicious/noExplicitAny: minimal task ctx
			} as any),
		).rejects.toThrow(/expected "draft"/i);
	});
});

// ─── commitActivityChain task ────────────────────────────────────────

describe("commitActivityChain task", () => {
	const seedScheduled = async () => {
		const { intervention, gardener, area } = await seedReadyToSchedule();
		const { context } = makeMockContext();
		setOpenGardenContextOverride(context);
		await (scheduleInterventionTask.handler as Function)({
			input: { interventionId: String(intervention.id) },
			req: reqOf(payload),
			// biome-ignore lint/suspicious/noExplicitAny: minimal task ctx
		} as any);
		await payload.update({
			collection: "interventions",
			id: intervention.id,
			data: { lifecycleStatus: "in_progress" },
			context: { skipLifecycleHooks: true },
		});
		setOpenGardenContextOverride(null);
		return { intervention, gardener, area };
	};

	it("dispatches checkin to SDK and persists payload + attestation", async () => {
		const { intervention, gardener } = await seedScheduled();

		const checkin = await payload.create({
			collection: "activities",
			data: {
				type: "checkin",
				intervention: intervention.id,
				gardener: gardener.id,
				claimedTimestamp: new Date("2026-05-01T08:30:00Z").toISOString(),
				data: { latitude: 41.9, longitude: 12.5 },
			},
			overrideAccess: true,
		});

		const { context, calls } = makeMockContext();
		setOpenGardenContextOverride(context);

		await (commitActivityChainTask.handler as Function)({
			input: { activityId: String(checkin.id) },
			req: reqOf(payload),
			// biome-ignore lint/suspicious/noExplicitAny: minimal task ctx
		} as any);

		expect(calls.checkin).toHaveLength(1);
		// Payload is the SDK-canonical shape: GPS in int32 microdegrees per
		// spec §9.3, NOT the floating-point degrees we passed in.
		const sdkInput = calls.checkin[0].payload as Record<string, unknown>;
		expect(sdkInput.latitude).toBe(41_900_000);
		expect(sdkInput.longitude).toBe(12_500_000);
		// interventionId is in the refUID slot, not the payload (spec §3.2.2)
		const refUID = (
			calls.checkin[0].signedAttestation.message as Record<string, unknown>
		).refUID;
		expect(typeof refUID).toBe("string");
		expect(refUID).toMatch(/^0x[0-9a-f]{64}$/);

		const reloaded = await payload.findByID({
			collection: "activities",
			id: checkin.id,
			depth: 2,
			overrideAccess: true,
		});
		const att = reloaded.attestation as unknown as Record<string, unknown>;
		expect(att.uid).toBe(calls.checkin[0].uid);
		expect(att.payload).toEqual(calls.checkin[0].payload);
		// activity.data was synced to the SDK-normalized payload
		expect(reloaded.data).toEqual(calls.checkin[0].payload);
	});

	it("dispatches report with tasksCompleted + reportedEffort + mediaHash", async () => {
		const { intervention, gardener } = await seedScheduled();

		const report = await payload.create({
			collection: "activities",
			data: {
				type: "report",
				intervention: intervention.id,
				gardener: gardener.id,
				claimedTimestamp: new Date("2026-05-01T11:00:00Z").toISOString(),
				data: {
					tasksCompleted: ["PRUNE", "CLEAN"],
					reportedEffort: 90,
					notes: "Done",
				},
			},
			overrideAccess: true,
		});

		const { context, calls } = makeMockContext();
		setOpenGardenContextOverride(context);

		await (commitActivityChainTask.handler as Function)({
			input: { activityId: String(report.id) },
			req: reqOf(payload),
			// biome-ignore lint/suspicious/noExplicitAny: minimal task ctx
		} as any);

		expect(calls.submitReport).toHaveLength(1);
		const sdkInput = calls.submitReport[0].payload as Record<string, unknown>;
		expect(sdkInput.tasksCompleted).toEqual(["PRUNE", "CLEAN"]);
		expect(sdkInput.reportedEffort).toBe(90);
		expect(typeof sdkInput.mediaHash).toBe("string"); // ZERO_BYTES32 fallback
		expect(sdkInput.notes).toBe("Done");
	});

	it("dispatches healthcheck with mediaHash + metadata, derives areaUID", async () => {
		const { intervention } = await seedScheduled();

		const hc = await payload.create({
			collection: "activities",
			data: {
				type: "healthcheck",
				intervention: intervention.id,
				claimedTimestamp: new Date("2026-05-01T12:00:00Z").toISOString(),
				data: {
					healthScore: 8,
					notes: "Looks great",
					metadata: { v: 1, weather: "sunny" },
				},
			},
			overrideAccess: true,
		});

		const { context, calls } = makeMockContext();
		setOpenGardenContextOverride(context);

		await (commitActivityChainTask.handler as Function)({
			input: { activityId: String(hc.id) },
			req: reqOf(payload),
			// biome-ignore lint/suspicious/noExplicitAny: minimal task ctx
		} as any);

		expect(calls.recordHealthcheck).toHaveLength(1);
		const sdkInput = calls.recordHealthcheck[0].payload as Record<string, unknown>;
		expect(sdkInput.healthScore).toBe(8);
		expect(sdkInput.metadata).toEqual({ v: 1, weather: "sunny" });
		// Healthcheck areaUID lives in refUID slot (spec §3.2.5), not in payload.
		const refUID = (
			calls.recordHealthcheck[0].signedAttestation.message as Record<
				string,
				unknown
			>
		).refUID;
		expect(typeof refUID).toBe("string");
		expect(refUID).toMatch(/^0x[0-9a-f]{64}$/);
	});

	// NB: a "queue commitActivityChain on a schedule row" test is structurally
	// unreachable in normal flow — the schedule row is always created with
	// `attestation` already linked (by scheduleIntervention task), so the
	// idempotency short-circuit fires before dispatchSdkCall. The defensive
	// `throw` for `type === "schedule"` is a defence-in-depth guard against a
	// future refactor that loses the link. No test exercises it.
});

// ─── publishIntervention task ────────────────────────────────────────

describe("publishIntervention task", () => {
	const seedReadyToPublish = async () => {
		const { intervention, gardener } = await seedReadyToSchedule();

		const { context: scheduleCtx } = makeMockContext();
		setOpenGardenContextOverride(scheduleCtx);
		await (scheduleInterventionTask.handler as Function)({
			input: { interventionId: String(intervention.id) },
			req: reqOf(payload),
			// biome-ignore lint/suspicious/noExplicitAny: minimal task ctx
		} as any);
		setOpenGardenContextOverride(null);

		await payload.update({
			collection: "interventions",
			id: intervention.id,
			data: { lifecycleStatus: "in_progress" },
			context: { skipLifecycleHooks: true },
		});

		// Crew chain: checkin → checkout → report, each commit-chained
		const t0 = "2026-05-01T08:30:00Z";
		const t1 = "2026-05-01T11:00:00Z";
		const t2 = "2026-05-01T11:15:00Z";
		const seedActivity = async (
			type: "checkin" | "checkout" | "report",
			ts: string,
			data: Record<string, unknown>,
		) => {
			const a = await payload.create({
				collection: "activities",
				data: {
					type,
					intervention: intervention.id,
					gardener: gardener.id,
					claimedTimestamp: ts,
					data,
				},
				overrideAccess: true,
			});
			const { context: commitCtx } = makeMockContext();
			setOpenGardenContextOverride(commitCtx);
			await (commitActivityChainTask.handler as Function)({
				input: { activityId: String(a.id) },
				req: reqOf(payload),
				// biome-ignore lint/suspicious/noExplicitAny: minimal task ctx
			} as any);
			setOpenGardenContextOverride(null);
			return a;
		};
		await seedActivity("checkin", t0, { latitude: 41.9, longitude: 12.5 });
		await seedActivity("checkout", t1, {});
		await seedActivity("report", t2, {
			tasksCompleted: ["PRUNE", "CLEAN"],
			reportedEffort: 90,
			notes: "Done",
		});

		await payload.update({
			collection: "interventions",
			id: intervention.id,
			data: {
				lifecycleStatus: "completed",
				completion: {
					approved: true,
					qualityScore: 9,
					feedback: "Solid work",
				},
			},
			context: { skipLifecycleHooks: true },
		});

		return { intervention };
	};

	it("rehydrates schedule + crew, calls finalizeIntervention, persists bundle bytes + publication", async () => {
		const { intervention } = await seedReadyToPublish();
		const publication = makeOnChainResult();
		const { context, calls } = makeMockContext({
			finalizeIntervention: { publication },
		});
		setOpenGardenContextOverride(context);

		const result = await (publishInterventionTask.handler as Function)({
			input: { interventionId: String(intervention.id) },
			req: reqOf(payload),
			// biome-ignore lint/suspicious/noExplicitAny: minimal task ctx
		} as any);

		expect(calls.finalizeIntervention).toHaveLength(1);
		const sdkInput = calls.finalizeIntervention[0];
		expect(sdkInput.interventionId).toBe(intervention.interventionId);
		expect(sdkInput.areaUID).toBeTruthy();
		expect(sdkInput.schedule.type).toBe("schedule");
		expect(sdkInput.crewActivities).toHaveLength(3);
		const types = sdkInput.crewActivities.map((a) => a.type).sort();
		expect(types).toEqual(["checkin", "checkout", "report"]);
		// Each rehydrated activity carries payload + signedAttestation
		for (const a of sdkInput.crewActivities) {
			expect(a.payload).toBeDefined();
			expect(a.signedAttestation).toBeDefined();
			expect(typeof a.uid).toBe("string");
		}

		// Status flipped + publication attestation linked
		const reloaded = await payload.findByID({
			collection: "interventions",
			id: intervention.id,
			depth: 2,
			overrideAccess: true,
		});
		expect(reloaded.lifecycleStatus).toBe("published");
		const pubAtt = reloaded.publishAttestation as unknown as Record<string, unknown>;
		expect(pubAtt.uid).toBe(publication.uid);

		// EvidenceBundles row created with bundleBytesBase64 + hash
		const bundles = await payload.find({
			collection: "evidenceBundles",
			where: { intervention: { equals: intervention.id } },
			limit: 1,
			depth: 0,
			overrideAccess: true,
		});
		expect(bundles.docs).toHaveLength(1);
		const bundle = bundles.docs[0];
		expect(bundle.bundleState).toBe("published");
		expect(bundle.evidenceBundleHash).toBe(result.output.evidenceBundleHash);
		expect(typeof bundle.bundleBytesBase64).toBe("string");
		expect((bundle.bundleBytesBase64 as string).length).toBeGreaterThan(0);
		// base64 decodes to JSON parseable as the bundle envelope
		const decoded = Buffer.from(
			bundle.bundleBytesBase64 as string,
			"base64",
		).toString("utf8");
		const parsed = JSON.parse(decoded);
		expect(parsed.interventionId).toBe(intervention.interventionId);
	});

	it("rejects when intervention is not in completed state", async () => {
		const { intervention } = await seedReadyToSchedule();
		const { context } = makeMockContext();
		setOpenGardenContextOverride(context);

		await expect(
			(publishInterventionTask.handler as Function)({
				input: { interventionId: String(intervention.id) },
				req: reqOf(payload),
				// biome-ignore lint/suspicious/noExplicitAny: minimal task ctx
			} as any),
		).rejects.toThrow(/expected "completed"/i);
	});
});

// ─── rehydration round-trip ──────────────────────────────────────────
//
// The single load-bearing strict-mock test: runs the full schedule →
// commit×3 → publish chain end-to-end and asserts the mock's
// `finalizeIntervention` preflight (which calls the real SDK
// `validateFinalizeInput`) accepts the input the publish task assembles
// via `rehydrateTimestampedResult`. If rehydration ever drops a field,
// mangles refUID, or breaks payload-hash integrity, this fails loudly.
//
// (Per-method input-validation tests for the mock were dropped — they
// duplicated SDK package tests. The mock delegates to real SDK validators;
// if those break, that's an SDK package regression, not a webapp one.)

describe("publish round-trip vs SDK preflight", () => {
	it("rehydrated input passes validateFinalizeInput", async () => {
		// This is the round-trip test that locks in the rehydration shape.
		// If publishIntervention's rehydrateTimestampedResult ever produces
		// output that the SDK preflight rejects, this will fail.
		const { intervention } = await (async () => {
			const area = await createRegisteredAreaWithAttestation(payload);
			const sponsor = await createSponsor(payload, {
				kind: "corporate",
				canonicalKey: { sponsorId: uniqueId("ACME") },
			});
			const gardener = await createGardener(payload, {
				displayName: "Preflight",
			});
			const intervention = await createIntervention(payload, {
				areaId: area.id,
				sponsorId: sponsor.id,
				description: "preflight round trip",
				crew: [{ gardener: gardener.id, isCrewLead: true }],
				tasks: [{ code: "PRUNE", label: "Prune" }],
			});
			await payload.update({
				collection: "interventions",
				id: intervention.id,
				data: {
					scheduling: {
						scheduledDate: new Date("2026-05-01T08:00:00Z").toISOString(),
						plannedDuration: 60,
					},
				},
				context: { skipLifecycleHooks: true },
			});
			return { intervention, gardener };
		})();

		// Schedule
		const { context: schedCtx } = makeMockContext();
		setOpenGardenContextOverride(schedCtx);
		await (scheduleInterventionTask.handler as Function)({
			input: { interventionId: String(intervention.id) },
			req: reqOf(payload),
			// biome-ignore lint/suspicious/noExplicitAny: minimal task ctx
		} as any);
		setOpenGardenContextOverride(null);

		await payload.update({
			collection: "interventions",
			id: intervention.id,
			data: { lifecycleStatus: "in_progress" },
			context: { skipLifecycleHooks: true },
		});

		// Crew chain
		const gardenerId = (
			await payload.find({
				collection: "gardeners",
				where: { displayName: { equals: "Preflight" } },
				limit: 1,
				overrideAccess: true,
			})
		).docs[0]!.id;
		for (const [type, ts, data] of [
			["checkin", "2026-05-01T08:30:00Z", { latitude: 41.9, longitude: 12.5 }],
			["checkout", "2026-05-01T11:00:00Z", {}],
			["report", "2026-05-01T11:15:00Z", {
				tasksCompleted: ["PRUNE"],
				reportedEffort: 60,
				notes: "",
			}],
		] as const) {
			const a = await payload.create({
				collection: "activities",
				data: {
					type,
					intervention: intervention.id,
					gardener: gardenerId,
					claimedTimestamp: ts,
					data,
				},
				overrideAccess: true,
			});
			const { context: cmt } = makeMockContext();
			setOpenGardenContextOverride(cmt);
			await (commitActivityChainTask.handler as Function)({
				input: { activityId: String(a.id) },
				req: reqOf(payload),
				// biome-ignore lint/suspicious/noExplicitAny: minimal task ctx
			} as any);
			setOpenGardenContextOverride(null);
		}

		await payload.update({
			collection: "interventions",
			id: intervention.id,
			data: {
				lifecycleStatus: "completed",
				completion: { approved: true, qualityScore: 8, feedback: "ok" },
			},
			context: { skipLifecycleHooks: true },
		});

		// Publish — this is where preflight runs against the rehydrated input.
		// If rehydration drops a field, mangles refUID, or breaks payloadHash
		// integrity, the mock's validateFinalizeInput call throws and this
		// test fails loudly.
		const { context: pubCtx } = makeMockContext();
		setOpenGardenContextOverride(pubCtx);
		await expect(
			(publishInterventionTask.handler as Function)({
				input: { interventionId: String(intervention.id) },
				req: reqOf(payload),
				// biome-ignore lint/suspicious/noExplicitAny: minimal task ctx
			} as any),
		).resolves.toBeTruthy();
	});
});

// ─── verifyBundle task ───────────────────────────────────────────────

describe("verifyBundle task", () => {
	it("decodes base64 bytes, calls verifyEvidenceBundle, surfaces tiered flags", async () => {
		// Seed a published bundle row directly (skip the publish dance).
		const sponsor = await createSponsor(payload, { kind: "volunteer" });
		const area = await createRegisteredAreaWithAttestation(payload);
		const intervention = await createIntervention(payload, {
			areaId: area.id,
			sponsorId: sponsor.id,
			description: "Verify-only test",
			crew: [],
		});
		const publicationAtt = await payload.create({
			collection: "attestations",
			data: {
				uid: `0x${"d".repeat(60)}${Date.now().toString(16).padStart(4, "0").slice(-4)}`,
				schemaName: "Intervention",
				signedAttestation: {},
				timestampTxHash: "0xpub",
				chainIdSnapshot: 11_155_420,
				attesterWallet: `0x${"a".repeat(40)}`,
				status: "committed",
				relatedCollection: "interventions",
				relatedId: String(intervention.id),
			},
			overrideAccess: true,
		});
		await payload.update({
			collection: "interventions",
			id: intervention.id,
			data: {
				lifecycleStatus: "published",
				publishAttestation: publicationAtt.id,
			},
			overrideAccess: true,
			context: { skipLifecycleHooks: true },
		});
		const bundleBytes = Buffer.from(
			JSON.stringify({
				interventionId: intervention.interventionId,
				bundleVersion: "0.1.0",
				activities: [],
			}),
		);
		const bundle = await payload.create({
			collection: "evidenceBundles",
			data: {
				intervention: intervention.id,
				bundleState: "published",
				evidenceBundleHash: "0xhash",
				bundleBytesBase64: bundleBytes.toString("base64"),
			},
			overrideAccess: true,
			context: { skipLifecycleHooks: true },
		});

		const { context, calls } = makeMockContext({
			verifyEvidenceBundle: makeBundleVerification({
				temporalOrderValid: false,
				valid: false,
			}),
		});
		setOpenGardenContextOverride(context);

		await (verifyBundleTask.handler as Function)({
			input: { bundleId: String(bundle.id) },
			req: reqOf(payload),
			// biome-ignore lint/suspicious/noExplicitAny: minimal task ctx
		} as any);

		expect(calls.verifyEvidenceBundle).toHaveLength(1);
		expect(calls.verifyEvidenceBundle[0].uid).toBe(publicationAtt.uid);
		// base64 round-tripped to bytes correctly
		const passedBytes = calls.verifyEvidenceBundle[0].bundleBytes;
		expect(Buffer.from(passedBytes).equals(bundleBytes)).toBe(true);

		const reloaded = await payload.findByID({
			collection: "evidenceBundles",
			id: bundle.id,
			depth: 0,
			overrideAccess: true,
		});
		expect(reloaded.bundleState).toBe("verified");
		expect(reloaded.verification?.valid).toBe(false);
		expect(reloaded.verification?.bundleHashValid).toBe(true);
		expect(reloaded.verification?.signaturesValid).toBe(true);
		expect(reloaded.verification?.temporalOrderValid).toBe(false);
		expect(reloaded.verification?.lastVerifiedAt).toBeTruthy();
	});
});
