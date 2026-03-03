/**
 * Register all OpenGarden schemas on a testnet and print the UIDs.
 *
 * Run once per chain. UIDs are deterministic — if schemas are already
 * registered, the tx will revert but the UID is still valid.
 *
 * Usage:  pnpm register-schemas
 * Output: JSON map of schema name → UID (paste into .env as OPENGARDEN_SCHEMA_UIDS)
 */
import "dotenv/config";
import { createRequire } from "node:module";
import { ethers } from "ethers";
import { BASE_SEPOLIA, OPTIMISM_SEPOLIA, ZERO_ADDRESS } from "../src/constants";
import { SCHEMA_DEFINITIONS } from "../src/schemas/definitions";
import type { ChainConfig } from "../src/types/config";
import type { SchemaName } from "../src/types/enums";

// Force CJS resolution — the EAS SDK ESM build has extensionless imports
// that break under Node 22's strict ESM resolver.
const require = createRequire(import.meta.url);
const { SchemaRegistry } = require("@ethereum-attestation-service/eas-sdk");

const PRIVATE_KEY = process.env.OPENGARDEN_TEST_PRIVATE_KEY;
const RPC_URL =
	process.env.OPENGARDEN_TEST_RPC_URL || "https://sepolia.optimism.io";
const CHAIN_NAME = process.env.OPENGARDEN_TEST_CHAIN || "optimism-sepolia";

const CHAINS: Record<string, ChainConfig> = {
	"optimism-sepolia": OPTIMISM_SEPOLIA,
	"base-sepolia": BASE_SEPOLIA,
};

if (!PRIVATE_KEY) {
	console.error("Set OPENGARDEN_TEST_PRIVATE_KEY in .env");
	process.exit(1);
}

const chain = CHAINS[CHAIN_NAME];
if (!chain) {
	console.error(`Unknown chain: ${CHAIN_NAME}`);
	process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer = new ethers.Wallet(PRIVATE_KEY, provider);

const registry = new SchemaRegistry(chain.schemaRegistryAddress);
registry.connect(signer);

const uids: Record<string, string> = {};
const names = Object.keys(SCHEMA_DEFINITIONS) as SchemaName[];

console.log(`Registering schemas on ${CHAIN_NAME}...\n`);

for (const name of names) {
	const def = SCHEMA_DEFINITIONS[name];

	// Compute the deterministic UID first
	const uid = SchemaRegistry.getSchemaUID(
		def.schema,
		ZERO_ADDRESS,
		def.revocable,
	);
	uids[name] = uid;

	// Check if already registered by trying to fetch it
	try {
		const existing = await registry.getSchema({ uid });
		if (
			existing &&
			existing.uid !==
				"0x0000000000000000000000000000000000000000000000000000000000000000"
		) {
			console.log(`  ${name}: ${uid} (already registered)`);
			continue;
		}
	} catch {
		// Not registered yet, proceed
	}

	try {
		const tx = await registry.register({
			schema: def.schema,
			resolverAddress: ZERO_ADDRESS,
			revocable: def.revocable,
		});
		await tx.wait();
		console.log(`  ${name}: ${uid} (registered)`);
	} catch (err: any) {
		// AlreadyExists revert means it's registered
		if (
			err.message?.includes("AlreadyExists") ||
			err.reason?.includes("AlreadyExists")
		) {
			console.log(`  ${name}: ${uid} (already registered)`);
		} else {
			console.error(`  ${name}: FAILED — ${err.message}`);
		}
	}

	// Rate limit delay
	await new Promise((r) => setTimeout(r, 1_500));
}

console.log("\n--- Copy this into your .env ---\n");
console.log(`OPENGARDEN_SCHEMA_UIDS='${JSON.stringify(uids)}'`);
console.log("\n--- Or use in code ---\n");
console.log(JSON.stringify(uids, null, 2));
