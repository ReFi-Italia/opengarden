import { CHAIN_CONFIGS, type ChainName } from "@refi-italia/opengarden/helpers";
import { getPayload } from "payload";
import config from "../src/payload.config";

const DEFAULT_CHAIN: ChainName = "optimism-sepolia";

const chainInput = process.env.PROTOCOL_CHAIN ?? DEFAULT_CHAIN;
if (!(chainInput in CHAIN_CONFIGS)) {
	console.error(
		`Unknown PROTOCOL_CHAIN "${chainInput}". Must be one of: ${Object.keys(
			CHAIN_CONFIGS,
		).join(", ")}.`,
	);
	process.exit(1);
}
const chain = chainInput as ChainName;

const payload = await getPayload({ config: await config });

const existing = await payload.findGlobal({
	slug: "protocolConfig",
	depth: 0,
});
const isFirstSeed = !existing.chainIdSnapshot;
const isChainSwitch = !isFirstSeed && existing.chain !== chain;

await payload.updateGlobal({
	slug: "protocolConfig",
	data: { chain },
});

const updated = await payload.findGlobal({
	slug: "protocolConfig",
	depth: 0,
});

if (isFirstSeed) {
	console.log(
		`Seeded protocolConfig: chain=${updated.chain}, chainId=${updated.chainIdSnapshot}, easAddress=${updated.easAddress || "(empty — deploy EAS for this chain manually)"}, schemaRegistryAddress=${updated.schemaRegistryAddress || "(empty)"}`,
	);
} else if (isChainSwitch) {
	console.log(
		`Switched protocolConfig: ${existing.chain} → ${updated.chain} (chainId=${updated.chainIdSnapshot}, easAddress=${updated.easAddress || "(empty)"}).`,
	);
} else {
	console.log(
		`protocolConfig up to date (chain=${updated.chain}, easAddress=${updated.easAddress || "(empty)"}).`,
	);
}

process.exit(0);
