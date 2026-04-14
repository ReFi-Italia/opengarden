import type { AreaRegistrationInput, AreaType } from "@refi-italia/opengarden";
import type { TaskConfig } from "payload";

import {
	getOpenGardenContext,
	type OpenGardenContext,
} from "../lib/openGardenClient";
import { recordChainTransaction } from "../lib/recordChainTransaction";

type RegisterAreaInput = {
	/** Payload document id of the `areas` row to register on-chain. */
	areaId: number;
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
			type: "number",
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

		if (area.lifecycleStatus === "registered" && area.chain?.chainUID) {
			return {
				output: {
					chainUID: area.chain.chainUID,
					txHash: area.chain.txHash ?? "",
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

			await payload.update({
				collection: "areas",
				id: areaId,
				data: {
					lifecycleStatus: "registered",
					chain: {
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

			await recordChainTransaction({
				payload,
				req,
				kind: "registerArea",
				relatedCollection: "areas",
				relatedId: areaId,
				status: "success",
				txHash: result.txHash,
				chainUID: result.uid,
				chainId: context.chainId,
				attesterWallet: context.attesterWallet,
				payloadJson: sdkInput,
				resultJson: { uid: result.uid, txHash: result.txHash },
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

			await recordChainTransaction({
				payload,
				req,
				kind: "registerArea",
				relatedCollection: "areas",
				relatedId: areaId,
				status: "failed",
				error: message,
				chainId: context?.chainId,
				attesterWallet: context?.attesterWallet,
				payloadJson: sdkInput,
			}).catch(() => undefined);

			throw err;
		}
	},
};
