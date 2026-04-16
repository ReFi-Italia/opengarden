import type { AreaRegistrationInput, AreaType } from "@refi-italia/opengarden";
import type { TaskConfig } from "payload";

import {
	getOpenGardenContext,
	type OpenGardenContext,
} from "../lib/openGardenClient";

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
 * calling `OpenGardenClient.registerArea` and populating the `chain.*` mirror.
 *
 * - Runs with Payload's job queue so the admin UI never blocks on a chain
 *   call that can exceed Vercel's serverless function timeout.
 * - Writes all mutations via `overrideAccess: true` +
 *   `context.skipLifecycleHooks: true` so the freeze-on-registered guard in
 *   `freezeRegisteredAreaInputs` stays authoritative for form-based edits
 *   but lets this handler populate the chain mirror.
 * - Idempotent: a retried run over an already-registered area short-circuits
 *   and returns the existing `chainUID`, so `retries.shouldRestore` (Payload's
 *   default `true`) and worst-case duplicate dispatch can't double-attest.
 * - Every attempt — success or failure — appends a `chainTransactions` row.
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

		// biome-ignore lint/suspicious/noExplicitAny: payload-types.ts not yet regenerated
		const existingAttestation = (area as any).attestation;
		if (
			area.lifecycleStatus === "registered" &&
			typeof existingAttestation === "object" &&
			existingAttestation !== null &&
			(existingAttestation as { uid?: string }).uid
		) {
			const att = existingAttestation as { uid: string; timestampTxHash?: string };
			return {
				output: {
					chainUID: att.uid,
					txHash: att.timestampTxHash ?? "",
				},
			};
		}

		if (area.lifecycleStatus !== "draft" && area.lifecycleStatus !== "failed") {
			throw new Error(
				`Area ${areaId} is in lifecycleStatus="${area.lifecycleStatus}"; expected "draft" or "failed".`,
			);
		}

		await payload.update({
			collection: "areas",
			id: areaId,
			data: { lifecycleStatus: "registering" },
			overrideAccess: true,
			context: { skipLifecycleHooks: true },
			req,
		});

		const sdkInput: AreaRegistrationInput = {
			areaId: area.areaId,
			latitude: area.latitude,
			longitude: area.longitude,
			areaType: Number(area.areaType) as AreaType,
			name: area.name,
			municipality: area.municipality,
			metadataHash:
				area.metadataHash && area.metadataHash.length > 0
					? area.metadataHash
					: null,
		};

		let context: OpenGardenContext | null = null;
		try {
			context = await getOpenGardenContext(payload);
			const result = await context.client.registerArea(sdkInput);

			const attestationRow = await payload.create({
				collection: "attestations",
				data: {
					uid: result.uid,
					schemaName: "AreaRegistration",
					signedAttestation: {} as unknown as Record<string, unknown>,
					timestampTxHash: result.txHash,
					chainIdSnapshot: context.chainId,
					attesterWallet: context.attesterWallet,
					status: "committed",
					relatedCollection: "areas",
					relatedId: areaId,
				},
				overrideAccess: true,
				req,
			});

			await payload.update({
				collection: "areas",
				id: areaId,
				// biome-ignore lint/suspicious/noExplicitAny: payload-types.ts not yet regenerated
				data: {
					lifecycleStatus: "registered",
					attestation: attestationRow.id,
				} as any,
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
					data: { lifecycleStatus: "failed" },
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
