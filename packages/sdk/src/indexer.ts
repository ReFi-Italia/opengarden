import type { IndexerSubmissionResult } from "./types/results";

const EASSCAN_GRAPHQL_URLS: Record<string, string> = {
	"42220": "https://celo.easscan.org/graphql",
	"10": "https://optimism.easscan.org/graphql",
	"8453": "https://base.easscan.org/graphql",
	"11155420": "https://optimism-sepolia.easscan.org/graphql",
	"84532": "https://base-sepolia.easscan.org/graphql",
};

const EASSCAN_STORE_URLS: Record<string, string> = {
	"42220": "https://celo.easscan.org/offchain/store",
	"10": "https://optimism.easscan.org/offchain/store",
	"8453": "https://base.easscan.org/offchain/store",
	"11155420": "https://optimism-sepolia.easscan.org/offchain/store",
	"84532": "https://base-sepolia.easscan.org/offchain/store",
};

export function getGraphqlUrl(chainId: bigint): string | undefined {
	return EASSCAN_GRAPHQL_URLS[chainId.toString()];
}

export function getStoreUrl(chainId: bigint): string | undefined {
	return EASSCAN_STORE_URLS[chainId.toString()];
}

export async function submitToIndexer(
	storeUrl: string,
	signedAttestation: Record<string, unknown>,
	signerAddress: string,
): Promise<IndexerSubmissionResult> {
	try {
		const pkg = JSON.stringify(
			{ sig: signedAttestation, signer: signerAddress },
			(_key, value) => (typeof value === "bigint" ? value.toString() : value),
		);
		const response = await fetch(storeUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ filename: "eas.txt", textJson: pkg }),
		});
		if (!response.ok) {
			const body = await response.text().catch(() => "");
			const error = `HTTP ${response.status}${body ? `: ${body}` : ""}`;
			console.warn(`easscan indexer returned ${error}`);
			return { ok: false, error };
		}
		return { ok: true };
	} catch (err) {
		console.warn("easscan indexer submission failed", err);
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
