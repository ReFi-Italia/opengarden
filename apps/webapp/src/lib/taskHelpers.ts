import type { TimestampedOffChainResult } from "@refi-italia/opengarden";
import type { PayloadRequest } from "payload";
import type { OpenGardenContext } from "../lib/openGardenClient";
import { serializeBigInts } from "../lib/serializeBigInts";
import type { Attestation } from "../payload-types";

type CreateAttestationData = {
	uid: string;
	schemaName: Attestation["schemaName"];
	signedAttestation: Record<string, unknown>;
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
		timestampTxHash: result.timestampTxHash,
		onchainTimestamp: Number(result.onchainTimestamp),
		chainIdSnapshot: context.chainId,
		attesterWallet: context.attesterWallet,
		relatedCollection: "interventions",
		relatedId: interventionId,
	});
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
		throw new Error(`${ctx} area has no on-chain UID. Register the area first.`);
	return (att as { uid: string }).uid;
}

export function extractCommissionId(intervention: unknown): string | null {
	const sponsor = (
		intervention as { commissioning?: { sponsor?: unknown } }
	)?.commissioning?.sponsor;
	if (
		typeof sponsor !== "object" ||
		sponsor === null ||
		(sponsor as { kind?: string }).kind === "volunteer" ||
		typeof (sponsor as { canonicalJson?: unknown }).canonicalJson !== "string" ||
		(sponsor as { canonicalJson: string }).canonicalJson.length === 0
	)
		return null;
	return (sponsor as { canonicalJson: string }).canonicalJson;
}

export async function failInterventionAndRethrow(
	req: PayloadRequest,
	interventionId: string,
	failedFrom: string,
	taskSlug: string,
	err: unknown,
): Promise<never> {
	const message = err instanceof Error ? err.message : String(err);
	await req.payload
		.update({
			collection: "interventions",
			id: interventionId,
			data: {
				lifecycleStatus: "failed",
				revocation: { failedFrom: failedFrom as "draft" },
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
