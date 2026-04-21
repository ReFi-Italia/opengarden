/**
 * E2E test — full intervention lifecycle on a testnet.
 *
 * Requires env vars (see .env.example):
 *   OPENGARDEN_TEST_PRIVATE_KEY  — funded testnet wallet
 *   OPENGARDEN_TEST_RPC_URL      — RPC endpoint (use a dedicated provider, not the public RPC)
 *   OPENGARDEN_TEST_CHAIN        — chain name (default: optimism-sepolia)
 *
 * Run:  pnpm test:e2e
 * Skip: tests auto-skip when env vars are missing
 */
import "dotenv/config";
import { ethers } from "ethers";
import { beforeAll, describe, expect, it } from "vitest";
import type { OpenGardenClient } from "../src/client";
import { createOpenGardenClient } from "../src/connect";
import {
	BASE_SEPOLIA,
	EVIDENCE_BUNDLE_VERSION,
	OPTIMISM_SEPOLIA,
	ZERO_ADDRESS,
	ZERO_BYTES32,
} from "../src/constants";
import type { ChainConfig, StorageAdapter } from "../src/types/config";
import { AreaType, InterventionType } from "../src/types/enums";
import type { TimestampedOffChainResult } from "../src/types/results";

const PRIVATE_KEY = process.env.OPENGARDEN_TEST_PRIVATE_KEY;
const RPC_URL =
	process.env.OPENGARDEN_TEST_RPC_URL || "https://sepolia.optimism.io";
const CHAIN_NAME = process.env.OPENGARDEN_TEST_CHAIN || "optimism-sepolia";

const CHAINS: Record<string, ChainConfig> = {
	"optimism-sepolia": OPTIMISM_SEPOLIA,
	"base-sepolia": BASE_SEPOLIA,
};

const skip = !PRIVATE_KEY;

// Pause between steps to avoid RPC rate limits
const STEP_DELAY_MS = 2_000;
function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// In-memory storage adapter for evidence bundle tests
function createMemoryStorage(): StorageAdapter & {
	store: Map<string, string>;
} {
	const store = new Map<string, string>();
	return {
		store,
		async upload(data: Uint8Array | string): Promise<string> {
			const content =
				typeof data === "string" ? data : new TextDecoder().decode(data);
			const hash = ethers.keccak256(ethers.toUtf8Bytes(content));
			store.set(hash, content);
			return hash;
		},
		async download(hash: string): Promise<Uint8Array> {
			const content = store.get(hash);
			if (!content) throw new Error(`Not found: ${hash}`);
			return new TextEncoder().encode(content);
		},
	};
}

function now(): bigint {
	return BigInt(Math.floor(Date.now() / 1000));
}

describe.skipIf(skip)("E2E: full intervention lifecycle", () => {
	let client: OpenGardenClient;
	let walletAddress: string;
	let storage: ReturnType<typeof createMemoryStorage>;

	// Shared state across ordered tests
	let areaUID: string;
	let scheduleResult: TimestampedOffChainResult;
	let checkinResult: TimestampedOffChainResult;
	let checkoutResult: TimestampedOffChainResult;
	let reportResult: TimestampedOffChainResult;
	let evidenceBundleHash: string;
	let interventionUID: string;

	beforeAll(async () => {
		const chain = CHAINS[CHAIN_NAME];
		if (!chain) throw new Error(`Unknown chain: ${CHAIN_NAME}`);

		if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY not set");
		const provider = new ethers.JsonRpcProvider(RPC_URL);
		const signer = new ethers.Wallet(PRIVATE_KEY, provider);
		walletAddress = await signer.getAddress();
		storage = createMemoryStorage();

		client = await createOpenGardenClient({
			signer,
			chain,
			storage,
		});

		const hasCanonicalUIDs =
			chain.schemaUIDs && Object.keys(chain.schemaUIDs).length > 0;
		console.log(`  Wallet: ${walletAddress}`);
		console.log(`  Chain:  ${CHAIN_NAME}`);
		console.log(`  RPC:    ${RPC_URL}`);
		console.log(
			`  Schema UIDs: ${hasCanonicalUIDs ? "loaded from chains/schemas.json" : "will register on-chain"}`,
		);

		const balance = await provider.getBalance(walletAddress);
		console.log(`  Balance: ${ethers.formatEther(balance)} ETH`);
		if (balance === 0n)
			throw new Error("Wallet has no testnet ETH — fund it first");
	}, 30_000);

	// --- Step 1: Register schemas (skipped if UIDs provided via env) ---

	it("registers all schemas", async () => {
		const results = await client.registerAllSchemas();

		const uids = client.getSchemaUIDs();
		expect(uids.AreaRegistration).toBeTruthy();
		expect(uids.PublishedIntervention).toBeTruthy();
		expect(uids.GardenerMilestone).toBeTruthy();
		expect(uids.ScheduledIntervention).toBeTruthy();
		expect(uids.GardenerCheckin).toBeTruthy();
		expect(uids.GardenerCheckout).toBeTruthy();
		expect(uids.GardenerReport).toBeTruthy();
		expect(uids.Healthcheck).toBeTruthy();

		if (results.length > 0) {
			console.log(`  Registered ${results.length} schemas`);
			for (const r of results) console.log(`    ${r.name}: ${r.uid}`);
		} else {
			console.log(
				"  All schemas already registered (loaded from chains/schemas.json)",
			);
		}
		await delay(STEP_DELAY_MS);
	}, 300_000);

	// --- Step 2: Register area ---

	it("registers an area on-chain", async () => {
		const result = await client.registerArea({
			areaId: "E2E-TEST-001",
			latitude: 41.8902,
			longitude: 12.4922,
			areaType: AreaType.PublicGreenSpace,
			name: "E2E Test Garden",
			municipality: "RM-TEST",
			boundariesHash: null,
			metadata: "",
		});

		areaUID = result.uid;
		expect(areaUID).toBeTruthy();
		expect(result.txHash).toBeTruthy();
		console.log(`  Area UID: ${areaUID}`);
		await delay(STEP_DELAY_MS);
	}, 60_000);

	// --- Step 3: Schedule intervention ---

	it("schedules an intervention", async () => {
		scheduleResult = await client.scheduleIntervention({
			areaUID,
			interventionId: "E2E-INT-001",
			interventionType: InterventionType.RoutineMaintenance,
			crewLead: walletAddress,
			crewSize: 1,
			scheduledDate: now(),
			estimatedMinutes: 60,
			description: "E2E test routine maintenance",
			commissionId: null,
		});

		expect(scheduleResult.uid).toBeTruthy();
		expect(scheduleResult.onchainTimestamp).toBeGreaterThan(0n);
		console.log(`  Schedule UID: ${scheduleResult.uid}`);
		await delay(STEP_DELAY_MS);
	}, 60_000);

	// --- Step 4: Gardener checks in ---

	it("records gardener checkin", async () => {
		const claimed = now();
		checkinResult = await client.checkin({
			interventionUID: scheduleResult.uid,
			latitude: 41.8902,
			longitude: 12.4922,
			photoHash: ZERO_BYTES32,
			time: claimed,
		});

		expect(checkinResult.uid).toBeTruthy();
		expect(checkinResult.onchainTimestamp).toBeGreaterThan(0n);
		expect(
			BigInt(String(checkinResult.signedAttestation.message.time)),
		).toBe(claimed);
		console.log(`  Checkin UID: ${checkinResult.uid}`);
		await delay(STEP_DELAY_MS);
	}, 60_000);

	// --- Step 6: Gardener checks out ---

	it("records gardener checkout", async () => {
		const claimed = now();
		checkoutResult = await client.checkout({
			checkinUID: checkinResult.uid,
			actualMinutes: 55,
			time: claimed,
		});

		expect(checkoutResult.uid).toBeTruthy();
		expect(checkoutResult.onchainTimestamp).toBeGreaterThan(0n);
		expect(
			BigInt(String(checkoutResult.signedAttestation.message.time)),
		).toBe(claimed);
		console.log(`  Checkout UID: ${checkoutResult.uid}`);
		await delay(STEP_DELAY_MS);
	}, 60_000);

	// --- Step 7: Gardener submits report ---

	it("submits a gardener report", async () => {
		reportResult = await client.submitReport({
			interventionUID: scheduleResult.uid,
			checkoutUID: checkoutResult.uid,
			tasksCompleted: "PRUNE,CLEAN,WATER",
			taskCount: 3,
			photosHash: ZERO_BYTES32,
			notes: "E2E test — all tasks completed successfully",
		});

		expect(reportResult.uid).toBeTruthy();
		expect(reportResult.onchainTimestamp).toBeGreaterThan(0n);
		console.log(`  Report UID: ${reportResult.uid}`);
		await delay(STEP_DELAY_MS);
	}, 60_000);

	// --- Step 9: Periodic healthcheck (independent, area-scoped) ---

	it("records an area healthcheck independently of the intervention", async () => {
		const healthcheckResult = await client.recordHealthcheck({
			areaUID,
			healthScore: 8,
			photoHash: ZERO_BYTES32,
			notes: "Post-intervention spot check",
			metadata: "",
		});

		expect(healthcheckResult.uid).toBeTruthy();
		expect(healthcheckResult.onchainTimestamp).toBeGreaterThan(0n);
		console.log(`  Healthcheck UID: ${healthcheckResult.uid}`);
		await delay(STEP_DELAY_MS);
	}, 60_000);

	// --- Step 10: Build and upload evidence bundle ---

	it("builds and uploads evidence bundle", async () => {
		const bundle = client.buildEvidenceBundle({
			interventionId: "E2E-INT-001",
			areaUID,
			scheduled: scheduleResult,
			crew: [
				{
					checkin: checkinResult,
					checkout: checkoutResult,
					report: reportResult,
				},
			],
		});

		expect(bundle.bundleVersion).toBe(EVIDENCE_BUNDLE_VERSION);
		expect(bundle.attestations.scheduled.uid).toBe(scheduleResult.uid);
		expect(bundle.attestations.checkins).toHaveLength(1);
		expect(bundle.attestations.reports).toHaveLength(1);

		evidenceBundleHash = await client.uploadEvidenceBundle(bundle);
		expect(evidenceBundleHash).toBeTruthy();
		console.log(`  Bundle hash: ${evidenceBundleHash}`);
	}, 30_000);

	// --- Step 11: Publish intervention on-chain ---

	it("publishes the intervention on-chain", async () => {
		const result = await client.publishIntervention({
			areaUID,
			interventionId: "E2E-INT-001",
			interventionType: InterventionType.RoutineMaintenance,
			executionDate: now(),
			commissionId: null,
			evidenceBundleHash,
		});

		interventionUID = result.uid;
		expect(interventionUID).toBeTruthy();
		expect(result.txHash).toBeTruthy();
		console.log(`  Intervention UID: ${interventionUID}`);
		await delay(STEP_DELAY_MS);
	}, 60_000);

	// --- Step 12: Mint milestone ---

	it("mints a gardener milestone", async () => {
		const result = await client.mintMilestone({
			recipient: walletAddress,
			milestoneLevel: 1,
			totalInterventions: 5,
			totalValidated: 5,
			avgHealthImprovement: 5,
			achievedAt: now(),
			evidenceRoot: ZERO_BYTES32,
		});

		expect(result.uid).toBeTruthy();
		expect(result.txHash).toBeTruthy();
		console.log(`  Milestone UID: ${result.uid}`);
		await delay(STEP_DELAY_MS);
	}, 60_000);

	// --- Step 13: Read back and verify ---

	it("reads back the area", async () => {
		const area = await client.getArea(areaUID);
		expect(area.areaId).toBe("E2E-TEST-001");
		expect(area.name).toBe("E2E Test Garden");
		expect(area.latitude).toBeCloseTo(41.8902, 4);
		expect(area.longitude).toBeCloseTo(12.4922, 4);
		expect(area.attester).toBe(walletAddress);
		console.log(`  Area read back: ${area.areaId} — ${area.name}`);
	}, 30_000);

	it("reads back the intervention", async () => {
		const intervention = await client.getIntervention(interventionUID);
		expect(intervention.interventionId).toBe("E2E-INT-001");
		expect(intervention.areaUID).toBe(areaUID);
		expect(intervention.recipient).toBe(ZERO_ADDRESS);
		console.log(
			`  Intervention read back: ${intervention.interventionId}, area=${intervention.areaUID}`,
		);
	}, 30_000);

	it("verifies evidence bundle against on-chain timestamps", async () => {
		const verification = await client.verifyEvidenceBundle(interventionUID);
		console.log(
			`  Bundle verified: sigs=${verification.signaturesValid}, timestamps=${verification.timestampsVerified}, refUIDs=${verification.refUIDsValid}, temporal=${verification.temporalOrderValid}, bracket=${verification.executionDateBracketed}`,
		);
		for (const check of verification.checks) {
			if (!check.valid) {
				console.log(`    FAIL [${check.code}] ${check.message}`);
			}
		}
		expect(verification.signaturesValid).toBe(true);
		expect(verification.timestampsVerified).toBe(true);
		expect(verification.refUIDsValid).toBe(true);
		expect(verification.temporalOrderValid).toBe(true);
		expect(verification.executionDateBracketed).toBe(true);
		expect(verification.valid).toBe(true);
	}, 60_000);
});

describe.skipIf(skip)("E2E: indexBundleAttestations", () => {
	let indexerClient: OpenGardenClient;
	let walletAddress: string;
	let areaUID: string;
	let scheduleResult: TimestampedOffChainResult;

	beforeAll(async () => {
		const chain = CHAINS[CHAIN_NAME];
		if (!chain) throw new Error(`Unknown chain: ${CHAIN_NAME}`);

		if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY not set");
		const provider = new ethers.JsonRpcProvider(RPC_URL);
		const signer = new ethers.Wallet(PRIVATE_KEY, provider);
		walletAddress = await signer.getAddress();

		indexerClient = await createOpenGardenClient({
			signer,
			chain,
		});

		console.log(`  Indexer test — wallet: ${walletAddress}`);
	}, 30_000);

	it("registers an area for the indexer test", async () => {
		const result = await indexerClient.registerArea({
			areaId: "E2E-IDX-001",
			latitude: 41.8902,
			longitude: 12.4922,
			areaType: AreaType.PublicGreenSpace,
			name: "E2E Indexer Test Garden",
			municipality: "RM-TEST",
			boundariesHash: null,
			metadata: "",
		});

		areaUID = result.uid;
		expect(areaUID).toBeTruthy();
		console.log(`  Indexer area UID: ${areaUID}`);
		await delay(STEP_DELAY_MS);
	}, 60_000);

	it("creates an off-chain attestation and indexes it explicitly", async () => {
		scheduleResult = await indexerClient.scheduleIntervention({
			areaUID,
			interventionId: "E2E-IDX-INT-001",
			interventionType: InterventionType.RoutineMaintenance,
			crewLead: walletAddress,
			crewSize: 1,
			scheduledDate: now(),
			estimatedMinutes: 30,
			description: "E2E indexer test — scheduled",
			commissionId: null,
		});

		expect(scheduleResult.uid).toBeTruthy();
		console.log(`  Schedule UID: ${scheduleResult.uid}`);
		await delay(STEP_DELAY_MS);
	}, 60_000);
});
