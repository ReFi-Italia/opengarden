import type { TimestampedOffChainResult } from "@refi-italia/opengarden";
import type { PayloadRequest } from "payload";
import type { OpenGardenContext } from "../lib/openGardenClient";
import { serializeBigInts } from "../lib/serializeBigInts";
import type { Attestation } from "../payload-types";

type CreateAttestationData = {
	uid: string;
	schemaName: Attestation["schemaName"];
	signedAttestation: Record<string, unknown>;
	/** Plaintext payload — populated for Activity attestations so publish can rehydrate. */
	payload?: Record<string, unknown>;
	timestampTxHash: string;
	onchainTimestamp?: number;
	chainIdSnapshot?: number;
	attesterWallet: string;
	relatedCollection: string;
	relatedId: string;
};

export async function createAttestationRecord(
	req: PayloadRequest,
	data: CreateAttestationData,
): Promise<{ id: string }> {
	return req.payload.create({
		collection: "attestations",
		data: {
			uid: data.uid,
			schemaName: data.schemaName,
			signedAttestation: data.signedAttestation,
			...(data.payload !== undefined ? { payload: data.payload } : {}),
			timestampTxHash: data.timestampTxHash,
			...(data.onchainTimestamp !== undefined
				? { onchainTimestamp: data.onchainTimestamp }
				: {}),
			chainIdSnapshot: data.chainIdSnapshot,
			attesterWallet: data.attesterWallet,
			status: "committed",
			relatedCollection: data.relatedCollection,
			relatedId: data.relatedId,
		},
		overrideAccess: true,
		req,
	}) as Promise<{ id: string }>;
}

export async function createInterventionAttestation(
	req: PayloadRequest,
	context: OpenGardenContext,
	result: TimestampedOffChainResult,
	interventionId: string,
	schemaName: Attestation["schemaName"],
): Promise<{ id: string }> {
	return createAttestationRecord(req, {
		uid: result.uid,
		schemaName,
		signedAttestation: serializeBigInts(
			result.signedAttestation,
		) as unknown as Record<string, unknown>,
		payload: result.payload,
		timestampTxHash: result.timestampTxHash,
		onchainTimestamp: Number(result.onchainTimestamp),
		chainIdSnapshot: context.chainId,
		attesterWallet: result.attester ?? context.attesterWallet,
		relatedCollection: "interventions",
		relatedId: interventionId,
	});
}

/**
 * Rehydrates a `TimestampedOffChainResult` from a persisted attestations row
 * populated with its full payload + signedAttestation. The `timestampReceipt`
 * field is not persisted (not needed by buildEvidenceBundle / finalize flows).
 */
export function rehydrateTimestampedResult(
	attestation: unknown,
	activityType: TimestampedOffChainResult["type"],
): TimestampedOffChainResult {
	if (!attestation || typeof attestation !== "object") {
		throw new Error("Attestation is not an object.");
	}
	const a = attestation as Record<string, unknown>;
	if (typeof a.uid !== "string" || !a.uid) {
		throw new Error("Attestation is missing uid.");
	}
	if (!a.signedAttestation || typeof a.signedAttestation !== "object") {
		throw new Error(`Attestation ${a.uid} has no signedAttestation.`);
	}
	if (!a.payload || typeof a.payload !== "object") {
		throw new Error(
			`Attestation ${a.uid} has no payload — required for rehydration into TimestampedOffChainResult.`,
		);
	}
	if (typeof a.onchainTimestamp !== "number") {
		throw new Error(`Attestation ${a.uid} has no onchainTimestamp.`);
	}
	return {
		uid: a.uid,
		type: activityType,
		attester:
			typeof a.attesterWallet === "string" ? a.attesterWallet : "",
		payload: a.payload as Record<string, unknown>,
		signedAttestation: a.signedAttestation as Record<string, unknown>,
		timestampTxHash:
			typeof a.timestampTxHash === "string" ? a.timestampTxHash : "",
		onchainTimestamp: BigInt(a.onchainTimestamp),
		// biome-ignore lint/suspicious/noExplicitAny: receipt not persisted
		timestampReceipt: undefined as any,
	};
}

export function requireAreaUID(area: unknown, ctx: string): string {
	if (typeof area !== "object" || area === null)
		throw new Error(`${ctx} area could not be resolved.`);
	const att = (area as { attestation?: unknown }).attestation;
	if (
		typeof att !== "object" ||
		att === null ||
		typeof (att as { uid?: unknown }).uid !== "string"
	)
		throw new Error(
			`${ctx} area has no on-chain UID. Register the area first.`,
		);
	return (att as { uid: string }).uid;
}

export function extractCommissionId(intervention: unknown): string | null {
	const sponsor = (intervention as { commissioning?: { sponsor?: unknown } })
		?.commissioning?.sponsor;
	if (
		typeof sponsor !== "object" ||
		sponsor === null ||
		(sponsor as { kind?: string }).kind === "volunteer" ||
		typeof (sponsor as { canonicalJson?: unknown }).canonicalJson !==
			"string" ||
		(sponsor as { canonicalJson: string }).canonicalJson.length === 0
	)
		return null;
	return (sponsor as { canonicalJson: string }).canonicalJson;
}

export async function cancelInterventionAndRethrow(
	req: PayloadRequest,
	interventionId: string,
	cancelledFrom: string,
	taskSlug: string,
	err: unknown,
): Promise<never> {
	const message = err instanceof Error ? err.message : String(err);
	await req.payload
		.update({
			collection: "interventions",
			id: interventionId,
			data: {
				lifecycleStatus: "cancelled",
				cancellation: {
					cancelledFrom: cancelledFrom as "draft",
					cancelledAt: new Date().toISOString(),
					reason: `Task ${taskSlug} failed: ${message}`,
				},
			},
			overrideAccess: true,
			context: { skipLifecycleHooks: true },
			req,
		})
		.catch(() => undefined);
	req.payload.logger.error({
		msg: `${taskSlug} task failed for intervention ${interventionId}`,
		error: message,
	});
	throw err;
}
