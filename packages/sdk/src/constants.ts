import schemasJson from "./chains/schemas.json";
import type { ChainConfig, SchemaUIDs } from "./types/config";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const ZERO_BYTES32 =
	"0x0000000000000000000000000000000000000000000000000000000000000000";

export const EVIDENCE_BUNDLE_VERSION = "0.1.0" as const;

// Well-known EAS schema for naming schemas: "bytes32 schemaId, string name"
// See https://docs.attest.org/docs/tutorials/naming-your-schema
export const SCHEMA_NAME_UID =
	"0x44d562ac1d7cd77e232978687fea027ace48f719cf1d58c7888e509663bb87fc";

/**
 * Canonical schema UIDs per chain, loaded from `chains/schemas.json`. The
 * JSON file is the source of truth — `scripts/register-schemas.ts` writes
 * into it after a successful register + name round, and consumers read it
 * through `ChainConfig.schemaUIDs`.
 */
const SCHEMAS_BY_CHAIN = schemasJson as Partial<
	Record<string, Partial<SchemaUIDs>>
>;

export const CELO_MAINNET: ChainConfig = {
	chainId: 42220n,
	easAddress: "0x72E1d8ccf5299fb36fEfD8CC4394B8ef7e98Af92",
	schemaRegistryAddress: "0x5ece93bE4BDCF293Ed61FA78698B594F2135AF34",
	schemaUIDs: SCHEMAS_BY_CHAIN["celo-mainnet"],
};

// Note: EAS is not officially deployed on Alfajores.
// These addresses are placeholders — deploy EAS contracts manually for testnet use.
export const CELO_ALFAJORES: ChainConfig = {
	chainId: 44787n,
	easAddress: "",
	schemaRegistryAddress: "",
	schemaUIDs: SCHEMAS_BY_CHAIN["celo-alfajores"],
};

// OP Stack chains share predeploy addresses
const OP_STACK_EAS = "0x4200000000000000000000000000000000000021";
const OP_STACK_SCHEMA_REGISTRY = "0x4200000000000000000000000000000000000020";

export const OPTIMISM_MAINNET: ChainConfig = {
	chainId: 10n,
	easAddress: OP_STACK_EAS,
	schemaRegistryAddress: OP_STACK_SCHEMA_REGISTRY,
	schemaUIDs: SCHEMAS_BY_CHAIN["optimism-mainnet"],
};

export const OPTIMISM_SEPOLIA: ChainConfig = {
	chainId: 11155420n,
	easAddress: OP_STACK_EAS,
	schemaRegistryAddress: OP_STACK_SCHEMA_REGISTRY,
	schemaUIDs: SCHEMAS_BY_CHAIN["optimism-sepolia"],
};

export const BASE_MAINNET: ChainConfig = {
	chainId: 8453n,
	easAddress: OP_STACK_EAS,
	schemaRegistryAddress: OP_STACK_SCHEMA_REGISTRY,
	schemaUIDs: SCHEMAS_BY_CHAIN["base-mainnet"],
};

export const BASE_SEPOLIA: ChainConfig = {
	chainId: 84532n,
	easAddress: OP_STACK_EAS,
	schemaRegistryAddress: OP_STACK_SCHEMA_REGISTRY,
	schemaUIDs: SCHEMAS_BY_CHAIN["base-sepolia"],
};

/**
 * Registry of known chains keyed by stable string name. Lets consumers pass
 * `chain: "optimism-mainnet"` to `OpenGardenClient` instead of importing a
 * `ChainConfig` constant and threading it through. `ChainConfig` objects are
 * still accepted for custom deployments or chains not listed here.
 */
export const CHAIN_CONFIGS = {
	"celo-mainnet": CELO_MAINNET,
	"celo-alfajores": CELO_ALFAJORES,
	"optimism-mainnet": OPTIMISM_MAINNET,
	"optimism-sepolia": OPTIMISM_SEPOLIA,
	"base-mainnet": BASE_MAINNET,
	"base-sepolia": BASE_SEPOLIA,
} as const satisfies Record<string, ChainConfig>;

export type ChainName = keyof typeof CHAIN_CONFIGS;

export function getChainConfig(name: ChainName): ChainConfig {
	return CHAIN_CONFIGS[name];
}
