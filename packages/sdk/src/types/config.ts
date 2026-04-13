import type {
	EAS,
	SchemaRegistry,
} from "@ethereum-attestation-service/eas-sdk";
import type { Provider, Signer } from "ethers";
import type { ChainName } from "../constants";
import type { SchemaName } from "./enums";

export interface ChainConfig {
	chainId: bigint;
	easAddress: string;
	schemaRegistryAddress: string;
	/**
	 * Canonical schema UIDs registered and named on this chain by the
	 * OpenGarden operator of record. Populated for chains where the register
	 * + name flow has been completed; `undefined` for chains where consumers
	 * must deploy schemas themselves. Explicit `OpenGardenConfig.schemaUIDs`
	 * overrides still win over these defaults.
	 */
	schemaUIDs?: Partial<SchemaUIDs>;
}

export interface StorageAdapter {
	upload(data: Uint8Array | string): Promise<string>;
	download(hash: string): Promise<Uint8Array>;
}

export type SchemaUIDs = Record<SchemaName, string>;

export interface OpenGardenConfig {
	/** Connected EAS instance. Use `createOpenGardenClient` to wire this and `registry` automatically. */
	eas: EAS;
	/** Connected SchemaRegistry instance. Paired with `eas`. */
	registry: SchemaRegistry;
	signer: Signer;
	provider?: Provider;
	/**
	 * Either a known chain name (resolved internally via `CHAIN_CONFIGS`) or a
	 * full `ChainConfig` object for custom / unsupported deployments.
	 */
	chain: ChainName | ChainConfig;
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
