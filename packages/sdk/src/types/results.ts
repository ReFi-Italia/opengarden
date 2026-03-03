import type { TransactionReceipt } from 'ethers';

export interface OnChainAttestationResult {
  uid: string;
  txHash: string;
  receipt: TransactionReceipt;
}

export interface TimestampedOffChainResult {
  uid: string;
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
