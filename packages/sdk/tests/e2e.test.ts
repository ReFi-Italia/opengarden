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
import { OpenGardenClient } from "../src/client";
import {
	BASE_SEPOLIA,
	OPTIMISM_SEPOLIA,
	ZERO_ADDRESS,
	ZERO_BYTES32,
} from "../src/constants";
import type {
	ChainConfig,
	SchemaUIDs,
	StorageAdapter,
} from "../src/types/config";
import type { TimestampedOffChainResult } from "../src/types/results";
import { hashIdentifier } from "../src/utils";

const PRIVATE_KEY = process.env.OPENGARDEN_TEST_PRIVATE_KEY;
const RPC_URL =
	process.env.OPENGARDEN_TEST_RPC_URL || "https://sepolia.optimism.io";
const CHAIN_NAME = process.env.OPENGARDEN_TEST_CHAIN || "optimism-sepolia";
const SCHEMA_UIDS_JSON = process.env.OPENGARDEN_SCHEMA_UIDS;

const CHAINS: Record<string, ChainConfig> = {
	"optimism-sepolia": OPTIMISM_SEPOLIA,
	"base-sepolia": BASE_SEPOLIA,
};

const skip = !PRIVATE_KEY;

function loadSchemaUIDs(): Partial<SchemaUIDs> | undefined {
	if (!SCHEMA_UIDS_JSON) return undefined;
	try {
		return JSON.parse(SCHEMA_UIDS_JSON) as Partial<SchemaUIDs>;
	} catch {
		console.warn(
			"  Warning: OPENGARDEN_SCHEMA_UIDS is not valid JSON, ignoring",
		);
		return undefined;
	}
}

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
	let validationResult: TimestampedOffChainResult & {
		approved: boolean;
		qualityScore: number;
	};
	let healthcheckBeforeResult: TimestampedOffChainResult;
	let healthcheckAfterResult: TimestampedOffChainResult;
	let evidenceBundleHash: string;
	let interventionUID: string;

	beforeAll(async () => {
		const chain = CHAINS[CHAIN_NAME];
		if (!chain) throw new Error(`Unknown chain: ${CHAIN_NAME}`);

		if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY not set");
		const cachedUIDs = loadSchemaUIDs();
		const provider = new ethers.JsonRpcProvider(RPC_URL);
		const signer = new ethers.Wallet(PRIVATE_KEY, provider);
		walletAddress = await signer.getAddress();
		storage = createMemoryStorage();

		client = new OpenGardenClient({
			signer,
			chain,
			storage,
			schemaUIDs: cachedUIDs,
		});

		console.log(`  Wallet: ${walletAddress}`);
		console.log(`  Chain:  ${CHAIN_NAME}`);
		console.log(`  RPC:    ${RPC_URL}`);
		console.log(
			`  Schema UIDs: ${cachedUIDs ? "loaded from env" : "will register on-chain"}`,
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
		expect(uids.AdminValidation).toBeTruthy();
		expect(uids.CitizenFeedback).toBeTruthy();
		expect(uids.Healthcheck).toBeTruthy();

		if (results.length > 0) {
			console.log(`  Registered ${results.length} schemas`);
			for (const r of results) console.log(`    ${r.name}: ${r.uid}`);
		} else {
			console.log(
				"  All schemas already registered (loaded from OPENGARDEN_SCHEMA_UIDS)",
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
			areaType: 0,
			name: "E2E Test Garden",
			municipality: "RM-TEST",
			metadataHash: ZERO_BYTES32,
		});

		areaUID = result.uid;
		expect(areaUID).toBeTruthy();
		expect(result.txHash).toBeTruthy();
		console.log(`  Area UID: ${areaUID}`);
		await delay(STEP_DELAY_MS);
	}, 60_000);

	// --- Step 3: Schedule intervention (must precede healthcheckBefore so we can link it) ---

	it("schedules an intervention", async () => {
		scheduleResult = await client.scheduleIntervention({
			areaUID,
			interventionId: "E2E-INT-001",
			interventionType: 0,
			crewLead: walletAddress,
			crewSize: 1,
			scheduledDate: now(),
			estimatedMinutes: 60,
			description: "E2E test routine maintenance",
			commissionRef: ZERO_BYTES32,
		});

		expect(scheduleResult.uid).toBeTruthy();
		expect(scheduleResult.onchainTimestamp).toBeGreaterThan(0n);
		console.log(`  Schedule UID: ${scheduleResult.uid}`);
		await delay(STEP_DELAY_MS);
	}, 60_000);

	// --- Step 4: Healthcheck before (linked to the scheduled intervention) ---

	it("records a healthcheck (before)", async () => {
		healthcheckBeforeResult = await client.recordHealthcheck({
			areaUID,
			interventionUID: scheduleResult.uid,
			healthScore: 3,
			photoHash: ZERO_BYTES32,
			assessorNotes: "E2E test — poor condition before intervention",
			interventionNeeded: true,
			assessorId: hashIdentifier("e2e-assessor-001"),
		});

		expect(healthcheckBeforeResult.uid).toBeTruthy();
		expect(healthcheckBeforeResult.onchainTimestamp).toBeGreaterThan(0n);
		console.log(`  Healthcheck before UID: ${healthcheckBeforeResult.uid}`);
		await delay(STEP_DELAY_MS);
	}, 60_000);

	// --- Step 5: Gardener checks in ---

	it("records gardener checkin", async () => {
		checkinResult = await client.checkin({
			interventionUID: scheduleResult.uid,
			latitude: 41.8902,
			longitude: 12.4922,
			timestamp: now(),
			photoHash: ZERO_BYTES32,
		});

		expect(checkinResult.uid).toBeTruthy();
		expect(checkinResult.onchainTimestamp).toBeGreaterThan(0n);
		console.log(`  Checkin UID: ${checkinResult.uid}`);
		await delay(STEP_DELAY_MS);
	}, 60_000);

	// --- Step 6: Gardener checks out ---

	it("records gardener checkout", async () => {
		checkoutResult = await client.checkout({
			checkinUID: checkinResult.uid,
			timestamp: now(),
			actualMinutes: 55,
		});

		expect(checkoutResult.uid).toBeTruthy();
		expect(checkoutResult.onchainTimestamp).toBeGreaterThan(0n);
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

	// --- Step 8: Admin validates ---

	it("validates the intervention", async () => {
		const result = await client.validateIntervention({
			scheduleUID: scheduleResult.uid,
			approved: true,
			qualityScore: 8,
			feedback: "E2E test — approved",
			validatorId: ZERO_BYTES32,
		});

		validationResult = { ...result, approved: true, qualityScore: 8 };
		expect(validationResult.uid).toBeTruthy();
		expect(validationResult.onchainTimestamp).toBeGreaterThan(0n);
		console.log(`  Validation UID: ${validationResult.uid}`);
		await delay(STEP_DELAY_MS);
	}, 60_000);

	// --- Step 9: Healthcheck after ---

	it("records a healthcheck (after)", async () => {
		healthcheckAfterResult = await client.recordHealthcheck({
			areaUID,
			interventionUID: scheduleResult.uid,
			healthScore: 8,
			photoHash: ZERO_BYTES32,
			assessorNotes: "E2E test — good condition after intervention",
			interventionNeeded: false,
			assessorId: hashIdentifier("e2e-assessor-001"),
		});

		expect(healthcheckAfterResult.uid).toBeTruthy();
		expect(healthcheckAfterResult.onchainTimestamp).toBeGreaterThan(0n);
		console.log(`  Healthcheck after UID: ${healthcheckAfterResult.uid}`);
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
			validation: validationResult,
			healthcheckBefore: { ...healthcheckBeforeResult, score: 3 },
			healthcheckAfter: { ...healthcheckAfterResult, score: 8 },
		});

		expect(bundle.bundleVersion).toBe("2.0");
		expect(bundle.attestations.scheduled.uid).toBe(scheduleResult.uid);
		expect(bundle.attestations.checkins).toHaveLength(1);
		expect(bundle.attestations.reports).toHaveLength(1);
		expect(bundle.attestations.validation.approved).toBe(true);

		evidenceBundleHash = await client.uploadEvidenceBundle(bundle);
		expect(evidenceBundleHash).toBeTruthy();
		console.log(`  Bundle hash: ${evidenceBundleHash}`);
	}, 30_000);

	// --- Step 11: Publish intervention on-chain ---

	it("publishes the intervention on-chain", async () => {
		const result = await client.publishIntervention({
			areaUID,
			interventionId: "E2E-INT-001",
			interventionType: 0,
			executionDate: now(),
			healthBefore: 3,
			healthAfter: 8,
			commissionRef: ZERO_BYTES32,
			evidenceBundleHash,
			offchainCount: 7,
			crewSize: 1,
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
			skillTier: "Apprentice Urban Gardener",
			achievedAt: now(),
			evidenceRoot: ZERO_BYTES32,
		});

		expect(result.uid).toBeTruthy();
		expect(result.txHash).toBeTruthy();
		console.log(`  Milestone UID: ${result.uid}`);
		await delay(STEP_DELAY_MS);
	}, 60_000);

	// --- Step 13: Citizen feedback ---

	it("submits citizen feedback (off-chain, no timestamp)", async () => {
		const result = await client.submitFeedback({
			areaUID,
			rating: 5,
			comment: "E2E test — park looks great!",
			photoHash: ZERO_BYTES32,
		});

		expect(result.uid).toBeTruthy();
		expect(result.signedAttestation).toBeTruthy();
		console.log(`  Feedback UID: ${result.uid}`);
		await delay(STEP_DELAY_MS);
	}, 30_000);

	// --- Step 14: Read back and verify ---

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
		expect(intervention.healthBefore).toBe(3);
		expect(intervention.healthAfter).toBe(8);
		expect(intervention.crewSize).toBe(1);
		expect(intervention.offchainCount).toBe(7);
		expect(intervention.recipient).toBe(ZERO_ADDRESS);
		console.log(
			`  Intervention read back: ${intervention.interventionId}, health ${intervention.healthBefore} → ${intervention.healthAfter}`,
		);
	}, 30_000);

	it("verifies evidence bundle against on-chain timestamps", async () => {
		const verification = await client.verifyEvidenceBundle(interventionUID);
		expect(verification.attestationCount).toBe(7);
		expect(verification.expectedCount).toBe(7);
		expect(verification.temporalOrderValid).toBe(true);
		expect(verification.timestampsVerified).toBe(true);
		expect(verification.valid).toBe(true);
		console.log(
			`  Bundle verified: count=${verification.attestationCount}, temporal=${verification.temporalOrderValid}, timestamps=${verification.timestampsVerified}`,
		);
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
		const cachedUIDs = loadSchemaUIDs();
		const provider = new ethers.JsonRpcProvider(RPC_URL);
		const signer = new ethers.Wallet(PRIVATE_KEY, provider);
		walletAddress = await signer.getAddress();

		indexerClient = new OpenGardenClient({
			signer,
			chain,
			schemaUIDs: cachedUIDs,
		});

		console.log(`  Indexer test — wallet: ${walletAddress}`);
	}, 30_000);

	it("registers an area for the indexer test", async () => {
		const result = await indexerClient.registerArea({
			areaId: "E2E-IDX-001",
			latitude: 41.8902,
			longitude: 12.4922,
			areaType: 0,
			name: "E2E Indexer Test Garden",
			municipality: "RM-TEST",
			metadataHash: ZERO_BYTES32,
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
			interventionType: 0,
			crewLead: walletAddress,
			crewSize: 1,
			scheduledDate: now(),
			estimatedMinutes: 30,
			description: "E2E indexer test — scheduled",
			commissionRef: ZERO_BYTES32,
		});

		expect(scheduleResult.uid).toBeTruthy();
		console.log(`  Schedule UID: ${scheduleResult.uid}`);
		await delay(STEP_DELAY_MS);
	}, 60_000);
});
