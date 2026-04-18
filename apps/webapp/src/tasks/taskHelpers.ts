import type { PayloadRequest } from "payload";
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
