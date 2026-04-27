import { OpenGardenClient } from "./client";
import { resolveChain } from "./constants";
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

	const chain = resolveChain(config.chain);

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
