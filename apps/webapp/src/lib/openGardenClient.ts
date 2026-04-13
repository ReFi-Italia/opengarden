import {
	CHAIN_CONFIGS,
	type ChainName,
	createOpenGardenClient,
	getChainConfig,
	type OpenGardenClient,
} from "@refi-italia/opengarden";
import { ethers } from "ethers";
import type { Payload } from "payload";

const CHAIN_ENV_VAR = "PROTOCOL_CHAIN";

export type OpenGardenContext = {
	client: OpenGardenClient;
	chainId: number;
	attesterWallet: string;
};

let verifiedChainId: bigint | null = null;

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
