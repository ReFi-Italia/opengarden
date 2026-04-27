import type {
	FinalizeInterventionInput,
	InterventionType,
	TimestampedOffChainResult,
} from "@refi-italia/opengarden";
import { serializeEvidenceBundle } from "@refi-italia/opengarden";
import type { TaskConfig } from "payload";

import {
	getOpenGardenContext,
	type OpenGardenContext,
} from "../lib/openGardenClient";
import {
	cancelInterventionAndRethrow,
	createAttestationRecord,
	extractCommissionId,
	rehydrateTimestampedResult,
	requireAreaUID,
} from "../lib/taskHelpers";
import { serializeBigInts } from "../lib/serializeBigInts";

type PublishInterventionInput = {
	/** Payload document id of the `interventions` row to publish. */
	interventionId: string;
};

type PublishInterventionOutput = {
	chainUID: string;
	txHash: string;
	evidenceBundleHash: string;
	indexedCount: number;
};

/**
 * Publishes a completed intervention on-chain via the SDK's single
 * `finalizeIntervention` call (spec §5, SDK README "Full lifecycle").
 *
 * Inputs rehydrated from DB:
 *   - `schedule` TimestampedOffChainResult — from the `activities` row
 *     with `type === "schedule"` joined to its `attestation`.
 *   - `crewActivities` — every checkin/checkout/report row for this
 *     intervention, rehydrated from their persisted attestations.
 *
 * The SDK:
 *   1. Runs preflight against the configured policy.
 *   2. Builds the evidence bundle (spec §5.2).
 *   3. Serializes canonical bytes + computes keccak256.
 *   4. Indexes each activity to the off-chain attestation store (easscan).
 *   5. Publishes the on-chain `Intervention` attestation.
 *
 * Webapp responsibilities after the SDK call:
 *   - Persist the canonical bundle JSON on the `evidenceBundles` row (so
 *     verifiers can fetch the bytes from the webapp's exposed endpoint —
 *     spec §1 "Storage-Agnostic Commitments").
 *   - Create an `attestations` row for the on-chain publication.
 *   - Flip the intervention to `published` and point `publishAttestation`.
 */
export const publishInterventionTask: TaskConfig<{
	input: PublishInterventionInput;
	output: PublishInterventionOutput;
}> = {
	slug: "publishIntervention",
	label: "Publish Intervention on-chain",
	retries: {
		attempts: 3,
		backoff: { type: "exponential", delay: 5_000 },
	},
	inputSchema: [{ name: "interventionId", type: "text", required: true }],
	outputSchema: [
		{ name: "chainUID", type: "text", required: true },
		{ name: "txHash", type: "text", required: true },
		{ name: "evidenceBundleHash", type: "text", required: true },
		{ name: "indexedCount", type: "number", required: true },
	],
	handler: async ({ input, req }) => {
		const { payload } = req;
		const { interventionId } = input;

		const intervention = await payload.findByID({
			collection: "interventions",
			id: interventionId,
			depth: 2,
			req,
			overrideAccess: true,
		});

		const existingPubAtt = (intervention as { publishAttestation?: unknown })
			.publishAttestation;
		if (
			intervention.lifecycleStatus === "published" &&
			typeof existingPubAtt === "object" &&
			existingPubAtt !== null &&
			(existingPubAtt as { uid?: string }).uid
		) {
			const att = existingPubAtt as {
				uid: string;
				timestampTxHash?: string;
			};
			return {
				output: {
					chainUID: att.uid,
					txHash: att.timestampTxHash ?? "",
					evidenceBundleHash: "",
					indexedCount: 0,
				},
			};
		}

		if (intervention.lifecycleStatus !== "completed") {
			throw new Error(
				`Intervention ${interventionId} is in lifecycleStatus="${intervention.lifecycleStatus}"; expected "completed".`,
			);
		}

		const areaUID = requireAreaUID(
			intervention.area,
			`Intervention ${interventionId} →`,
		);

		// Fetch every activity for this intervention, with attestation populated.
		const activitiesResult = await payload.find({
			collection: "activities",
			where: { intervention: { equals: interventionId } },
			limit: 200,
			depth: 2,
			overrideAccess: true,
			req,
		});
		const activities = activitiesResult.docs as unknown as Array<
			Record<string, unknown>
		>;

		const schedule = findAndRehydrate(activities, "schedule", interventionId);

		// Crew activities: every checkin/checkout/report that has a committed
		// attestation. Healthchecks are area-scoped and excluded from bundles
		// (spec §5.2 bundle fields note).
		const crewTypes: TimestampedOffChainResult["type"][] = [
			"checkin",
			"checkout",
			"report",
		];
		const crewActivities: TimestampedOffChainResult[] = [];
		for (const a of activities) {
			const t = a.type as TimestampedOffChainResult["type"] | undefined;
			if (!t || !crewTypes.includes(t)) continue;
			crewActivities.push(rehydrateTimestampedResult(a.attestation, t));
		}
		if (crewActivities.length === 0) {
			throw new Error(
				`Intervention ${interventionId} has no crew activities; record checkin/checkout/report first.`,
			);
		}

		const commissionId = extractCommissionId(intervention);

		// executionDate: latest crew activity on-chain timestamp (ceiling of
		// the work window). Finalize preflight will assert this sits between
		// schedule and publication.
		const latestOnchain = crewActivities.reduce((max, a) => {
			const t = Number(a.onchainTimestamp);
			return t > max ? t : max;
		}, 0);
		const executionDate = new Date(latestOnchain * 1000);

		const sdkInput: FinalizeInterventionInput = {
			interventionId: intervention.interventionId,
			areaUID,
			schedule,
			crewActivities,
			interventionType: Number(
				intervention.interventionType,
			) as InterventionType,
			executionDate,
			commissionId,
		};

		let context: OpenGardenContext | null = null;
		try {
			context = await getOpenGardenContext(payload);
			const result = await context.client.finalizeIntervention(sdkInput);

			// Persist bundle JSON + hash on the evidenceBundles row so verifiers
			// can fetch the bytes from the webapp. Re-serialize here to get the
			// canonical bytes for the URL-exposed payload (the same bytes the
			// SDK hashed internally).
			const { bytes: bundleBytes } = serializeEvidenceBundle(result.bundle);
			const bundleBytesBase64 = Buffer.from(bundleBytes).toString("base64");

			const attestationRow = await createAttestationRecord(req, {
				uid: result.publication.uid,
				schemaName: "Intervention",
				signedAttestation: {} as unknown as Record<string, unknown>,
				timestampTxHash: result.publication.txHash,
				chainIdSnapshot: context.chainId,
				attesterWallet: context.attesterWallet,
				relatedCollection: "interventions",
				relatedId: interventionId,
			});

			// Upsert evidence bundle row. The row is unique per intervention.
			const existingBundle = await payload
				.find({
					collection: "evidenceBundles",
					where: { intervention: { equals: interventionId } },
					limit: 1,
					depth: 0,
					overrideAccess: true,
					req,
				})
				.catch(() => ({
					docs: [] as Array<{ id: string | number }>,
				}));

			const bundleData = {
				intervention: interventionId,
				interventionIdSnapshot: intervention.interventionId,
				areaUIDSnapshot: areaUID,
				bundleVersion: result.bundle.bundleVersion,
				evidenceBundleHash: result.evidenceBundleHash,
				offchainCount: result.bundle.activities.length,
				bundleJson: serializeBigInts(
					result.bundle as unknown as Record<string, unknown>,
				) as unknown as Record<string, unknown>,
				bundleBytesBase64,
				bundleState: "published" as const,
			};

			if (existingBundle.docs[0]?.id) {
				await payload.update({
					collection: "evidenceBundles",
					id: existingBundle.docs[0].id,
					data: bundleData,
					overrideAccess: true,
					context: { skipLifecycleHooks: true },
					req,
				});
			} else {
				await payload.create({
					collection: "evidenceBundles",
					data: bundleData,
					overrideAccess: true,
					context: { skipLifecycleHooks: true },
					req,
				});
			}

			await payload.update({
				collection: "interventions",
				id: interventionId,
				data: {
					lifecycleStatus: "published",
					publishAttestation: attestationRow.id,
				},
				overrideAccess: true,
				context: { skipLifecycleHooks: true },
				req,
			});

			return {
				output: {
					chainUID: result.publication.uid,
					txHash: result.publication.txHash,
					evidenceBundleHash: result.evidenceBundleHash,
					indexedCount: result.indexedCount,
				},
			};
		} catch (err) {
			return await cancelInterventionAndRethrow(
				req,
				interventionId,
				"completed",
				"publishIntervention",
				err,
			);
		}
	},
};

function findAndRehydrate(
	activities: Array<Record<string, unknown>>,
	type: TimestampedOffChainResult["type"],
	interventionId: string,
): TimestampedOffChainResult {
	const row = activities.find((a) => a.type === type);
	if (!row) {
		throw new Error(
			`Intervention ${interventionId} has no "${type}" activity; publish requires the schedule + crew chain.`,
		);
	}
	return rehydrateTimestampedResult(row.attestation, type);
}
