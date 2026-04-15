import type { TaskConfig } from "payload";

import {
	getOpenGardenContext,
	type OpenGardenContext,
} from "../lib/openGardenClient";

type VerifyBundleInput = {
	/** Payload document id of the `evidenceBundles` row to verify. */
	bundleId: string;
};

type VerifyBundleOutput = {
	valid: boolean;
	attestationCount: number;
	expectedCount: number;
};

/**
 * Task that drives an `evidenceBundles` row from `published` →
 * `verified` by downloading the bundle from storage and cross-checking
 * every attestation against the chain via
 * `OpenGardenClient.verifyEvidenceBundle`. Populates `verification.*`
 * with the structured check results.
 */
export const verifyBundleTask: TaskConfig<{
	input: VerifyBundleInput;
	output: VerifyBundleOutput;
}> = {
	slug: "verifyBundle",
	label: "Verify Evidence Bundle",
	retries: {
		attempts: 3,
		backoff: { type: "exponential", delay: 5_000 },
	},
	inputSchema: [
		{
			name: "bundleId",
			type: "text",
			required: true,
		},
	],
	outputSchema: [
		{ name: "valid", type: "checkbox", required: true },
		{ name: "attestationCount", type: "number", required: true },
		{ name: "expectedCount", type: "number", required: true },
	],
	handler: async ({ input, req }) => {
		const { payload } = req;
		const { bundleId } = input;

		const bundle = await payload.findByID({
			collection: "evidenceBundles",
			id: bundleId,
			depth: 1,
			req,
			overrideAccess: true,
		});

		if (bundle.bundleState === "verified" && bundle.verification?.valid) {
			return {
				output: {
					valid: true,
					attestationCount: bundle.verification.attestationCount ?? 0,
					expectedCount: bundle.verification.expectedCount ?? 0,
				},
			};
		}

		if (bundle.bundleState !== "published") {
			throw new Error(
				`Bundle ${bundleId} is in bundleState="${bundle.bundleState}"; expected "published".`,
			);
		}

		const intervention = bundle.intervention;
		const interventionUID =
			typeof intervention === "object" &&
			intervention !== null &&
			intervention.execution?.chainUID
				? intervention.execution.chainUID
				: null;
		if (!interventionUID) {
			throw new Error(
				`Bundle ${bundleId} → intervention has no execution.chainUID.`,
			);
		}

		let context: OpenGardenContext | null = null;
		try {
			context = await getOpenGardenContext(payload);
			const result = await context.client.verifyEvidenceBundle(interventionUID);

			await payload.update({
				collection: "evidenceBundles",
				id: bundleId,
				data: {
					bundleState: "verified",
					verification: {
						valid: result.valid,
						attestationCount: result.attestationCount,
						expectedCount: result.expectedCount,
						temporalOrderValid: result.temporalOrderValid,
						timestampsVerified: result.timestampsVerified,
						healthcheckOrderValid: result.healthcheckOrderValid,
						executionDateBracketed: result.executionDateBracketed,
						validationApproved: result.validationApproved,
						lastVerifiedAt: new Date().toISOString(),
						checksJson: result.checks,
					},
				},
				overrideAccess: true,
				context: { skipLifecycleHooks: true },
				req,
			});

			return {
				output: {
					valid: result.valid,
					attestationCount: result.attestationCount,
					expectedCount: result.expectedCount,
				},
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);

			await payload
				.update({
					collection: "evidenceBundles",
					id: bundleId,
					data: {
						lastError: message,
					},
					overrideAccess: true,
					context: { skipLifecycleHooks: true },
					req,
				})
				.catch(() => undefined);

			payload.logger.error({
				msg: `verifyBundle task failed for bundle ${bundleId}`,
				error: message,
			});

			throw err;
		}
	},
};
