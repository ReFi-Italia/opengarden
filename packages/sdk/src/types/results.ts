import type { TransactionReceipt } from "ethers";

export interface OnChainAttestationResult {
	uid: string;
	txHash: string;
	receipt: TransactionReceipt;
}

export interface TimestampedOffChainResult {
	uid: string;
	/** Ethereum address of the wallet that signed this attestation. May be absent when only `signedAttestation.message.attester` is available. */
	attester?: string;
	signedAttestation: Record<string, unknown>;
	timestampTxHash: string;
	onchainTimestamp: bigint;
	timestampReceipt: TransactionReceipt;
}

export interface OffChainAttestationResult {
	uid: string;
	signedAttestation: Record<string, unknown>;
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

export type BundleIndexingRole =
	| "scheduled"
	| "checkin"
	| "checkout"
	| "report"
	| "validation"
	| "healthcheck";

export interface BundleIndexingResult extends IndexerSubmissionResult {
	uid: string;
	role: BundleIndexingRole;
	/** 0-based crew member index for per-member roles (`checkin` / `checkout` / `report`). */
	crewIndex?: number;
}
