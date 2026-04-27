/**
 * Name all deployed OpenGarden schemas on easscan.
 *
 * Uses the EAS "Name a Schema" protocol to label each schema so it
 * appears with a human-readable name in the EAS explorer.
 * Must be run from the same wallet that originally registered the schemas.
 *
 * Reads the schema UIDs for the target chain from `src/chains/schemas.json`
 * (populated by `pnpm register-schemas`). Fails if the chain has no entries.
 *
 * Skips if the well-known naming schema (0x44d5...) is not deployed on
 * the target chain — that schema is managed by the EAS team.
 *
 * Requires env vars:
 *   OPENGARDEN_TEST_PRIVATE_KEY  — the schema creator wallet
 *   OPENGARDEN_TEST_RPC_URL      — (optional) RPC endpoint
 *   OPENGARDEN_TEST_CHAIN        — (optional) chain name
 *
 * Usage:  pnpm name-schemas
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import {
	BASE_SEPOLIA,
	OPTIMISM_SEPOLIA,
	SCHEMA_NAME_UID,
	ZERO_ADDRESS,
	ZERO_BYTES32,
} from "../src/constants";
import type { ChainConfig, SchemaUIDs } from "../src/types/config";

// Force CJS resolution — the EAS SDK ESM build has extensionless imports
// that break under Node 22's strict ESM resolver.
const require = createRequire(import.meta.url);
const {
	EAS,
	SchemaEncoder,
	SchemaRegistry,
} = require("@ethereum-attestation-service/eas-sdk");

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

const schemasByChain = JSON.parse(
	readFileSync(SCHEMAS_JSON_PATH, "utf8"),
) as Record<string, Partial<SchemaUIDs>>;
const schemaUIDs = schemasByChain[CHAIN_NAME];
if (!schemaUIDs || Object.keys(schemaUIDs).length === 0) {
	console.error(
		`No schema UIDs found for ${CHAIN_NAME} in ${SCHEMAS_JSON_PATH}. Run \`pnpm register-schemas\` first.`,
	);
	process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer = new ethers.Wallet(PRIVATE_KEY, provider);

const eas = new EAS(chain.easAddress);
eas.connect(signer);

const registry = new SchemaRegistry(chain.schemaRegistryAddress);
registry.connect(signer);

console.log(`Naming schemas on ${CHAIN_NAME}...`);
console.log(`  Wallet: ${await signer.getAddress()}`);

// Check that the well-known naming schema exists on this chain
try {
	const existing = await registry.getSchema({ uid: SCHEMA_NAME_UID });
	if (!existing || existing.uid === ZERO_BYTES32) throw new Error("not found");
	console.log(`  Naming schema: found\n`);
} catch {
	console.error(
		`\nNaming schema ${SCHEMA_NAME_UID} is not deployed on ${CHAIN_NAME}.`,
	);
	console.error(
		"This schema is managed by the EAS team — schema naming is not available on this chain yet.",
	);
	process.exit(1);
}

const encoder = new SchemaEncoder("bytes32 schemaId, string name");
let named = 0;

for (const [name, uid] of Object.entries(schemaUIDs)) {
	if (!uid) continue;
	const encodedData = encoder.encodeData([
		{ name: "schemaId", value: uid, type: "bytes32" },
		{ name: "name", value: name, type: "string" },
	]);

	try {
		const tx = await eas.attest({
			schema: SCHEMA_NAME_UID,
			data: {
				recipient: ZERO_ADDRESS,
				data: encodedData,
				expirationTime: 0n,
				revocable: true,
				refUID:
					"0x0000000000000000000000000000000000000000000000000000000000000000",
				value: 0n,
			},
		});
		await tx.wait();
		console.log(`  ${name}: named`);
		named++;
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`  ${name}: FAILED — ${message}`);
	}

	await new Promise((r) => setTimeout(r, 1_500));
}

console.log(
	`\nDone — named ${named}/${Object.keys(schemaUIDs).length} schemas.`,
);
