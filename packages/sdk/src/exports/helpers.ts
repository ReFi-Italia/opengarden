/**
 * Pure-helper subpath entry point.
 *
 * Re-exports the deterministic encoding primitives, enums, and chain
 * constants that consumers can use without instantiating an
 * `OpenGardenClient`. Importantly, **nothing here transitively imports
 * `@ethereum-attestation-service/eas-sdk`** — so consumers running under
 * Node's native ESM loader (Payload CLI, Vitest, scripts, etc.) can use
 * these helpers without hitting the EAS SDK's broken-extension ESM bundle.
 *
 * The default `.` entry still re-exports `OpenGardenClient` and the full
 * surface; this subpath is the explicit "no chain client" view.
 */

export type { ChainName } from "../constants";
export {
	BASE_MAINNET,
	BASE_SEPOLIA,
	CELO_ALFAJORES,
	CELO_MAINNET,
	CHAIN_CONFIGS,
	EVIDENCE_BUNDLE_VERSION,
	getChainConfig,
	OPTIMISM_MAINNET,
	OPTIMISM_SEPOLIA,
	SCHEMA_NAME_UID,
	ZERO_ADDRESS,
	ZERO_BYTES32,
} from "../constants";
export type { SponsorRef } from "../sponsor";
export { serializeSponsorRef } from "../sponsor";
export type { ChainConfig, SchemaUIDs, StorageAdapter } from "../types/config";
export type { SchemaName } from "../types/enums";
export { AreaType, InterventionType, MilestoneLevel } from "../types/enums";
export {
	fromMicrodegrees,
	hashIdentifier,
	hashPhotoBundle,
	toMicrodegrees,
	toUnixSeconds,
} from "../utils";
