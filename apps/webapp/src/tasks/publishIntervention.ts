import type {
	InterventionType,
	PublishedInterventionInput,
} from "@refi-italia/opengarden";
import type { TaskConfig } from "payload";

import {
	getOpenGardenContext,
	type OpenGardenContext,
} from "../lib/openGardenClient";

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
 * `published` by calling `OpenGardenClient.publishIntervention` and
 * populating the `execution.chain.*` mirror. Also flips the linked
 * `evidenceBundles` row from `uploaded` → `published` so the two
 * lifecycles stay coherent.
 *
 * Preconditions (server action / upstream flows must set):
 * - `execution.executionDate`, `execution.healthBefore`,
 *   `execution.healthAfter`, `execution.offchainCount`
 * - `execution.evidenceBundle` pointing at a bundle row with
 *   `bundleState === "uploaded"` and `evidenceBundleHash` set
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

		if (
			intervention.lifecycleStatus === "published" &&
			intervention.execution?.chainUID
		) {
			return {
				output: {
					chainUID: intervention.execution.chainUID,
					txHash: intervention.execution.txHash ?? "",
				},
			};
		}

		if (intervention.lifecycleStatus !== "validated") {
			throw new Error(
				`Intervention ${interventionId} is in lifecycleStatus="${intervention.lifecycleStatus}"; expected "validated".`,
			);
		}

		const area = intervention.area;
		if (typeof area !== "object" || area === null || !area.chain?.chainUID) {
			throw new Error(
				`Intervention ${interventionId} → area has no on-chain UID.`,
			);
		}

		const execution = intervention.execution;
		if (!execution) {
			throw new Error(
				`Intervention ${interventionId} has no execution group populated.`,
			);
		}
		if (!execution.executionDate) {
			throw new Error(
				`Intervention ${interventionId} is missing execution.executionDate.`,
			);
		}
		if (typeof execution.healthBefore !== "number") {
			throw new Error(
				`Intervention ${interventionId} is missing execution.healthBefore.`,
			);
		}
		if (typeof execution.healthAfter !== "number") {
			throw new Error(
				`Intervention ${interventionId} is missing execution.healthAfter.`,
			);
		}
		if (typeof execution.offchainCount !== "number") {
			throw new Error(
				`Intervention ${interventionId} is missing execution.offchainCount; run buildBundle first.`,
			);
		}

		const bundleRef = execution.evidenceBundle;
		const bundle =
			typeof bundleRef === "object" && bundleRef !== null ? bundleRef : null;
		if (!bundle) {
			throw new Error(
				`Intervention ${interventionId} has no execution.evidenceBundle; build one before publishing.`,
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

		const sponsor = intervention.commissioning?.sponsor;
		const commissionId =
			typeof sponsor === "object" &&
			sponsor !== null &&
			sponsor.kind !== "volunteer" &&
			typeof sponsor.canonicalJson === "string" &&
			sponsor.canonicalJson.length > 0
				? sponsor.canonicalJson
				: null;

		const crew = Array.isArray(intervention.crew) ? intervention.crew : [];

		const sdkInput: PublishedInterventionInput = {
			areaUID: area.chain.chainUID,
			interventionId: intervention.interventionId,
			interventionType: Number(
				intervention.interventionType,
			) as InterventionType,
			executionDate: new Date(execution.executionDate),
			healthBefore: execution.healthBefore,
			healthAfter: execution.healthAfter,
			commissionId,
			evidenceBundleHash: bundle.evidenceBundleHash,
			offchainCount: execution.offchainCount,
			crewSize: crew.length,
		};

		let context: OpenGardenContext | null = null;
		try {
			context = await getOpenGardenContext(payload);
			const result = await context.client.publishIntervention(sdkInput);

			await payload.update({
				collection: "interventions",
				id: interventionId,
				data: {
					lifecycleStatus: "published",
					execution: {
						chainUID: result.uid,
						txHash: result.txHash,
						attesterWallet: context.attesterWallet,
						chainIdSnapshot: context.chainId,
					},
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
			const message = err instanceof Error ? err.message : String(err);

			await payload
				.update({
					collection: "interventions",
					id: interventionId,
					data: {
						lifecycleStatus: "failed",
						revocation: {
							failedFrom: "validated",
						},
					},
					overrideAccess: true,
					context: { skipLifecycleHooks: true },
					req,
				})
				.catch(() => undefined);

			payload.logger.error({
				msg: `publishIntervention task failed for intervention ${interventionId}`,
				error: message,
			});

			throw err;
		}
	},
};
