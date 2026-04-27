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
};

/**
 * Verifies a published `evidenceBundles` row end-to-end via
 * `client.verifyEvidenceBundle(uid, bundleBytes, { policy })`. Per spec
 * §5.4 verification splits into protocol-tier (non-negotiable) and
 * policy-tier (verifier's call) — this task runs the strict default
 * policy and surfaces the per-check breakdown onto `verification.*` so
 * the admin UI can render tier-level pass/fail.
 *
 * The bundle bytes are read from `bundle.bundleBytesBase64` (populated
 * by publishIntervention). Protocol is storage-agnostic — the webapp is
 * the publisher, so it holds the bytes and exposes them here.
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
	inputSchema: [{ name: "bundleId", type: "text", required: true }],
	outputSchema: [{ name: "valid", type: "checkbox", required: true }],
	handler: async ({ input, req }) => {
		const { payload } = req;
		const { bundleId } = input;

		const bundle = await payload.findByID({
			collection: "evidenceBundles",
			id: bundleId,
			depth: 2,
			req,
			overrideAccess: true,
		});

		if (bundle.bundleState !== "published" && bundle.bundleState !== "verified") {
			throw new Error(
				`Bundle ${bundleId} is in bundleState="${bundle.bundleState}"; expected "published" or "verified".`,
			);
		}

		const intervention = bundle.intervention;
		const pubAtt =
			typeof intervention === "object" && intervention !== null
				? (intervention as { publishAttestation?: unknown }).publishAttestation
				: null;
		const interventionUID =
			typeof pubAtt === "object" &&
			pubAtt !== null &&
			typeof (pubAtt as { uid?: unknown }).uid === "string"
				? (pubAtt as { uid: string }).uid
				: null;
		if (!interventionUID) {
			throw new Error(
				`Bundle ${bundleId} → intervention has no publishAttestation.uid.`,
			);
		}

		const base64 = (bundle as { bundleBytesBase64?: unknown }).bundleBytesBase64;
		if (typeof base64 !== "string" || !base64) {
			throw new Error(
				`Bundle ${bundleId} has no bundleBytesBase64; republish to populate.`,
			);
		}
		const bundleBytes = new Uint8Array(Buffer.from(base64, "base64"));

		let context: OpenGardenContext | null = null;
		try {
			context = await getOpenGardenContext(payload);
			const result = await context.client.verifyEvidenceBundle(
				interventionUID,
				bundleBytes,
			);

			await payload.update({
				collection: "evidenceBundles",
				id: bundleId,
				data: {
					bundleState: "verified",
					verification: {
						valid: result.valid,
						bundleHashValid: result.bundleHashValid,
						bundleVersionValid: result.bundleVersionValid,
						signaturesValid: result.signaturesValid,
						payloadIntegrityValid: result.payloadIntegrityValid,
						timestampsVerified: result.timestampsVerified,
						interventionScopeValid: result.interventionScopeValid,
						temporalOrderValid: result.temporalOrderValid,
						executionDateBracketed: result.executionDateBracketed,
						lastVerifiedAt: new Date().toISOString(),
						checksJson: result.checks as unknown as Record<string, unknown>,
					},
				},
				overrideAccess: true,
				context: { skipLifecycleHooks: true },
				req,
			});

			return {
				output: { valid: result.valid },
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);

			await payload
				.update({
					collection: "evidenceBundles",
					id: bundleId,
					data: { lastError: message },
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
