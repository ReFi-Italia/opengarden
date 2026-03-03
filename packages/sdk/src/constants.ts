import type { ChainConfig } from './types/config';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000';

export const CELO_MAINNET: ChainConfig = {
  chainId: 42220n,
  easAddress: '0x72E1d8ccf5299fb36fEfD8CC4394B8ef7e98Af92',
  schemaRegistryAddress: '0x5ece93bE4BDCF293Ed61FA78698B594F2135AF34',
};

// Note: EAS is not officially deployed on Alfajores.
// These addresses are placeholders — deploy EAS contracts manually for testnet use.
export const CELO_ALFAJORES: ChainConfig = {
  chainId: 44787n,
  easAddress: '',
  schemaRegistryAddress: '',
};

// OP Stack chains share predeploy addresses
const OP_STACK_EAS = '0x4200000000000000000000000000000000000021';
const OP_STACK_SCHEMA_REGISTRY = '0x4200000000000000000000000000000000000020';

export const OPTIMISM_MAINNET: ChainConfig = {
  chainId: 10n,
  easAddress: OP_STACK_EAS,
  schemaRegistryAddress: OP_STACK_SCHEMA_REGISTRY,
};

export const OPTIMISM_SEPOLIA: ChainConfig = {
  chainId: 11155420n,
  easAddress: OP_STACK_EAS,
  schemaRegistryAddress: OP_STACK_SCHEMA_REGISTRY,
};

export const BASE_MAINNET: ChainConfig = {
  chainId: 8453n,
  easAddress: OP_STACK_EAS,
  schemaRegistryAddress: OP_STACK_SCHEMA_REGISTRY,
};

export const BASE_SEPOLIA: ChainConfig = {
  chainId: 84532n,
  easAddress: OP_STACK_EAS,
  schemaRegistryAddress: OP_STACK_SCHEMA_REGISTRY,
};
