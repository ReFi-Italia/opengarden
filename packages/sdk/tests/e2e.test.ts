/**
 * E2E test — full intervention lifecycle on a testnet.
 *
 * Requires env vars (see .env.example):
 *   OPENGARDEN_TEST_PRIVATE_KEY  — funded testnet wallet
 *   OPENGARDEN_TEST_RPC_URL      — RPC endpoint (dedicated provider, not public RPC)
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
import { ActivityType, AreaType, InterventionType } from "../src/types/enums";
import type { TimestampedOffChainResult } from "../src/types/results";
import { hashInterventionScope } from "../src/utils";

const PRIVATE_KEY = process.env.OPENGARDEN_TEST_PRIVATE_KEY;
const RPC_URL =
	process.env.OPENGARDEN_TEST_RPC_URL || "https://sepolia.optimism.io";
const CHAIN_NAME = process.env.OPENGARDEN_TEST_CHAIN || "optimism-sepolia";

const CHAINS: Record<string, ChainConfig> = {
	"optimism-sepolia": OPTIMISM_SEPOLIA,
	"base-sepolia": BASE_SEPOLIA,
};

const skip = !PRIVATE_KEY;

// Pause between steps to avoid RPC rate limits and let on-chain timestamps
// increment between successive operations (required by §4.2 strict ordering).
const STEP_DELAY_MS = 2_000;
function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * In-memory storage adapter — bundles are keyed by their keccak256 hash and
 * retrieved in the same process. Verification can round-trip without IPFS.
 */
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

	// Shared state across ordered tests.
	const interventionId = `E2E-INT-${Date.now()}`;
	let areaUID: string;
	let scheduleResult: TimestampedOffChainResult;
	let checkinResult: TimestampedOffChainResult;
	let checkoutResult: TimestampedOffChainResult;
	let reportResult: TimestampedOffChainResult;
	let evidenceBundleHash: string;
	let interventionUID: string;
	let indexedCount = 0;

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
		console.log(`  InterventionId: ${interventionId}`);

		const balance = await provider.getBalance(walletAddress);
		console.log(`  Balance: ${ethers.formatEther(balance)} ETH`);
		if (balance === 0n)
			throw new Error("Wallet has no testnet ETH — fund it first");
	}, 30_000);

	// --- Step 1: Register schemas (skipped if UIDs provided via env) ---

	it("registers all four schemas", async () => {
		const results = await client.registerAllSchemas();

		const uids = client.getSchemaUIDs();
		expect(uids.AreaRegistration).toBeTruthy();
		expect(uids.Intervention).toBeTruthy();
		expect(uids.GardenerMilestone).toBeTruthy();
		expect(uids.Activity).toBeTruthy();

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
			areaId: `E2E-AREA-${Date.now()}`,
			latitude: 41.8902,
			longitude: 12.4922,
			areaType: AreaType.PublicGreenSpace,
			name: "E2E Test Garden",
			municipality: "RM-TEST",
			boundary: null,
			metadata: "",
		});

		areaUID = result.uid;
		expect(areaUID).toBeTruthy();
		expect(result.txHash).toBeTruthy();
		console.log(`  Area UID: ${areaUID}`);
		await delay(STEP_DELAY_MS);
	}, 60_000);

	// --- Step 3: Schedule intervention (Activity type=schedule) ---

	it("schedules an intervention (refUID = keccak256(interventionId))", async () => {
		scheduleResult = await client.scheduleIntervention({
			interventionId,
			areaUID,
			interventionType: InterventionType.RoutineMaintenance,
			crewLead: walletAddress,
			crewSize: 1,
			scheduledDate: now(),
			plannedDuration: 60,
			tasksPlanned: ["PRUNE", "CLEAN", "WATER"],
			description: "E2E test routine maintenance",
			commissionId: null,
		});

		expect(scheduleResult.uid).toBeTruthy();
		expect(scheduleResult.type).toBe("schedule");
		expect(scheduleResult.onchainTimestamp).toBeGreaterThan(0n);

		// Verify refUID is the intervention scope hash.
		const expectedScope = hashInterventionScope(interventionId);
		const refUID = (
			scheduleResult.signedAttestation.message as { refUID: string }
		).refUID;
		expect(refUID.toLowerCase()).toBe(expectedScope.toLowerCase());

		console.log(`  Schedule UID: ${scheduleResult.uid}`);
		console.log(`  Scope hash:   ${expectedScope}`);
		await delay(STEP_DELAY_MS);
	}, 60_000);

	// --- Step 4: Gardener checks in ---

	it("records gardener checkin with device-recorded message.time", async () => {
		const claimed = now();
		checkinResult = await client.checkin({
			interventionId,
			latitude: 41.8902,
			longitude: 12.4922,
			time: claimed,
		});

		expect(checkinResult.uid).toBeTruthy();
		expect(checkinResult.type).toBe("checkin");
		expect(checkinResult.onchainTimestamp).toBeGreaterThan(0n);
		const signedTime = BigInt(
			String(
				(checkinResult.signedAttestation.message as { time: unknown }).time,
			),
		);
		expect(signedTime).toBe(claimed);

		// Same scope hash as the schedule — confirms uniform linkage.
		const refUID = (
			checkinResult.signedAttestation.message as { refUID: string }
		).refUID;
		expect(refUID.toLowerCase()).toBe(
			hashInterventionScope(interventionId).toLowerCase(),
		);

		console.log(`  Checkin UID: ${checkinResult.uid}`);
		await delay(STEP_DELAY_MS);
	}, 60_000);

	// --- Step 5: Gardener checks out ---

	it("records gardener checkout with device-recorded message.time", async () => {
		const claimed = now();
		checkoutResult = await client.checkout({
			interventionId,
			latitude: 41.8902,
			longitude: 12.4922,
			time: claimed,
		});

		expect(checkoutResult.uid).toBeTruthy();
		expect(checkoutResult.type).toBe("checkout");
		expect(checkoutResult.onchainTimestamp).toBeGreaterThan(
			checkinResult.onchainTimestamp,
		);
		const signedTime = BigInt(
			String(
				(checkoutResult.signedAttestation.message as { time: unknown }).time,
			),
		);
		expect(signedTime).toBe(claimed);

		console.log(`  Checkout UID: ${checkoutResult.uid}`);
		await delay(STEP_DELAY_MS);
	}, 60_000);

	// --- Step 6: Gardener submits report ---

	it("submits a gardener report", async () => {
		reportResult = await client.submitReport({
			interventionId,
			tasksCompleted: ["PRUNE", "CLEAN", "WATER"],
			reportedEffort: 55,
			mediaCID: "",
			notes: "E2E test — all tasks completed successfully",
		});

		expect(reportResult.uid).toBeTruthy();
		expect(reportResult.type).toBe("report");
		expect(reportResult.onchainTimestamp).toBeGreaterThan(
			checkoutResult.onchainTimestamp,
		);
		console.log(`  Report UID: ${reportResult.uid}`);
		await delay(STEP_DELAY_MS);
	}, 60_000);

	// --- Step 7: Periodic healthcheck (area-scoped, independent of intervention) ---

	it("records an area healthcheck (refUID = areaUID, not scope hash)", async () => {
		const healthcheckResult = await client.recordHealthcheck({
			areaUID,
			healthScore: 8,
			mediaCID: "",
			notes: "Post-intervention spot check",
		});

		expect(healthcheckResult.uid).toBeTruthy();
		expect(healthcheckResult.type).toBe("healthcheck");
		expect(healthcheckResult.onchainTimestamp).toBeGreaterThan(0n);

		const refUID = (
			healthcheckResult.signedAttestation.message as { refUID: string }
		).refUID;
		// Healthcheck routes refUID to Area, not the intervention scope hash.
		expect(refUID.toLowerCase()).toBe(areaUID.toLowerCase());

		console.log(`  Healthcheck UID: ${healthcheckResult.uid}`);
		await delay(STEP_DELAY_MS);
	}, 60_000);

	// --- Step 8: Finalize — the canonical path (preflight → build → upload → index → publish) ---

	it("finalizeIntervention orchestrates the full commit-settle flow in one call", async () => {
		const result = await client.finalizeIntervention({
			interventionId,
			areaUID,
			schedule: scheduleResult,
			crewActivities: [checkinResult, checkoutResult, reportResult],
			interventionType: InterventionType.RoutineMaintenance,
			executionDate: now(),
			commissionId: null,
		});

		// Bundle shape
		expect(result.bundle.bundleVersion).toBe(EVIDENCE_BUNDLE_VERSION);
		expect(result.bundle.interventionId).toBe(interventionId);
		expect(result.bundle.areaUID).toBe(areaUID);
		expect(result.bundle.activities).toHaveLength(4);
		const types = result.bundle.activities.map((a) => a.type).sort();
		expect(types).toEqual(["checkin", "checkout", "report", "schedule"]);
		// Ascending onchainTimestamp ordering
		for (let i = 1; i < result.bundle.activities.length; i++) {
			expect(
				result.bundle.activities[i].onchainTimestamp,
			).toBeGreaterThanOrEqual(
				result.bundle.activities[i - 1].onchainTimestamp,
			);
		}

		// Upload
		evidenceBundleHash = result.evidenceBundleHash;
		expect(evidenceBundleHash).toBeTruthy();

		// Indexer — 4 submissions (schedule + 3 crew). Healthcheck not bundled.
		indexedCount = result.indexedCount;
		expect(result.indexingResults).toHaveLength(4);

		// Publication
		interventionUID = result.publication.uid;
		expect(interventionUID).toBeTruthy();
		expect(result.publication.txHash).toBeTruthy();

		console.log(`  Bundle hash:     ${evidenceBundleHash}`);
		console.log(`  Indexed:         ${indexedCount}/4 activities`);
		console.log(`  Intervention UID: ${interventionUID}`);
		await delay(STEP_DELAY_MS);
	}, 120_000);

	// --- Step 10: Mint milestone ---

	it("mints a gardener milestone (soulbound, addressed to wallet)", async () => {
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

	// --- Step 11: Read back and verify ---

	it("reads back the area", async () => {
		const area = await client.getArea(areaUID);
		expect(area.name).toBe("E2E Test Garden");
		expect(area.latitude).toBeCloseTo(41.8902, 4);
		expect(area.longitude).toBeCloseTo(12.4922, 4);
		expect(area.attester.toLowerCase()).toBe(walletAddress.toLowerCase());
		console.log(`  Area read back: ${area.areaId} — ${area.name}`);
	}, 30_000);

	it("reads back the intervention", async () => {
		const intervention = await client.getIntervention(interventionUID);
		expect(intervention.interventionId).toBe(interventionId);
		expect(intervention.areaUID.toLowerCase()).toBe(areaUID.toLowerCase());
		expect(intervention.recipient.toLowerCase()).toBe(
			ZERO_ADDRESS.toLowerCase(),
		);
		console.log(
			`  Intervention read back: ${intervention.interventionId}, area=${intervention.areaUID}`,
		);
	}, 30_000);

	it("verifies the evidence bundle end-to-end against on-chain state", async () => {
		const verification = await client.verifyEvidenceBundle(interventionUID);

		console.log(
			`  Bundle verified: sigs=${verification.signaturesValid}, payloads=${verification.payloadIntegrityValid}, timestamps=${verification.timestampsVerified}, scope=${verification.interventionScopeValid}, temporal=${verification.temporalOrderValid}, bracket=${verification.executionDateBracketed}`,
		);
		for (const check of verification.checks) {
			if (!check.valid) {
				console.log(`    FAIL [${check.code}] ${check.message}`);
			}
		}

		expect(verification.bundleVersionValid).toBe(true);
		expect(verification.signaturesValid).toBe(true);
		expect(verification.payloadIntegrityValid).toBe(true);
		expect(verification.timestampsVerified).toBe(true);
		expect(verification.interventionScopeValid).toBe(true);
		expect(verification.temporalOrderValid).toBe(true);
		expect(verification.executionDateBracketed).toBe(true);
		expect(verification.valid).toBe(true);
	}, 60_000);

	// --- Step 12: Scope-hash query returns all lifecycle activities ---

	it("getInterventionActivities returns every lifecycle activity under the scope hash", async () => {
		// easscan off-chain store has per-attestation propagation delay. Poll
		// until all 4 lifecycle activities appear or timeout.
		const expected = 4;
		const scope = hashInterventionScope(interventionId);
		let activities = await client.getInterventionActivities(interventionId);
		const deadline = Date.now() + 30_000;
		while (activities.length < expected && Date.now() < deadline) {
			await delay(3_000);
			activities = await client.getInterventionActivities(interventionId);
		}
		console.log(`  Found ${activities.length} activities under the scope hash`);

		// indexingResults reported success during finalize — easscan SHOULD have
		// them. If it doesn't within 30s, flag but don't fail (indexer SLA is
		// external to protocol correctness).
		if (activities.length < expected) {
			console.log(
				`    (easscan lag — got ${activities.length}/${expected}, skipping strict assert)`,
			);
			return;
		}

		const types = activities.map((a) => a.activityType).sort();
		expect(types).toEqual([
			ActivityType.Schedule,
			ActivityType.Checkin,
			ActivityType.Checkout,
			ActivityType.Report,
		].sort());

		for (const a of activities) {
			expect(a.refUID.toLowerCase()).toBe(scope.toLowerCase());
			expect(a.revoked).toBe(false);
		}
	}, 60_000);
});
