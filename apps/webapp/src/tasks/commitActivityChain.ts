import {
	type GardenerCheckinInput,
	type GardenerCheckoutInput,
	type GardenerReportInput,
	type HealthcheckInput,
	ZERO_BYTES32,
} from "@refi-italia/opengarden";
import type { Payload, PayloadRequest, TaskConfig } from "payload";

import type { ActivityType } from "../collections/Activities";
import { ATTESTATION_SCHEMAS } from "../collections/Attestations";
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
 * - `checkin` — parent intervention must have `scheduling.attestation.uid` (populated by scheduleIntervention task)
 * - `checkout` — `parentActivity` (the checkin) must have a committed attestation
 * - `report` — `parentActivity` (the checkout) must have a committed attestation
 * - `healthcheck` — parent area must have `attestation.uid` (populated by registerArea task)
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
				activity as unknown as Record<string, unknown>,
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

type AttestationSchemaName = (typeof ATTESTATION_SCHEMAS)[number];
function schemaNameFor(type: ActivityType): AttestationSchemaName {
	switch (type) {
		case "checkin":
			return "GardenerCheckin";
		case "checkout":
			return "GardenerCheckout";
		case "report":
			return "GardenerReport";
		case "healthcheck":
			return "Healthcheck";
	}
}

type SdkResult = {
	result: {
		uid: string;
		attester?: string;
		timestampTxHash: string;
		onchainTimestamp: number | bigint;
		signedAttestation: unknown;
	};
	schemaName: AttestationSchemaName;
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
	const data = (activity.data ?? {}) as Record<string, unknown>;

	switch (type) {
		case "checkin": {
			const intervention = activity.intervention;
			if (typeof intervention !== "object" || intervention === null) {
				throw new Error("Checkin activity has no resolved intervention.");
			}
			const schedAtt = (
				intervention as { scheduling?: { attestation?: unknown } }
			).scheduling?.attestation;
			const interventionUID =
				typeof schedAtt === "object" &&
				schedAtt !== null &&
				typeof (schedAtt as { uid?: unknown }).uid === "string"
					? (schedAtt as { uid: string }).uid
					: null;
			if (!interventionUID) {
				throw new Error(
					`Intervention ${(intervention as { id: string }).id} has no scheduling.attestation.uid; schedule it first.`,
				);
			}
			if (
				typeof data.latitude !== "number" ||
				typeof data.longitude !== "number"
			) {
				throw new Error("Checkin is missing data.latitude/data.longitude.");
			}
			const sdkInput: GardenerCheckinInput = {
				interventionUID,
				latitude: data.latitude,
				longitude: data.longitude,
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
			if (typeof data.actualMinutes !== "number") {
				throw new Error("Checkout is missing data.actualMinutes.");
			}
			const sdkInput: GardenerCheckoutInput = {
				checkinUID,
				timestamp,
				actualMinutes: data.actualMinutes,
			};
			const result = await context.client.checkout(sdkInput);
			return { result, schemaName: "GardenerCheckout" };
		}

		case "report": {
			const intervention = activity.intervention;
			if (typeof intervention !== "object" || intervention === null) {
				throw new Error("Report activity has no resolved intervention.");
			}
			const schedAtt2 = (
				intervention as { scheduling?: { attestation?: unknown } }
			).scheduling?.attestation;
			const interventionUID =
				typeof schedAtt2 === "object" &&
				schedAtt2 !== null &&
				typeof (schedAtt2 as { uid?: unknown }).uid === "string"
					? (schedAtt2 as { uid: string }).uid
					: null;
			if (!interventionUID) {
				throw new Error("Intervention has no scheduling.attestation.uid.");
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
				tasksCompleted: Array.isArray(data.completedTaskCodes)
					? (data.completedTaskCodes as string[]).join(",")
					: String(data.tasksCompleted ?? ""),
				taskCount: Array.isArray(data.completedTaskCodes)
					? (data.completedTaskCodes as string[]).length
					: Number(data.taskCount ?? 0),
				photosHash: photoHash,
				notes: String(data.notes ?? ""),
			};
			const result = await context.client.submitReport(sdkInput);
			return { result, schemaName: "GardenerReport" };
		}

		case "healthcheck": {
			const area =
				(activity.area && typeof activity.area === "object")
					? activity.area
					: (activity.intervention as { area?: unknown } | undefined)?.area;
			if (typeof area !== "object" || area === null) {
				throw new Error("Healthcheck activity has no resolved area.");
			}
			const areaAtt = (area as { attestation?: unknown }).attestation;
			const areaUID =
				typeof areaAtt === "object" &&
				areaAtt !== null &&
				typeof (areaAtt as { uid?: unknown }).uid === "string"
					? (areaAtt as { uid: string }).uid
					: null;
			if (!areaUID) {
				throw new Error("Area has no attestation.uid; register it first.");
			}
			if (typeof data.healthScore !== "number") {
				throw new Error("Healthcheck is missing data.healthScore.");
			}

			const intervention = activity.intervention;
			const schedAtt =
				typeof intervention === "object" && intervention !== null
					? (intervention as { scheduling?: { attestation?: unknown } }).scheduling
							?.attestation
					: undefined;
			const interventionUID =
				(typeof schedAtt === "object" &&
				schedAtt !== null &&
				typeof (schedAtt as { uid?: unknown }).uid === "string"
					? (schedAtt as { uid: string }).uid
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
				healthScore: data.healthScore,
				photoHash,
				assessorId,
				metadataHash: (data.metadataHash as string | null) ?? null,
			};
			const result = await context.client.recordHealthcheck(areaUID, sdkInput);
			return { result, schemaName: "Healthcheck" };
		}
	}
}
