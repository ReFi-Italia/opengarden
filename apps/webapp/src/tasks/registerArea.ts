import type { AreaRegistrationInput, AreaType } from "@refi-italia/opengarden";
import type { TaskConfig } from "payload";

import {
	getOpenGardenContext,
	type OpenGardenContext,
} from "../lib/openGardenClient";
import { createAttestationRecord } from "../lib/taskHelpers";

type RegisterAreaInput = {
	/** Payload document id of the `areas` row to register on-chain. */
	areaId: string;
};

type RegisterAreaOutput = {
	chainUID: string;
	txHash: string;
};

/**
 * Task that drives an `areas` row from `draft` / `failed` → `registered` by
 * calling `OpenGardenClient.registerArea`, writing an `attestations` row,
 * and setting `area.attestation`.
 *
 * - Runs with Payload's job queue so the admin UI never blocks on a chain
 *   call that can exceed Vercel's serverless function timeout.
 * - Writes all mutations via `overrideAccess: true` +
 *   `context.skipLifecycleHooks: true` so the freeze-on-registered guard in
 *   `freezeRegisteredAreaInputs` stays authoritative for form-based edits.
 * - Idempotent: a retried run over an already-registered area short-circuits
 *   and returns the existing UID so worst-case duplicate dispatch can't double-attest.
 */
export const registerAreaTask: TaskConfig<{
	input: RegisterAreaInput;
	output: RegisterAreaOutput;
}> = {
	slug: "registerArea",
	label: "Register Area on-chain",
	retries: {
		attempts: 3,
		backoff: { type: "exponential", delay: 5_000 },
	},
	inputSchema: [
		{
			name: "areaId",
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
		const { areaId } = input;

		const area = await payload.findByID({
			collection: "areas",
			id: areaId,
			depth: 0,
			req,
			overrideAccess: true,
		});

		const existingAttestation = area.attestation;
		if (
			area.lifecycleStatus === "registered" &&
			typeof existingAttestation === "object" &&
			existingAttestation !== null &&
			(existingAttestation as { uid?: string }).uid
		) {
			const att = existingAttestation as {
				uid: string;
				timestampTxHash?: string;
			};
			return {
				output: {
					chainUID: att.uid,
					txHash: att.timestampTxHash ?? "",
				},
			};
		}

		if (
			area.lifecycleStatus !== "draft" &&
			area.lifecycleStatus !== "cancelled"
		) {
			throw new Error(
				`Area ${areaId} is in lifecycleStatus="${area.lifecycleStatus}"; expected "draft" or "cancelled".`,
			);
		}

		const sdkInput: AreaRegistrationInput = {
			areaId: area.areaId,
			latitude: area.coordinates?.[1] ?? 0,
			longitude: area.coordinates?.[0] ?? 0,
			areaType: Number(area.areaType) as AreaType,
			name: area.name,
			municipality: area.municipality,
			boundary:
				(area.boundary as Record<string, unknown> | null | undefined) ?? null,
			metadata: typeof area.metadata === "string" ? area.metadata : "",
		};

		let context: OpenGardenContext | null = null;
		try {
			context = await getOpenGardenContext(payload);
			const result = await context.client.registerArea(sdkInput);

			const attestationRow = await createAttestationRecord(req, {
				uid: result.uid,
				schemaName: "AreaRegistration",
				signedAttestation: {} as unknown as Record<string, unknown>,
				timestampTxHash: result.txHash,
				chainIdSnapshot: context.chainId,
				attesterWallet: context.attesterWallet,
				relatedCollection: "areas",
				relatedId: areaId,
			});

			await payload.update({
				collection: "areas",
				id: areaId,
				data: {
					lifecycleStatus: "registered",
					attestation: attestationRow.id,
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
					collection: "areas",
					id: areaId,
					data: { lifecycleStatus: "cancelled" },
					overrideAccess: true,
					context: { skipLifecycleHooks: true },
					req,
				})
				.catch(() => undefined);

			payload.logger.error({
				msg: `registerArea task failed for area ${areaId}`,
				error: message,
			});

			throw err;
		}
	},
};
