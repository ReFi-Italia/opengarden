import type { TransactionReceipt } from "ethers";
import type { ActivityTypeName } from "./enums";

export interface OnChainAttestationResult {
	uid: string;
	txHash: string;
	receipt: TransactionReceipt;
}

export interface TimestampedOffChainResult {
	uid: string;
	/** Activity discriminator. */
	type: ActivityTypeName;
	/** Ethereum address of the wallet that signed this attestation. */
	attester: string;
	/** Plaintext payload — travels alongside the signed envelope into the evidence bundle. Shape depends on `type` (see spec §3.2). */
	payload: Record<string, unknown>;
	/** Full EIP-712 signed attestation from `Offchain.signOffchainAttestation`, with `signer` injected. */
	signedAttestation: Record<string, unknown>;
	timestampTxHash: string;
	onchainTimestamp: bigint;
	timestampReceipt: TransactionReceipt;
}

export interface SchemaRegistrationResult {
	name: string;
	uid: string;
	txHash: string;
}

export interface IndexerSubmissionResult {
	ok: boolean;
	/** Error description when `ok` is false (HTTP status + body, or thrown error message). */
	error?: string;
}

/** Role tag used by the indexer submission routine. Matches `ActivityTypeName` minus `unspecified`. */
export type BundleIndexingRole =
	| "schedule"
	| "checkin"
	| "checkout"
	| "report";

export interface BundleIndexingResult extends IndexerSubmissionResult {
	uid: string;
	role: BundleIndexingRole;
	/** 0-based index in the flat activities array. */
	activityIndex?: number;
}
