import {
	CHAIN_CONFIGS,
	type ChainName,
	getChainConfig,
} from "@refi-italia/opengarden/helpers";
import { ethers } from "ethers";
import type { Payload } from "payload";

const CHAIN_ENV_VAR = "PROTOCOL_CHAIN";

export type OpenGardenContext = {
	/**
	 * The configured `OpenGardenClient` instance, ready to make chain calls.
	 * Imported lazily so that loading this module from the Payload CLI / Vitest
	 * never triggers the `@ethereum-attestation-service/eas-sdk` ESM crash.
	 */
	client: import("@refi-italia/opengarden").OpenGardenClient;
	/** Chain id resolved from `PROTOCOL_CHAIN` at the time the client was built. */
	chainId: number;
	/** Resolved attester address from the env-provided private key. */
	attesterWallet: string;
};

// Per-process cache — once we've verified the current chain id matches the
// historical chainTransactions audit trail, skip the DB query on subsequent
// calls. Env vars don't change at runtime so this is safe for the lifetime
// of the process.
let verifiedChainId: bigint | null = null;

/**
 * Refuses to boot if `chainTransactions` already has activity against a
 * different `chainId`. Catches "deployed with the wrong PROTOCOL_CHAIN"
 * before any new on-chain writes corrupt the audit trail.
 */
async function verifyChainConsistency(
	payload: Payload,
	chainId: bigint,
): Promise<void> {
	if (verifiedChainId === chainId) return;
	const mismatched = await payload.find({
		collection: "chainTransactions",
		where: { chainId: { not_equals: Number(chainId) } },
		limit: 1,
		depth: 0,
	});
	if (mismatched.totalDocs > 0) {
		const otherChainId = mismatched.docs[0]?.chainId;
		throw new Error(
			`${CHAIN_ENV_VAR} resolves to chain id ${chainId}, but chainTransactions already has activity for chain id ${otherChainId}. Refusing to mix chains across a deploy.`,
		);
	}
	verifiedChainId = chainId;
}

/**
 * Builds an `OpenGardenClient` from the env-provided chain name, signer,
 * and RPC. Lazy-imports the SDK root entry so that this module is safe to
 * import from `payload.config.ts` (the Payload CLI and Vitest both crash
 * when statically loading the EAS SDK due to upstream missing-extension
 * ESM specifiers — see apps/webapp/README.md).
 *
 * Throws with an actionable message if any required env var is missing,
 * and enforces per-deploy chain consistency against the existing
 * `chainTransactions` audit trail.
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
	const chainInput = process.env[CHAIN_ENV_VAR];
	if (!chainInput || !(chainInput in CHAIN_CONFIGS)) {
		throw new Error(
			`${CHAIN_ENV_VAR} is not set or unknown (got "${chainInput ?? ""}"). Set it to one of: ${Object.keys(
				CHAIN_CONFIGS,
			).join(", ")}.`,
		);
	}
	const chainName = chainInput as ChainName;
	const chainConfig = getChainConfig(chainName);

	await verifyChainConsistency(payload, chainConfig.chainId);

	const provider = new ethers.JsonRpcProvider(rpcUrl);
	const signer = new ethers.Wallet(privateKey, provider);
	const attesterWallet = await signer.getAddress();

	const { OpenGardenClient } = await import("@refi-italia/opengarden");
	const client = new OpenGardenClient({
		signer,
		chain: chainName,
	});

	return {
		client,
		chainId: Number(chainConfig.chainId),
		attesterWallet,
	};
}
