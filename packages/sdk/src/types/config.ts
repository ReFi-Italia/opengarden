import type { Provider, Signer } from "ethers";
import type { SchemaName } from "./enums";

export interface ChainConfig {
	chainId: bigint;
	easAddress: string;
	schemaRegistryAddress: string;
}

export interface StorageAdapter {
	upload(data: Uint8Array | string): Promise<string>;
	download(hash: string): Promise<Uint8Array>;
}

export type SchemaUIDs = Record<SchemaName, string>;

export interface OpenGardenConfig {
	signer: Signer;
	provider?: Provider;
	chain: ChainConfig;
	schemaUIDs?: Partial<SchemaUIDs>;
	storage?: StorageAdapter;
	/**
	 * Override the EAS GraphQL endpoint used for read queries. Defaults to the
	 * EASScan endpoint for the configured chain, or `undefined` if the chain
	 * has no known default.
	 */
	graphqlUrl?: string;
	/**
	 * Override the off-chain attestation store endpoint used by
	 * `indexBundleAttestations` / `submitToIndexer`. Defaults to the EASScan
	 * offchain store for the configured chain, or `undefined` if the chain
	 * has no known default.
	 */
	storeUrl?: string;
}
