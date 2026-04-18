import type {
	InterventionType,
	PublishedInterventionInput,
} from "@refi-italia/opengarden";
import type { TaskConfig } from "payload";

import {
	getOpenGardenContext,
	type OpenGardenContext,
} from "../lib/openGardenClient";
import {
	createAttestationRecord,
	extractCommissionId,
	failInterventionAndRethrow,
	requireAreaUID,
} from "../lib/taskHelpers";

type PublishInterventionInput = {
	/** Payload document id of the `interventions` row to publish. */
	interventionId: string;
};

type PublishInterventionOutput = {
	chainUID: string;
	txHash: string;
};

/**
 * Task that drives an `interventions` row from `validated` →
 * `published` by calling `OpenGardenClient.publishIntervention`, writing
 * an `attestations` row, and setting `publishAttestation`. Also flips
 * the linked `evidenceBundles` row from `uploaded` → `published` so
 * the two lifecycles stay coherent.
 *
 * Preconditions:
 * - `scheduling.attestation` set (scheduleIntervention task)
 * - `validation.attestation` set (validateIntervention task)
 * - Crew activities (checkin/checkout/report) all have committed attestations
 * - An `evidenceBundles` row in `bundleState === "uploaded"` with `evidenceBundleHash` set
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
	inputSchema: [
		{
			name: "interventionId",
			type: "text",
			required: true,
		},
	],
	outputSchema: [
		{ name: "chainUID", type: "text", required: true },
		{ name: "txHash", type: "text", required: true },
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
			const att = existingPubAtt as { uid: string; txHash?: string };
			return {
				output: {
					chainUID: att.uid,
					txHash: att.txHash ?? "",
				},
			};
		}

		if (intervention.lifecycleStatus !== "validated") {
			throw new Error(
				`Intervention ${interventionId} is in lifecycleStatus="${intervention.lifecycleStatus}"; expected "validated".`,
			);
		}

		const areaUID = requireAreaUID(intervention.area, `Intervention ${interventionId} →`);

		// ─── Derive execution values from activities ──────────────────────
		const activitiesResult = await payload.find({
			collection: "activities",
			where: { intervention: { equals: interventionId } },
			depth: 1,
			limit: 200,
			overrideAccess: true,
			req,
		});
		const activities = activitiesResult.docs;

		// executionDate: latest checkout claimedTimestamp
		// biome-ignore lint/suspicious/noExplicitAny: activity rows
		const checkoutActivities = activities.filter(
			(a: any) => a.type === "checkout",
		);
		// biome-ignore lint/suspicious/noExplicitAny: activity rows
		const latestCheckout = checkoutActivities.sort(
			(a: any, b: any) =>
				new Date(b.claimedTimestamp).getTime() -
				new Date(a.claimedTimestamp).getTime(),
		)[0];
		if (!latestCheckout) {
			throw new Error(
				`Intervention ${interventionId} has no checkout activity; record crew activity first.`,
			);
		}
		const executionDate = new Date(latestCheckout.claimedTimestamp as string);

		// health scores: from healthcheck activity
		// biome-ignore lint/suspicious/noExplicitAny: activity rows
		const healthcheckActivity = activities.find(
			(a: any) => a.type === "healthcheck",
		);
		// biome-ignore lint/suspicious/noExplicitAny: data is a freeform JSON field
		const hcData = (healthcheckActivity as any)?.data as
			| Record<string, unknown>
			| undefined;
		const healthBefore = (hcData?.metadata as any)?.baseline?.score ?? 0;
		const healthAfter = (hcData?.healthScore as number) ?? 0;

		// ─── Find the evidence bundle ──────────────────────────────────────
		const bundlesResult = await payload.find({
			collection: "evidenceBundles",
			where: { intervention: { equals: interventionId } },
			depth: 0,
			limit: 1,
			overrideAccess: true,
			req,
		});
		const bundle = bundlesResult.docs[0] ?? null;
		if (!bundle) {
			throw new Error(
				`Intervention ${interventionId} has no evidence bundle; run buildBundle first.`,
			);
		}
		if (bundle.bundleState !== "uploaded") {
			throw new Error(
				`Evidence bundle ${bundle.id} is in bundleState="${bundle.bundleState}"; expected "uploaded".`,
			);
		}
		if (!bundle.evidenceBundleHash) {
			throw new Error(
				`Evidence bundle ${bundle.id} has no evidenceBundleHash; re-run buildBundle.`,
			);
		}
		if (typeof bundle.offchainCount !== "number") {
			throw new Error(
				`Evidence bundle ${bundle.id} is missing offchainCount; re-run buildBundle.`,
			);
		}

		const commissionId = extractCommissionId(intervention);

		const crew = Array.isArray(intervention.crew) ? intervention.crew : [];

		const sdkInput: PublishedInterventionInput = {
			areaUID,
			interventionId: intervention.interventionId,
			interventionType: Number(
				intervention.interventionType,
			) as InterventionType,
			executionDate,
			healthBefore,
			healthAfter,
			commissionId,
			evidenceBundleHash: bundle.evidenceBundleHash,
			offchainCount: bundle.offchainCount,
			crewSize: crew.length,
		};

		let context: OpenGardenContext | null = null;
		try {
			context = await getOpenGardenContext(payload);
			const result = await context.client.publishIntervention(sdkInput);

			const attestationRow = await createAttestationRecord(req, {
				uid: result.uid,
				schemaName: "PublishedIntervention",
				signedAttestation: {} as unknown as Record<string, unknown>,
				timestampTxHash: result.txHash,
				chainIdSnapshot: context.chainId,
				attesterWallet: context.attesterWallet,
				relatedCollection: "interventions",
				relatedId: interventionId,
			});

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

			await payload.update({
				collection: "evidenceBundles",
				id: bundle.id,
				data: {
					bundleState: "published",
				},
				overrideAccess: true,
				context: { skipLifecycleHooks: true },
				req,
			});

			return {
				output: { chainUID: result.uid, txHash: result.txHash },
			};
		} catch (err) {
			return await failInterventionAndRethrow(req, interventionId, "validated", "publishIntervention", err);
		}
	},
};
