import type { GardenerCheckinInput } from "@refi-italia/opengarden";
import type { TaskConfig } from "payload";

import {
	getOpenGardenContext,
	type OpenGardenContext,
} from "../lib/openGardenClient";
import { recordChainTransaction } from "../lib/recordChainTransaction";
import { serializeBigInts } from "../lib/serializeBigInts";

type GardenerCheckinTaskInput = {
	/** Payload document id of the `gardenerCheckins` row to commit on-chain. */
	checkinId: string;
};

type GardenerCheckinTaskOutput = {
	chainUID: string;
	timestampTxHash: string;
};

/**
 * Task that commits a freshly-created `gardenerCheckins` row's attestation
 * on-chain via `OpenGardenClient.checkin` and populates the `chain.*`
 * mirror on the row. Triggered by the GardenerCheckins collection's
 * `afterChange` hook on creation.
 *
 * Preconditions (the form must have set):
 * - `intervention` (relationship) — the parent intervention
 * - `gardener` (relationship) — must be a member of the intervention's crew
 * - `latitude`, `longitude` — operator-recorded location
 * - `claimedTimestamp` — when the gardener arrived
 * - Optionally `photo` — uploaded media (its `storageHash` will be mirrored
 *   into `photoHash` so the on-chain attestation references it)
 *
 * The parent intervention must already have `scheduling.chainUID` (i.e. it
 * was scheduled on-chain) — the checkin attestation refers back to it.
 */
export const gardenerCheckinTask: TaskConfig<{
	input: GardenerCheckinTaskInput;
	output: GardenerCheckinTaskOutput;
}> = {
	slug: "gardenerCheckin",
	label: "Commit Gardener Checkin on-chain",
	retries: {
		attempts: 3,
		backoff: { type: "exponential", delay: 5_000 },
	},
	inputSchema: [
		{
			name: "checkinId",
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
		const { checkinId } = input;

		const checkin = await payload.findByID({
			collection: "gardenerCheckins",
			id: checkinId,
			depth: 2,
			req,
			overrideAccess: true,
		});

		// Idempotency: already committed → short-circuit
		if (checkin.chain?.chainUID) {
			return {
				output: {
					chainUID: checkin.chain.chainUID,
					timestampTxHash: checkin.chain.txHash ?? "",
				},
			};
		}

		const intervention = checkin.intervention;
		if (typeof intervention !== "object" || intervention === null) {
			throw new Error(
				`Checkin ${checkinId} → intervention could not be resolved; re-load with depth.`,
			);
		}

		const interventionUID = intervention.scheduling?.chainUID;
		if (!interventionUID) {
			throw new Error(
				`Checkin ${checkinId} → parent intervention ${intervention.id} has no scheduling.chainUID; schedule it first.`,
			);
		}

		if (
			typeof checkin.latitude !== "number" ||
			typeof checkin.longitude !== "number"
		) {
			throw new Error(
				`Checkin ${checkinId} is missing latitude/longitude.`,
			);
		}
		if (!checkin.claimedTimestamp) {
			throw new Error(`Checkin ${checkinId} is missing claimedTimestamp.`);
		}

		// Resolve the photo hash. If a photo is attached, mirror its
		// storageHash; otherwise fall back to the empty hash so the SDK
		// schema accepts it.
		let photoHash = "";
		const photo = checkin.photo;
		if (photo) {
			const photoDoc =
				typeof photo === "object" && photo !== null && "storageHash" in photo
					? (photo as { storageHash?: string })
					: await payload.findByID({
							collection: "media",
							id: typeof photo === "object" ? photo.id : photo,
							depth: 0,
							req,
							overrideAccess: true,
						});
			photoHash =
				(photoDoc as { storageHash?: string })?.storageHash ?? "";
		}

		const sdkInput: GardenerCheckinInput = {
			interventionUID,
			latitude: checkin.latitude,
			longitude: checkin.longitude,
			timestamp: new Date(checkin.claimedTimestamp),
			photoHash,
		};

		let context: OpenGardenContext | null = null;
		try {
			context = await getOpenGardenContext(payload);
			const result = await context.client.checkin(sdkInput);

			await payload.update({
				collection: "gardenerCheckins",
				id: checkinId,
				data: {
					photoHash,
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
				kind: "gardenerCheckin",
				relatedCollection: "gardenerCheckins",
				relatedId: checkinId,
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
				kind: "gardenerCheckin",
				relatedCollection: "gardenerCheckins",
				relatedId: checkinId,
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
