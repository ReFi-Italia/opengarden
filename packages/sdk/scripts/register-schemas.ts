/**
 * Register all OpenGarden schemas on a chain and persist the resulting
 * UIDs into `src/chains/schemas.json`.
 *
 * Run once per chain. UIDs are deterministic — if schemas are already
 * registered, the tx will revert but the UID is still valid.
 *
 * Usage:  pnpm register-schemas
 * After a successful run, commit the updated `src/chains/schemas.json`.
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { BASE_SEPOLIA, OPTIMISM_SEPOLIA, ZERO_ADDRESS } from "../src/constants";
import { SCHEMA_DEFINITIONS } from "../src/schemas/definitions";
import type { ChainConfig, SchemaUIDs } from "../src/types/config";
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

const SCHEMAS_JSON_PATH = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../src/chains/schemas.json",
);

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

const uids: Partial<SchemaUIDs> = {};
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
	} catch (err: unknown) {
		// AlreadyExists revert means it's registered
		const message = err instanceof Error ? err.message : String(err);
		const reason =
			err != null && typeof err === "object" && "reason" in err
				? String((err as { reason: unknown }).reason)
				: "";
		if (message.includes("AlreadyExists") || reason.includes("AlreadyExists")) {
			console.log(`  ${name}: ${uid} (already registered)`);
		} else {
			console.error(`  ${name}: FAILED — ${message}`);
		}
	}

	// Rate limit delay
	await new Promise((r) => setTimeout(r, 1_500));
}

// Merge the newly registered UIDs back into src/chains/schemas.json so the
// next SDK build ships them automatically.
const existing = JSON.parse(readFileSync(SCHEMAS_JSON_PATH, "utf8")) as Record<
	string,
	Partial<SchemaUIDs>
>;
existing[CHAIN_NAME] = { ...existing[CHAIN_NAME], ...uids };
writeFileSync(
	SCHEMAS_JSON_PATH,
	`${JSON.stringify(existing, null, 2)}\n`,
	"utf8",
);

console.log(`\nPersisted UIDs to ${SCHEMAS_JSON_PATH}`);
console.log("Next: run `pnpm name-schemas` to label them on easscan.");
