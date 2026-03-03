import type { Signer, Provider } from 'ethers';
import type { SchemaName } from './enums';

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
  indexOffchain?: boolean;
}
