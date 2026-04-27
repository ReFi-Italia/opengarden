import {
	type CheckinActivityInput,
	type CheckoutActivityInput,
	type HealthcheckActivityInput,
	type ReportActivityInput,
	ZERO_BYTES32,
} from "@refi-italia/opengarden";
import type { Payload, PayloadRequest, TaskConfig } from "payload";

import type { ActivityType } from "../collections/Activities";
import {
	getOpenGardenContext,
	type OpenGardenContext,
} from "../lib/openGardenClient";
import { serializeBigInts } from "../lib/serializeBigInts";
import { createAttestationRecord } from "../lib/taskHelpers";

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
 * `activity.attestation` to the new row.
 *
 * Idempotent: if `activity.attestation` already points at a committed
 * row, short-circuit.
 *
 * Spec §3.1: every off-chain Activity is EIP-712 signed and its UID is
 * timestamped on-chain via `EAS.timestamp(uid)`. Pairing (checkin/checkout/
 * report per crew member) is resolved by `(signer, refUID=keccak256(interventionId),
 * type)` at bundle-read time — no `parentActivity` wiring required here.
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
	inputSchema: [{ name: "activityId", type: "text", required: true }],
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
			const mediaHash = await resolveMediaHash(activity.media, payload, req);

			const result = await dispatchSdkCall(
				type,
				activity as unknown as Record<string, unknown>,
				context,
				mediaHash,
			);

			// Persist the signed attestation as its own row. All off-chain
			// Activity types share the single EAS `Activity` schema per spec §3.1.
			// The `payload` field carries the SDK-normalized plaintext so
			// finalizeIntervention can rehydrate a TimestampedOffChainResult
			// from DB rows without re-hitting the SDK.
			const attestationRow = await createAttestationRecord(req, {
				uid: result.uid,
				schemaName: "Activity",
				signedAttestation: serializeBigInts(
					result.signedAttestation,
				) as unknown as Record<string, unknown>,
				payload: result.payload,
				timestampTxHash: result.timestampTxHash,
				onchainTimestamp: Number(result.onchainTimestamp),
				chainIdSnapshot: context.chainId,
				attesterWallet: result.attester ?? context.attesterWallet,
				relatedCollection: "activities",
				relatedId: activityId,
			});

			// Link the activity to its attestation and sync the SDK-normalized
			// payload back onto activity.data (source of truth for reads).
			await payload.update({
				collection: "activities",
				id: activityId,
				data: {
					attestation: attestationRow.id,
					data: result.payload as Record<string, unknown>,
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
						schemaName: "Activity",
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

async function resolveMediaHash(
	media: unknown,
	payload: Payload,
	req: PayloadRequest,
): Promise<string> {
	if (!media) return ZERO_BYTES32;
	if (
		typeof media === "object" &&
		media !== null &&
		"storageHash" in media &&
		typeof (media as { storageHash?: unknown }).storageHash === "string"
	) {
		return (media as { storageHash: string }).storageHash;
	}
	const mediaId =
		typeof media === "object" && media !== null
			? (media as { id?: string | number }).id
			: media;
	if (mediaId === undefined || mediaId === null) return ZERO_BYTES32;
	const row = await payload
		.findByID({
			collection: "media",
			id: mediaId as string | number,
			depth: 0,
			req,
			overrideAccess: true,
		})
		.catch(() => null);
	return (row as { storageHash?: string } | null)?.storageHash ?? ZERO_BYTES32;
}

type SdkResult = {
	uid: string;
	attester?: string;
	payload: Record<string, unknown>;
	timestampTxHash: string;
	onchainTimestamp: number | bigint;
	signedAttestation: unknown;
};

function requireInterventionId(intervention: unknown): string {
	if (typeof intervention !== "object" || intervention === null) {
		throw new Error("Activity has no resolved intervention.");
	}
	const id = (intervention as { interventionId?: unknown }).interventionId;
	if (typeof id !== "string" || !id) {
		throw new Error("Intervention is missing interventionId.");
	}
	return id;
}

async function dispatchSdkCall(
	type: ActivityType,
	activity: Record<string, unknown>,
	context: OpenGardenContext,
	mediaHash: string,
): Promise<SdkResult> {
	const claimedTimestamp = activity.claimedTimestamp;
	if (!claimedTimestamp || typeof claimedTimestamp !== "string") {
		throw new Error("Activity is missing claimedTimestamp.");
	}
	const time = new Date(claimedTimestamp);
	const data = (activity.data ?? {}) as Record<string, unknown>;

	switch (type) {
		case "schedule":
			// FIXME (spec-refactor): schedule activities are created by
			// `tasks/scheduleIntervention.ts` which calls the SDK directly.
			// This branch should not be reachable — a schedule row is written
			// with its attestation already linked. Throwing makes the bug loud
			// if the scheduling task ever queues this one by mistake.
			throw new Error(
				"commitActivityChain must not be queued for schedule activities — the scheduleIntervention task owns that SDK call.",
			);

		case "checkin": {
			const interventionId = requireInterventionId(activity.intervention);
			const sdkInput: CheckinActivityInput = {
				interventionId,
				time,
				...(typeof data.latitude === "number" &&
				typeof data.longitude === "number"
					? { latitude: data.latitude, longitude: data.longitude }
					: {}),
			};
			return await context.client.checkin(sdkInput);
		}

		case "checkout": {
			const interventionId = requireInterventionId(activity.intervention);
			const sdkInput: CheckoutActivityInput = {
				interventionId,
				time,
				...(typeof data.latitude === "number" &&
				typeof data.longitude === "number"
					? { latitude: data.latitude, longitude: data.longitude }
					: {}),
			};
			return await context.client.checkout(sdkInput);
		}

		case "report": {
			const interventionId = requireInterventionId(activity.intervention);
			if (!Array.isArray(data.tasksCompleted)) {
				throw new Error("Report is missing data.tasksCompleted.");
			}
			if (typeof data.reportedEffort !== "number") {
				throw new Error("Report is missing data.reportedEffort.");
			}
			const sdkInput: ReportActivityInput = {
				interventionId,
				time,
				tasksCompleted: data.tasksCompleted as string[],
				reportedEffort: data.reportedEffort,
				mediaHash,
				notes: typeof data.notes === "string" ? data.notes : "",
			};
			return await context.client.submitReport(sdkInput);
		}

		case "healthcheck": {
			const area =
				activity.area && typeof activity.area === "object"
					? activity.area
					: null;
			if (!area) {
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

			const sdkInput: HealthcheckActivityInput = {
				areaUID,
				time,
				healthScore: data.healthScore,
				mediaHash,
				notes: typeof data.notes === "string" ? data.notes : "",
				metadata:
					data.metadata && typeof data.metadata === "object"
						? (data.metadata as Record<string, unknown>)
						: null,
			};
			return await context.client.recordHealthcheck(sdkInput);
		}
	}
}
