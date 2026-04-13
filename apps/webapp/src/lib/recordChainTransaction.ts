import type { Payload, PayloadRequest } from "payload";

import type { ChainTransaction } from "../payload-types";

export type ChainTransactionKind = ChainTransaction["kind"];
export type ChainTransactionStatus = ChainTransaction["status"];

type ChainTransactionJson = ChainTransaction["payloadJson"];

export type RecordChainTransactionArgs = {
	payload: Payload;
	req?: PayloadRequest;
	kind: ChainTransactionKind;
	relatedCollection: string;
	relatedId: string | number;
	status: ChainTransactionStatus;
	txHash?: string | null;
	chainUID?: string | null;
	chainId?: number | null;
	attesterWallet?: string | null;
	error?: string | null;
	payloadJson?: unknown;
	resultJson?: unknown;
};

/**
 * Append-only writer for the `chainTransactions` audit log. The collection
 * rejects all create access from regular users — only handlers running with
 * `overrideAccess: true` can write. Every SDK-calling task handler is
 * expected to call this exactly once per attempt (success or failure) so the
 * log stays a faithful mirror of every chain interaction.
 */
export async function recordChainTransaction(args: RecordChainTransactionArgs) {
	const {
		payload,
		req,
		kind,
		relatedCollection,
		relatedId,
		status,
		txHash,
		chainUID,
		chainId,
		attesterWallet,
		error,
		payloadJson,
		resultJson,
	} = args;

	return payload.create({
		collection: "chainTransactions",
		data: {
			kind,
			relatedCollection,
			relatedId: String(relatedId),
			status,
			txHash: txHash ?? undefined,
			chainUID: chainUID ?? undefined,
			chainId: chainId ?? undefined,
			attesterWallet: attesterWallet ?? undefined,
			error: error ?? undefined,
			payloadJson: payloadJson as ChainTransactionJson,
			resultJson: resultJson as ChainTransactionJson,
		},
		overrideAccess: true,
		req,
	});
}
