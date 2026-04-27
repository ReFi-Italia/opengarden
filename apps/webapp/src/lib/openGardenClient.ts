import {
	CHAIN_CONFIGS,
	type ChainName,
	createOpenGardenClient,
	getChainConfig,
	type OpenGardenClient,
} from "@refi-italia/opengarden";
import { ethers } from "ethers";
import type { Payload } from "payload";

export type OpenGardenContext = {
	client: OpenGardenClient;
	chainId: number;
	attesterWallet: string;
};

let verifiedChainId: bigint | null = null;

let contextOverride: OpenGardenContext | null = null;

/**
 * Test-only seam: inject a pre-built OpenGardenContext (typically with a
 * mock OpenGardenClient) so task handlers can be exercised without env
 * vars, signer keys, or RPC connections. Pass `null` to reset.
 *
 * Lives in production code (not a test file) so the singleton
 * `getOpenGardenContext` lookup picks it up uniformly across every task.
 * The override is process-local — the singleFork vitest pool ensures one
 * process per test run.
 */
export function setOpenGardenContextOverride(
	override: OpenGardenContext | null,
): void {
	contextOverride = override;
}

async function verifyChainConsistency(
	payload: Payload,
	chainId: bigint,
): Promise<void> {
	if (verifiedChainId === chainId) return;
	const mismatched = await payload.find({
		collection: "attestations",
		where: { chainIdSnapshot: { not_equals: Number(chainId) } },
		limit: 1,
		depth: 0,
	});
	if (mismatched.totalDocs > 0) {
		const otherChainId = mismatched.docs[0]?.chainIdSnapshot;
		throw new Error(
			`PROTOCOL_CHAIN resolves to chain id ${chainId}, but attestations already has rows for chain id ${otherChainId}. Refusing to mix chains across a deploy.`,
		);
	}
	verifiedChainId = chainId;
}

export async function getOpenGardenContext(
	payload: Payload,
): Promise<OpenGardenContext> {
	if (contextOverride) return contextOverride;

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
	const chainInput = process.env.PROTOCOL_CHAIN;
	if (!chainInput || !(chainInput in CHAIN_CONFIGS)) {
		throw new Error(
			`PROTOCOL_CHAIN is not set or unknown (got "${chainInput ?? ""}"). Set it to one of: ${Object.keys(
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

	const client = await createOpenGardenClient({
		signer,
		chain: chainName,
	});

	return {
		client,
		chainId: Number(chainConfig.chainId),
		attesterWallet,
	};
}
