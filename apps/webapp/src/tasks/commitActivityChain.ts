import {
	type GardenerCheckinInput,
	type GardenerCheckoutInput,
	type GardenerReportInput,
	type HealthcheckInput,
	ZERO_BYTES32,
} from "@refi-italia/opengarden";
import type { Payload, PayloadRequest, TaskConfig } from "payload";

import type { ActivityType } from "../collections/Activities";
import {
	getOpenGardenContext,
	type OpenGardenContext,
} from "../lib/openGardenClient";
import { serializeBigInts } from "../lib/serializeBigInts";

type CommitActivityChainInput = {
	/** Payload document id of the `activities` row to commit on-chain. */
	activityId: string;
};

type CommitActivityChainOutput = {
	chainUID: string;
	attestationId: string;
};

/**
 * Unified chain-commit task for all activity types. Dispatches to the
 * appropriate SDK method based on `activity.type`, writes the signed
 * off-chain attestation into the `attestations` collection, and sets
 * `activity.attestation` to the new row so future lookups go through
 * one relationship instead of the four per-type inline chain groups
 * we used to maintain.
 *
 * Idempotent: if `activity.attestation` already points at a committed
 * row, short-circuit.
 *
 * Preconditions by type:
 * - `checkin` — parent intervention must have `scheduling.chain.chainUID`
 * - `checkout` — `parentActivity` (the checkin) must have a committed attestation
 * - `report` — `parentActivity` (the checkout) must have a committed attestation
 * - `interventionHealthcheck` — parent intervention must have an area with a registration chain UID
 * - `areaHealthcheck` — parent area must have a registration chain UID
 */
export const commitActivityChainTask: TaskConfig<{
	input: CommitActivityChainInput;
	output: CommitActivityChainOutput;
}> = {
	slug: "commitActivityChain",
	label: "Commit activity attestation on-chain",
	retries: {
		attempts: 3,
		backoff: { type: "exponential", delay: 5_000 },
	},
	inputSchema: [
		{ name: "activityId", type: "text", required: true },
	],
	outputSchema: [
		{ name: "chainUID", type: "text", required: true },
		{ name: "attestationId", type: "text", required: true },
	],
	handler: async ({ input, req }) => {
		const { payload } = req;
		const { activityId } = input;

		const activity = await payload.findByID({
			collection: "activities",
			id: activityId,
			depth: 3,
			req,
			overrideAccess: true,
		});

		const type = activity.type as ActivityType;

		// Idempotency short-circuit
		const existingAttestation = activity.attestation;
		if (existingAttestation && typeof existingAttestation === "object") {
			const existingUid = (existingAttestation as { uid?: string }).uid;
			const existingStatus = (existingAttestation as { status?: string })
				.status;
			if (existingUid && existingStatus === "committed") {
				return {
					output: {
						chainUID: existingUid,
						attestationId: String(
							(existingAttestation as { id: string | number }).id,
						),
					},
				};
			}
		}

		let context: OpenGardenContext | null = null;

		try {
			context = await getOpenGardenContext(payload);
			const photoHash = await resolvePhotoHash(activity.photo, payload, req);

			const { result, schemaName } = await dispatchSdkCall(
				type,
				activity,
				context,
				photoHash,
			);

			// Persist the signed attestation as its own row
			const attestationRow = await payload.create({
				collection: "attestations",
				data: {
					uid: result.uid,
					schemaName,
					signedAttestation: serializeBigInts(
						result.signedAttestation,
					) as unknown as Record<string, unknown>,
					timestampTxHash: result.timestampTxHash,
					onchainTimestamp: Number(result.onchainTimestamp),
					chainIdSnapshot: context.chainId,
					attesterWallet: context.attesterWallet,
					status: "committed",
					relatedCollection: "activities",
					relatedId: activityId,
				},
				overrideAccess: true,
				req,
			});

			// Link the activity to its attestation + snapshot the photoHash
			await payload.update({
				collection: "activities",
				id: activityId,
				data: {
					attestation: attestationRow.id,
					photoHash,
				},
				overrideAccess: true,
				req,
			});

			return {
				output: {
					chainUID: result.uid,
					attestationId: String(attestationRow.id),
				},
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			// Record the failure so operators can see why it didn't land
			try {
				const failureRow = await payload.create({
					collection: "attestations",
					data: {
						uid: `failed-${activityId}-${Date.now()}`,
						schemaName: schemaNameFor(type),
						signedAttestation: {} as unknown as Record<string, unknown>,
						status: "failed",
						error: message,
						chainIdSnapshot: context?.chainId,
						attesterWallet: context?.attesterWallet,
						relatedCollection: "activities",
						relatedId: activityId,
					},
					overrideAccess: true,
					req,
				});
				await payload.update({
					collection: "activities",
					id: activityId,
					data: { attestation: failureRow.id },
					overrideAccess: true,
					req,
				});
			} catch (writeErr) {
				payload.logger.error({
					msg: "commitActivityChain: failed to persist failure row",
					writeErr:
						writeErr instanceof Error ? writeErr.message : String(writeErr),
				});
			}
			throw err;
		}
	},
};

// ─── helpers ─────────────────────────────────────────────────────────

async function resolvePhotoHash(
	photo: unknown,
	payload: Payload,
	req: PayloadRequest,
): Promise<string> {
	if (!photo) return "";
	if (
		typeof photo === "object" &&
		photo !== null &&
		"storageHash" in photo &&
		typeof (photo as { storageHash?: unknown }).storageHash === "string"
	) {
		return (photo as { storageHash: string }).storageHash;
	}
	const photoId = typeof photo === "object" && photo !== null
		? (photo as { id?: string | number }).id
		: photo;
	if (photoId === undefined || photoId === null) return "";
	const media = await payload
		.findByID({
			collection: "media",
			id: photoId as string | number,
			depth: 0,
			req,
			overrideAccess: true,
		})
		.catch(() => null);
	return (media as { storageHash?: string } | null)?.storageHash ?? "";
}

function schemaNameFor(type: ActivityType): string {
	switch (type) {
		case "checkin":
			return "GardenerCheckin";
		case "checkout":
			return "GardenerCheckout";
		case "report":
			return "GardenerReport";
		case "interventionHealthcheck":
		case "areaHealthcheck":
			return "Healthcheck";
	}
}

type SdkResult = {
	result: {
		uid: string;
		timestampTxHash: string;
		onchainTimestamp: number | bigint;
		signedAttestation: unknown;
	};
	schemaName: string;
};

async function dispatchSdkCall(
	type: ActivityType,
	activity: Record<string, unknown>,
	context: OpenGardenContext,
	photoHash: string,
): Promise<SdkResult> {
	const claimedTimestamp = activity.claimedTimestamp;
	if (!claimedTimestamp || typeof claimedTimestamp !== "string") {
		throw new Error("Activity is missing claimedTimestamp.");
	}
	const timestamp = new Date(claimedTimestamp);

	switch (type) {
		case "checkin": {
			const intervention = activity.intervention;
			if (typeof intervention !== "object" || intervention === null) {
				throw new Error("Checkin activity has no resolved intervention.");
			}
			const interventionUID = (
				intervention as { scheduling?: { chainUID?: string } }
			).scheduling?.chainUID;
			if (!interventionUID) {
				throw new Error(
					`Intervention ${(intervention as { id: string }).id} has no scheduling.chainUID; schedule it first.`,
				);
			}
			if (
				typeof activity.latitude !== "number" ||
				typeof activity.longitude !== "number"
			) {
				throw new Error("Checkin is missing latitude/longitude.");
			}
			const sdkInput: GardenerCheckinInput = {
				interventionUID,
				latitude: activity.latitude,
				longitude: activity.longitude,
				timestamp,
				photoHash,
			};
			const result = await context.client.checkin(sdkInput);
			return { result, schemaName: "GardenerCheckin" };
		}

		case "checkout": {
			const parent = activity.parentActivity;
			if (typeof parent !== "object" || parent === null) {
				throw new Error("Checkout activity has no resolved parent checkin.");
			}
			const parentAttestation = (parent as { attestation?: unknown })
				.attestation;
			if (
				typeof parentAttestation !== "object" ||
				parentAttestation === null
			) {
				throw new Error(
					"Checkout's parent checkin has no attestation row yet. Wait for the checkin task to drain before recording the checkout.",
				);
			}
			const checkinUID = (parentAttestation as { uid?: string }).uid;
			if (!checkinUID) {
				throw new Error("Parent checkin attestation has no uid.");
			}
			if (typeof activity.actualMinutes !== "number") {
				throw new Error("Checkout is missing actualMinutes.");
			}
			const sdkInput: GardenerCheckoutInput = {
				checkinUID,
				timestamp,
				actualMinutes: activity.actualMinutes,
			};
			const result = await context.client.checkout(sdkInput);
			return { result, schemaName: "GardenerCheckout" };
		}

		case "report": {
			const intervention = activity.intervention;
			if (typeof intervention !== "object" || intervention === null) {
				throw new Error("Report activity has no resolved intervention.");
			}
			const interventionUID = (
				intervention as { scheduling?: { chainUID?: string } }
			).scheduling?.chainUID;
			if (!interventionUID) {
				throw new Error("Intervention has no scheduling.chainUID.");
			}
			const parent = activity.parentActivity;
			if (typeof parent !== "object" || parent === null) {
				throw new Error("Report activity has no resolved parent checkout.");
			}
			const parentAttestation = (parent as { attestation?: unknown })
				.attestation;
			const checkoutUID =
				typeof parentAttestation === "object" && parentAttestation !== null
					? (parentAttestation as { uid?: string }).uid
					: undefined;
			if (!checkoutUID) {
				throw new Error(
					"Report's parent checkout has no attestation uid yet.",
				);
			}
			const sdkInput: GardenerReportInput = {
				interventionUID,
				checkoutUID,
				tasksCompleted: String(activity.tasksCompleted ?? ""),
				taskCount: Number(activity.taskCount ?? 0),
				photosHash: photoHash,
				notes: String(activity.notes ?? ""),
			};
			const result = await context.client.submitReport(sdkInput);
			return { result, schemaName: "GardenerReport" };
		}

		case "interventionHealthcheck":
		case "areaHealthcheck": {
			const area =
				type === "areaHealthcheck"
					? activity.area
					: (activity.intervention as { area?: unknown } | undefined)?.area;
			if (typeof area !== "object" || area === null) {
				throw new Error(`${type} activity has no resolved area.`);
			}
			const areaUID = (area as { chain?: { chainUID?: string } }).chain
				?.chainUID;
			if (!areaUID) {
				throw new Error("Area has no chain.chainUID; register it first.");
			}
			if (typeof activity.healthScore !== "number") {
				throw new Error("Healthcheck is missing healthScore.");
			}
			const intervention =
				type === "interventionHealthcheck" ? activity.intervention : undefined;
			const interventionUID =
				(typeof intervention === "object" && intervention !== null
					? (intervention as { scheduling?: { chainUID?: string } }).scheduling
							?.chainUID
					: undefined) ?? ZERO_BYTES32;

			const assessor = activity.assessor;
			const assessorId =
				typeof assessor === "object" &&
				assessor !== null &&
				typeof (assessor as { staffId?: unknown }).staffId === "string"
					? ((assessor as { staffId: string }).staffId)
					: null;

			const sdkInput: HealthcheckInput = {
				interventionUID,
				healthScore: activity.healthScore,
				photoHash,
				assessorId,
				metadataHash: (activity as { metadataHash?: string | null }).metadataHash ?? null,
			};
			const result = await context.client.recordHealthcheck(areaUID, sdkInput);
			return { result, schemaName: "Healthcheck" };
		}
	}
}
