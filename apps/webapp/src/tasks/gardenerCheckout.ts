import type { GardenerCheckoutInput } from "@refi-italia/opengarden";
import type { TaskConfig } from "payload";

import {
	getOpenGardenContext,
	type OpenGardenContext,
} from "../lib/openGardenClient";
import { recordChainTransaction } from "../lib/recordChainTransaction";
import { serializeBigInts } from "../lib/serializeBigInts";

type GardenerCheckoutTaskInput = {
	/** Payload document id of the `gardenerCheckouts` row to commit on-chain. */
	checkoutId: string;
};

type GardenerCheckoutTaskOutput = {
	chainUID: string;
	timestampTxHash: string;
};

/**
 * Task that commits a freshly-created `gardenerCheckouts` row's attestation
 * on-chain via `OpenGardenClient.checkout` and populates the `chain.*`
 * mirror on the row. Triggered by the GardenerCheckouts collection's
 * `afterChange` hook on creation.
 *
 * Preconditions:
 * - `checkin` (relationship) — must resolve to a gardenerCheckins row with
 *   `chain.chainUID` already populated (i.e. its own attestation has been
 *   committed via `gardenerCheckinTask`).
 * - `claimedTimestamp` — when the gardener left the site.
 * - `actualMinutes` — operator-entered duration of the work window.
 */
export const gardenerCheckoutTask: TaskConfig<{
	input: GardenerCheckoutTaskInput;
	output: GardenerCheckoutTaskOutput;
}> = {
	slug: "gardenerCheckout",
	label: "Commit Gardener Checkout on-chain",
	retries: {
		attempts: 3,
		backoff: { type: "exponential", delay: 5_000 },
	},
	inputSchema: [
		{
			name: "checkoutId",
			type: "text",
			required: true,
		},
	],
	outputSchema: [
		{ name: "chainUID", type: "text", required: true },
		{ name: "timestampTxHash", type: "text", required: true },
	],
	handler: async ({ input, req }) => {
		const { payload } = req;
		const { checkoutId } = input;

		const checkout = await payload.findByID({
			collection: "gardenerCheckouts",
			id: checkoutId,
			depth: 2,
			req,
			overrideAccess: true,
		});

		// Idempotency: already committed → short-circuit
		if (checkout.chain?.chainUID) {
			return {
				output: {
					chainUID: checkout.chain.chainUID,
					timestampTxHash: checkout.chain.txHash ?? "",
				},
			};
		}

		const checkin = checkout.checkin;
		if (typeof checkin !== "object" || checkin === null) {
			throw new Error(
				`Checkout ${checkoutId} → checkin could not be resolved; re-load with depth.`,
			);
		}

		const checkinUID = checkin.chain?.chainUID;
		if (!checkinUID) {
			throw new Error(
				`Checkout ${checkoutId} → parent checkin ${checkin.id} has no chain.chainUID; the checkin task hasn't committed yet.`,
			);
		}

		if (typeof checkout.actualMinutes !== "number") {
			throw new Error(`Checkout ${checkoutId} is missing actualMinutes.`);
		}
		if (!checkout.claimedTimestamp) {
			throw new Error(`Checkout ${checkoutId} is missing claimedTimestamp.`);
		}

		const sdkInput: GardenerCheckoutInput = {
			checkinUID,
			timestamp: new Date(checkout.claimedTimestamp),
			actualMinutes: checkout.actualMinutes,
		};

		let context: OpenGardenContext | null = null;
		try {
			context = await getOpenGardenContext(payload);
			const result = await context.client.checkout(sdkInput);

			await payload.update({
				collection: "gardenerCheckouts",
				id: checkoutId,
				data: {
					chain: {
						chainUID: result.uid,
						txHash: result.timestampTxHash,
						onchainTimestamp: Number(result.onchainTimestamp),
						attesterWallet: context.attesterWallet,
						chainIdSnapshot: context.chainId,
						signedAttestation: serializeBigInts(result.signedAttestation),
					},
				},
				overrideAccess: true,
				req,
			});

			await recordChainTransaction({
				payload,
				req,
				kind: "gardenerCheckout",
				relatedCollection: "gardenerCheckouts",
				relatedId: checkoutId,
				status: "success",
				txHash: result.timestampTxHash,
				chainUID: result.uid,
				chainId: context.chainId,
				attesterWallet: context.attesterWallet,
				payloadJson: { ...sdkInput, timestamp: String(sdkInput.timestamp) },
				resultJson: {
					uid: result.uid,
					timestampTxHash: result.timestampTxHash,
					onchainTimestamp: String(result.onchainTimestamp),
				},
			});

			return {
				output: {
					chainUID: result.uid,
					timestampTxHash: result.timestampTxHash,
				},
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);

			await recordChainTransaction({
				payload,
				req,
				kind: "gardenerCheckout",
				relatedCollection: "gardenerCheckouts",
				relatedId: checkoutId,
				status: "failed",
				error: message,
				chainId: context?.chainId,
				attesterWallet: context?.attesterWallet,
				payloadJson: { ...sdkInput, timestamp: String(sdkInput.timestamp) },
			}).catch(() => undefined);

			throw err;
		}
	},
};
