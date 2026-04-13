import {
	type ChainName,
	getChainConfig,
	type SchemaName,
} from "@refi-italia/opengarden/helpers";
import { ethers } from "ethers";
import type { Payload } from "payload";

export type OpenGardenContext = {
	/**
	 * The configured `OpenGardenClient` instance, ready to make chain calls.
	 * Imported lazily so that loading this module from the Payload CLI / Vitest
	 * never triggers the `@ethereum-attestation-service/eas-sdk` ESM crash.
	 */
	client: import("@refi-italia/opengarden").OpenGardenClient;
	/** Chain id snapshotted from `protocolConfig` at the time the client was built. */
	chainId: number;
	/** Resolved attester address from the env-provided private key. */
	attesterWallet: string;
};

/**
 * Builds an `OpenGardenClient` from the live `protocolConfig` global plus
 * env-provided signer + RPC. Lazy-imports the SDK root entry so that this
 * module is safe to import from `payload.config.ts` (the Payload CLI and
 * Vitest both crash when statically loading the EAS SDK due to upstream
 * missing-extension ESM specifiers — see apps/webapp/README.md).
 *
 * Throws with an actionable message if any required piece is missing so
 * that task handlers fail fast instead of producing partial chain state.
 */
export async function getOpenGardenContext(
	payload: Payload,
): Promise<OpenGardenContext> {
	const privateKey = process.env.OPENGARDEN_SIGNER_PRIVATE_KEY;
	if (!privateKey) {
		throw new Error(
			"OPENGARDEN_SIGNER_PRIVATE_KEY is not set. Chain calls require a funded signer.",
		);
	}
	const rpcUrl = process.env.OPENGARDEN_RPC_URL;
	if (!rpcUrl) {
		throw new Error(
			"OPENGARDEN_RPC_URL is not set. Chain calls require a JSON-RPC endpoint for the configured chain.",
		);
	}

	const config = await payload.findGlobal({ slug: "protocolConfig", depth: 0 });
	const chainName = config.chain as ChainName;

	const schemaUIDs = Object.fromEntries(
		Object.entries(config.schemaUIDs ?? {}).filter(
			([, value]) => typeof value === "string" && value.length > 0,
		),
	) as Partial<Record<SchemaName, string>>;

	const provider = new ethers.JsonRpcProvider(rpcUrl);
	const signer = new ethers.Wallet(privateKey, provider);
	const attesterWallet = await signer.getAddress();

	const { OpenGardenClient } = await import("@refi-italia/opengarden");
	const client = new OpenGardenClient({
		signer,
		chain: chainName,
		schemaUIDs,
		graphqlUrl: config.graphqlUrl ?? undefined,
		storeUrl: config.storeUrl ?? undefined,
	});

	return {
		client,
		chainId: Number(getChainConfig(chainName).chainId),
		attesterWallet,
	};
}
