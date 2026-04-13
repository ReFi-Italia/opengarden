import { OpenGardenClient } from "./client";
import { CHAIN_CONFIGS } from "./constants";
import { OpenGardenError, OpenGardenErrorCode } from "./errors";
import { initEncoders } from "./schemas/encoders";
import type { OpenGardenConfig } from "./types/config";

/** Config for `createOpenGardenClient` — `OpenGardenConfig` minus the injected eas/registry deps. */
export type CreateOpenGardenClientConfig = Omit<
	OpenGardenConfig,
	"eas" | "registry"
>;

/**
 * Lazy-loads `eas-sdk`, constructs connected `EAS` + `SchemaRegistry`
 * instances from the resolved chain, and returns a ready-to-use
 * `OpenGardenClient`. Consumers holding their own `eas-sdk` instances
 * (or injecting mocks) can call `new OpenGardenClient(...)` directly.
 */
export async function createOpenGardenClient(
	config: CreateOpenGardenClientConfig,
): Promise<OpenGardenClient> {
	if (!config.signer) {
		throw new OpenGardenError(
			OpenGardenErrorCode.SIGNER_ERROR,
			"Signer is required",
		);
	}

	const chain =
		typeof config.chain === "string"
			? resolveChainByName(config.chain)
			: config.chain;

	const { EAS, SchemaRegistry } = await import(
		"@ethereum-attestation-service/eas-sdk"
	);
	await initEncoders();

	const eas = new EAS(chain.easAddress);
	eas.connect(config.signer);

	const registry = new SchemaRegistry(chain.schemaRegistryAddress);
	registry.connect(config.signer);

	return new OpenGardenClient({ ...config, chain, eas, registry });
}

function resolveChainByName(name: string) {
	if (!Object.prototype.hasOwnProperty.call(CHAIN_CONFIGS, name)) {
		throw new OpenGardenError(
			OpenGardenErrorCode.INVALID_INPUT,
			`Unknown chain name "${name}". Known chains: ${Object.keys(
				CHAIN_CONFIGS,
			).join(", ")}. Pass a ChainConfig object for custom deployments.`,
		);
	}
	return CHAIN_CONFIGS[name as keyof typeof CHAIN_CONFIGS];
}
