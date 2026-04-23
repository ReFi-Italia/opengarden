import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { OpenGardenClient } from "../src/client";
import {
	EVIDENCE_BUNDLE_VERSION,
	SCHEMA_NAME_UID,
	ZERO_ADDRESS,
	ZERO_BYTES32,
} from "../src/constants";
import { OpenGardenError, OpenGardenErrorCode } from "../src/errors";
import {
	LENIENT_FINALIZE_POLICY,
	PROTOCOL_ONLY_VERIFY_POLICY,
	finalizePolicy,
	verifyPolicy,
} from "../src/policy";
import { FinalizeInputIssueCode } from "../src/preflight";
import {
	decodeActivityData,
	encodeActivityData,
	encodeIntervention,
	initEncoders,
} from "../src/schemas/encoders";
import type { ChainConfig } from "../src/types/config";
import {
	ActivityType,
	InterventionType,
	activityTypeFromName,
} from "../src/types/enums";
import type {
	BundleActivity,
	EvidenceBundle,
} from "../src/types/evidence";
import {
	hashActivityPayload,
	hashInterventionScope,
} from "../src/utils";
import { VerificationCheckCode } from "../src/verification";
import {
	DEFAULT_TEST_CHAIN,
	FAKE_TX_RECEIPT,
	MOCK_SIGNER_ADDRESS,
	createMockSigner,
	createTestClient,
	createTestConfig,
	makeFakeActivityResult,
} from "./_helpers";

beforeAll(async () => {
	await initEncoders();
});

const TEST_CHAIN = DEFAULT_TEST_CHAIN;
const INTERVENTION_ID = "INT-2026-0001";
const AREA_UID =
	"0x000000000000000000000000000000000000000000000000000000000000abcd";
const ORG = "0x000000000000000000000000000000000000000000000000000000000000b055";
const ALICE = "0x000000000000000000000000000000000000a1ce";
const BOB = "0x0000000000000000000000000000000000000b0b";

// --- Mocking helpers ---

interface OffchainSignedArgs {
	schema: string;
	recipient: string;
	time: bigint;
	expirationTime: bigint;
	revocable: boolean;
	refUID: string;
	data: string;
}

function makeMockSignedAttestation(args: OffchainSignedArgs, uid: string) {
	return {
		version: 1,
		uid,
		signer: MOCK_SIGNER_ADDRESS,
		message: {
			schema: args.schema,
			recipient: args.recipient,
			time: args.time,
			expirationTime: args.expirationTime,
			revocable: args.revocable,
			refUID: args.refUID,
			data: args.data,
		},
		signature: { r: "0x", s: "0x", v: 27 },
	};
}

/**
 * Builds an EAS mock that captures every `signOffchainAttestation` call,
 * stamps the attestation with a deterministic UID derived from the call
 * index, and returns `timestamp()` results the caller can inspect.
 */
function mockOffchainEas(opts?: {
	timestampTs?: (uid: string) => bigint;
}) {
	const signCalls: OffchainSignedArgs[] = [];
	const timestampCalls: string[] = [];
	let signCounter = 0;

	const eas = {
		getOffchain: async () => ({
			signOffchainAttestation: async (args: OffchainSignedArgs) => {
				signCalls.push(args);
				const uid = `0xsigned_${signCounter++}`;
				return makeMockSignedAttestation(args, uid);
			},
			verifyOffchainAttestationSignature: () => true,
		}),
		timestamp: async (uid: string) => {
			timestampCalls.push(uid);
			return {
				wait: async () =>
					opts?.timestampTs ? opts.timestampTs(uid) : 1_700_000_000n,
				receipt: FAKE_TX_RECEIPT,
			};
		},
		getTimestamp: async (uid: string) =>
			opts?.timestampTs ? opts.timestampTs(uid) : 1_700_000_000n,
	};

	// biome-ignore lint/suspicious/noExplicitAny: test stub cast
	return { eas: eas as any, signCalls, timestampCalls };
}

// ============================================================================
// Construction
// ============================================================================

describe("OpenGardenClient construction", () => {
	it("throws SIGNER_ERROR when signer is missing", () => {
		try {
			new OpenGardenClient(
				createTestConfig({
					// biome-ignore lint/suspicious/noExplicitAny: intentional bad input
					signer: undefined as any,
				}),
			);
			throw new Error("expected throw");
		} catch (e) {
			expect(e).toBeInstanceOf(OpenGardenError);
			expect((e as OpenGardenError).code).toBe(
				OpenGardenErrorCode.SIGNER_ERROR,
			);
		}
	});

	it("constructs with valid config", () => {
		const client = createTestClient();
		expect(client).toBeInstanceOf(OpenGardenClient);
	});

	it("accepts pre-registered schema UIDs", () => {
		const client = createTestClient({
			schemaUIDs: { AreaRegistration: "0xareaschema" },
		});
		expect(client.getSchemaUIDs().AreaRegistration).toBe("0xareaschema");
	});

	it("resolves known chain name via built-in registry", () => {
		const client = createTestClient({ chain: "optimism-mainnet" });
		expect(client).toBeInstanceOf(OpenGardenClient);
	});

	it("throws INVALID_INPUT for unknown chain name", () => {
		try {
			createTestClient({
				// biome-ignore lint/suspicious/noExplicitAny: intentional bad input
				chain: "not-a-chain" as any,
			});
			throw new Error("expected throw");
		} catch (e) {
			expect(e).toBeInstanceOf(OpenGardenError);
			expect((e as OpenGardenError).code).toBe(
				OpenGardenErrorCode.INVALID_INPUT,
			);
		}
	});

	it("lets explicit config.schemaUIDs override chain defaults", () => {
		const client = createTestClient({
			chain: "optimism-sepolia",
			schemaUIDs: { AreaRegistration: "0xoverride" },
		});
		expect(client.getSchemaUIDs().AreaRegistration).toBe("0xoverride");
	});

	it("getSchemaUIDs returns a copy, not the internal reference", () => {
		const client = createTestClient({
			schemaUIDs: { AreaRegistration: "0xorig" },
		});
		const copy = client.getSchemaUIDs();
		copy.AreaRegistration = "0xmutated";
		expect(client.getSchemaUIDs().AreaRegistration).toBe("0xorig");
	});
});

// ============================================================================
// Schema validation
// ============================================================================

describe("OpenGardenClient schema-not-registered errors", () => {
	it("throws SCHEMA_NOT_REGISTERED when registerArea is called without UID", async () => {
		const client = createTestClient({ schemaUIDs: {} });
		try {
			await client.registerArea({
				areaId: "RM-X",
				latitude: 0,
				longitude: 0,
				areaType: 1,
				name: "",
				municipality: "",
				boundary: null,
				metadata: "",
			});
			throw new Error("expected throw");
		} catch (e) {
			expect((e as OpenGardenError).code).toBe(
				OpenGardenErrorCode.SCHEMA_NOT_REGISTERED,
			);
		}
	});

	it("throws SCHEMA_NOT_REGISTERED for Activity when scheduleIntervention is called without UID", async () => {
		const client = createTestClient({ schemaUIDs: {} });
		try {
			await client.scheduleIntervention({
				interventionId: INTERVENTION_ID,
				areaUID: AREA_UID,
				interventionType: InterventionType.RoutineMaintenance,
				crewLead: ALICE,
				crewSize: 1,
				scheduledDate: 1_700_000_000n,
				plannedDuration: 60,
				tasksPlanned: [],
				description: "",
				commissionId: null,
			});
			throw new Error("expected throw");
		} catch (e) {
			expect((e as OpenGardenError).code).toBe(
				OpenGardenErrorCode.SCHEMA_NOT_REGISTERED,
			);
		}
	});
});

// ============================================================================
// Endpoint overrides + storage validation
// ============================================================================

describe("OpenGardenClient endpoint overrides", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("uses explicit graphqlUrl override for read queries", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			json: async () => ({ data: { attestations: [] } }),
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = createTestClient({
			schemaUIDs: { Intervention: "0xschema" },
			graphqlUrl: "https://custom.example/graphql",
		});
		await client.getAreaInterventions(AREA_UID);

		expect(fetchMock.mock.calls[0][0]).toBe("https://custom.example/graphql");
	});

	it("override works for chains with no built-in GraphQL default", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			json: async () => ({ data: { attestations: [] } }),
		});
		vi.stubGlobal("fetch", fetchMock);

		const unknownChain: ChainConfig = {
			chainId: 99999n,
			easAddress: "0x4200000000000000000000000000000000000021",
			schemaRegistryAddress: "0x4200000000000000000000000000000000000020",
		};

		const client = createTestClient({
			chain: unknownChain,
			schemaUIDs: { Intervention: "0xschema" },
			graphqlUrl: "https://private.example.com/graphql",
		});
		await client.getAreaInterventions(AREA_UID);

		expect(fetchMock.mock.calls[0][0]).toBe(
			"https://private.example.com/graphql",
		);
	});

	it("uses explicit storeUrl override for bundle indexing", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true });
		vi.stubGlobal("fetch", fetchMock);

		const client = createTestClient({
			schemaUIDs: { Activity: "0xschema" },
			storeUrl: "https://custom-store.example/offchain",
		});

		const schedule = makeFakeActivityResult("0xsched", "schedule", {
			attester: ORG,
		});
		const results = await client.indexBundleAttestations({
			interventionId: INTERVENTION_ID,
			areaUID: AREA_UID,
			schedule,
			crewActivities: [],
		});

		expect(results).toHaveLength(1);
		expect(fetchMock.mock.calls[0][0]).toBe(
			"https://custom-store.example/offchain",
		);
	});

	it("returns empty indexer results when chain has no store endpoint", async () => {
		const unknownChain: ChainConfig = {
			chainId: 99999n,
			easAddress: "0x0",
			schemaRegistryAddress: "0x0",
		};
		const client = createTestClient({
			chain: unknownChain,
			schemaUIDs: { Activity: "0xschema" },
		});

		const schedule = makeFakeActivityResult("0xsched", "schedule");
		const results = await client.indexBundleAttestations({
			interventionId: INTERVENTION_ID,
			areaUID: AREA_UID,
			schedule,
			crewActivities: [],
		});

		expect(results).toEqual([]);
	});
});

describe("OpenGardenClient storage validation", () => {
	it("throws STORAGE_NOT_CONFIGURED when uploading without adapter", async () => {
		const client = createTestClient();
		try {
			// biome-ignore lint/suspicious/noExplicitAny: intentional bad input
			await client.uploadEvidenceBundle({} as any);
			throw new Error("expected throw");
		} catch (e) {
			expect((e as OpenGardenError).code).toBe(
				OpenGardenErrorCode.STORAGE_NOT_CONFIGURED,
			);
		}
	});

	it("throws STORAGE_NOT_CONFIGURED when verifying without adapter", async () => {
		const client = createTestClient();
		try {
			await client.verifyEvidenceBundle("0xanyuid");
			throw new Error("expected throw");
		} catch (e) {
			expect((e as OpenGardenError).code).toBe(
				OpenGardenErrorCode.STORAGE_NOT_CONFIGURED,
			);
		}
	});
});

// ============================================================================
// Schema registration + naming
// ============================================================================

describe("OpenGardenClient schema registration + naming", () => {
	const FAKE_SCHEMA_UID =
		"0x0000000000000000000000000000000000000000000000000000000000000abc";

	function createSchemaClient(overrides?: {
		attestThrows?: boolean;
		schemaUIDs?: Partial<Record<string, string>>;
	}) {
		const attestCalls: Array<{
			schema: string;
			data: { refUID: string; revocable: boolean };
		}> = [];
		const registerCalls: Array<{ schema: string; revocable: boolean }> = [];
		const client = createTestClient({
			schemaUIDs: overrides?.schemaUIDs,
			// biome-ignore lint/suspicious/noExplicitAny: test stub cast
			registry: {
				register: async (params: {
					schema: string;
					revocable: boolean;
				}) => {
					registerCalls.push(params);
					return {
						wait: async () => FAKE_SCHEMA_UID,
						receipt: FAKE_TX_RECEIPT,
					};
				},
			} as any,
			// biome-ignore lint/suspicious/noExplicitAny: test stub cast
			eas: {
				attest: async (params: {
					schema: string;
					data: { refUID: string; revocable: boolean };
				}) => {
					if (overrides?.attestThrows) {
						throw new Error("naming schema unavailable");
					}
					attestCalls.push(params);
					return {
						wait: async () => "0xnameuid",
						receipt: FAKE_TX_RECEIPT,
					};
				},
			} as any,
		});
		return { client, attestCalls, registerCalls };
	}

	it("registerSchema persists UID and attests the schema name", async () => {
		const { client, attestCalls } = createSchemaClient();
		const result = await client.registerSchema("AreaRegistration");

		expect(result.uid).toBe(FAKE_SCHEMA_UID);
		expect(result.name).toBe("AreaRegistration");
		expect(result.txHash).toBe("0xtxhash");
		expect(client.getSchemaUIDs().AreaRegistration).toBe(FAKE_SCHEMA_UID);

		expect(attestCalls).toHaveLength(1);
		expect(attestCalls[0].schema).toBe(SCHEMA_NAME_UID);
		expect(attestCalls[0].data.refUID).toBe(ZERO_BYTES32);
		expect(attestCalls[0].data.revocable).toBe(true);
	});

	it("registerAllSchemas registers all 4 schemas", async () => {
		const { client, registerCalls, attestCalls } = createSchemaClient();
		const results = await client.registerAllSchemas();

		expect(results).toHaveLength(4);
		const names = results.map((r) => r.name).sort();
		expect(names).toEqual([
			"Activity",
			"AreaRegistration",
			"GardenerMilestone",
			"Intervention",
		]);
		expect(registerCalls).toHaveLength(4);
		expect(attestCalls).toHaveLength(4);
	});

	it("skips already-registered schemas but names new ones", async () => {
		const { client, registerCalls } = createSchemaClient({
			schemaUIDs: {
				AreaRegistration: "0xexisting1",
				Intervention: "0xexisting2",
				GardenerMilestone: "0xexisting3",
			},
		});
		const results = await client.registerAllSchemas();

		expect(results).toHaveLength(1);
		expect(results[0].name).toBe("Activity");
		expect(registerCalls).toHaveLength(1);
	});

	it("registers the schema even when naming is unavailable on chain", async () => {
		const { client } = createSchemaClient({ attestThrows: true });
		const result = await client.registerSchema("AreaRegistration");
		expect(result.uid).toBe(FAKE_SCHEMA_UID);
	});

	it("Activity schema is registered with revocable: true", async () => {
		const { client, registerCalls } = createSchemaClient();
		await client.registerSchema("Activity");
		const activityCall = registerCalls.find(() => true);
		expect(activityCall?.revocable).toBe(true);
	});
});

// ============================================================================
// Off-chain Activity writes (scheduleIntervention / checkin / checkout / submitReport / recordHealthcheck)
// ============================================================================

describe("OpenGardenClient off-chain Activity writes", () => {
	function createActivityClient() {
		const mock = mockOffchainEas({ timestampTs: () => 1_700_000_000n });
		const client = createTestClient({
			schemaUIDs: { Activity: "0xactivityschema" },
			eas: mock.eas,
		});
		return { client, ...mock };
	}

	it("scheduleIntervention signs with refUID = keccak256(interventionId)", async () => {
		const { client, signCalls } = createActivityClient();
		await client.scheduleIntervention({
			interventionId: INTERVENTION_ID,
			areaUID: AREA_UID,
			interventionType: InterventionType.RoutineMaintenance,
			crewLead: ALICE,
			crewSize: 1,
			scheduledDate: 1_700_000_100n,
			plannedDuration: 60,
			tasksPlanned: [],
			description: "",
			commissionId: null,
		});

		expect(signCalls).toHaveLength(1);
		expect(signCalls[0].refUID).toBe(hashInterventionScope(INTERVENTION_ID));
		expect(signCalls[0].recipient).toBe(ALICE);
	});

	it("scheduleIntervention commits the correct activityType + payloadHash in data", async () => {
		const { client, signCalls } = createActivityClient();
		const input = {
			interventionId: INTERVENTION_ID,
			areaUID: AREA_UID,
			interventionType: InterventionType.RoutineMaintenance,
			crewLead: ALICE,
			crewSize: 2,
			scheduledDate: 1_700_000_100n,
			plannedDuration: 90,
			tasksPlanned: ["PRUNE"],
			description: "Test",
			commissionId: null,
		};
		await client.scheduleIntervention(input);

		const { activityType, payloadHash } = decodeActivityData(signCalls[0].data);
		expect(activityType).toBe(ActivityType.Schedule);
		// Payload is built canonically inside the client; the committed hash MUST
		// match what a verifier would compute over the rebuilt payload.
		const rebuiltPayload = {
			interventionId: INTERVENTION_ID,
			areaUID: AREA_UID,
			interventionType: InterventionType.RoutineMaintenance,
			scheduledDate: 1_700_000_100,
			plannedDuration: 90,
			tasksPlanned: ["PRUNE"],
			description: "Test",
			commissionRef: ZERO_BYTES32,
			crewSize: 2,
		};
		expect(payloadHash.toLowerCase()).toBe(
			hashActivityPayload(rebuiltPayload).toLowerCase(),
		);
	});

	it("checkin signs with refUID = keccak256(interventionId) and ZERO_ADDRESS recipient", async () => {
		const { client, signCalls } = createActivityClient();
		await client.checkin({
			interventionId: INTERVENTION_ID,
			latitude: 41.89,
			longitude: 12.4964,
		});
		expect(signCalls[0].refUID).toBe(hashInterventionScope(INTERVENTION_ID));
		expect(signCalls[0].recipient).toBe(ZERO_ADDRESS);
		expect(decodeActivityData(signCalls[0].data).activityType).toBe(
			ActivityType.Checkin,
		);
	});

	it("checkout signs with ActivityType.Checkout + scope refUID", async () => {
		const { client, signCalls } = createActivityClient();
		await client.checkout({
			interventionId: INTERVENTION_ID,
		});
		expect(decodeActivityData(signCalls[0].data).activityType).toBe(
			ActivityType.Checkout,
		);
		expect(signCalls[0].refUID).toBe(hashInterventionScope(INTERVENTION_ID));
	});

	it("submitReport signs with ActivityType.Report + scope refUID", async () => {
		const { client, signCalls } = createActivityClient();
		await client.submitReport({
			interventionId: INTERVENTION_ID,
			tasksCompleted: ["PRUNE"],
			reportedEffort: 0,
			mediaCID: "",
			notes: "",
		});
		expect(decodeActivityData(signCalls[0].data).activityType).toBe(
			ActivityType.Report,
		);
		expect(signCalls[0].refUID).toBe(hashInterventionScope(INTERVENTION_ID));
	});

	it("recordHealthcheck uses areaUID as refUID (not the intervention scope hash)", async () => {
		const { client, signCalls } = createActivityClient();
		await client.recordHealthcheck({
			areaUID: AREA_UID,
			healthScore: 8,
			mediaCID: "",
			notes: "",
		});
		expect(signCalls[0].refUID).toBe(AREA_UID);
		expect(decodeActivityData(signCalls[0].data).activityType).toBe(
			ActivityType.Healthcheck,
		);
	});

	it("checkin uses explicit `time` in message.time (device-recorded moment)", async () => {
		const { client, signCalls } = createActivityClient();
		await client.checkin({
			interventionId: INTERVENTION_ID,
			latitude: 41.89,
			longitude: 12.4964,
			time: 1_700_000_050n,
		});
		expect(signCalls[0].time).toBe(1_700_000_050n);
	});

	it("checkin accepts a Date for `time` and converts to Unix seconds", async () => {
		const { client, signCalls } = createActivityClient();
		await client.checkin({
			interventionId: INTERVENTION_ID,
			latitude: 41.89,
			longitude: 12.4964,
			time: new Date("2024-03-01T00:00:00.000Z"),
		});
		expect(signCalls[0].time).toBe(1709251200n);
	});

	it("falls back to wall-clock when `time` is omitted", async () => {
		const { client, signCalls } = createActivityClient();
		const before = Math.floor(Date.now() / 1000);
		await client.checkin({
			interventionId: INTERVENTION_ID,
			latitude: 41.89,
			longitude: 12.4964,
		});
		const after = Math.floor(Date.now() / 1000);
		const t = Number(signCalls[0].time);
		expect(t).toBeGreaterThanOrEqual(before);
		expect(t).toBeLessThanOrEqual(after);
	});

	it("returns a TimestampedOffChainResult with type + payload populated", async () => {
		const { client } = createActivityClient();
		const result = await client.checkout({
			interventionId: INTERVENTION_ID,
			latitude: 41.89,
			longitude: 12.4964,
		});
		expect(result.type).toBe("checkout");
		expect(result.payload).toEqual({ latitude: 41890000, longitude: 12496400 });
		expect(result.attester).toBe(MOCK_SIGNER_ADDRESS);
		expect(result.uid).toMatch(/^0xsigned_/);
	});

	it("signActivity timestamps the UID on chain", async () => {
		const { client, timestampCalls } = createActivityClient();
		await client.checkin({
			interventionId: INTERVENTION_ID,
			latitude: 41.89,
			longitude: 12.4964,
		});
		expect(timestampCalls).toHaveLength(1);
		expect(timestampCalls[0]).toMatch(/^0xsigned_/);
	});
});

// ============================================================================
// indexBundleAttestations
// ============================================================================

describe("OpenGardenClient indexBundleAttestations", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function buildInput() {
		return {
			interventionId: INTERVENTION_ID,
			areaUID: AREA_UID,
			schedule: makeFakeActivityResult("0xsched", "schedule", {
				attester: ORG,
			}),
			crewActivities: [
				makeFakeActivityResult("0xci", "checkin", { attester: ALICE }),
				makeFakeActivityResult("0xco", "checkout", { attester: ALICE }),
				makeFakeActivityResult("0xrp", "report", { attester: ALICE }),
			],
		};
	}

	it("submits schedule + every crew activity to the configured store", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true });
		vi.stubGlobal("fetch", fetchMock);

		const client = createTestClient({
			schemaUIDs: { Activity: "0xschema" },
		});
		const results = await client.indexBundleAttestations(buildInput());

		expect(results).toHaveLength(4);
		expect(results.map((r) => r.role)).toEqual([
			"schedule",
			"checkin",
			"checkout",
			"report",
		]);
		expect(results.every((r) => r.ok)).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});

	it("skips healthcheck activities (area-scoped, not bundled)", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true });
		vi.stubGlobal("fetch", fetchMock);

		const client = createTestClient({
			schemaUIDs: { Activity: "0xschema" },
		});
		const input = buildInput();
		input.crewActivities.push(
			makeFakeActivityResult("0xhc", "healthcheck", { attester: ALICE }),
		);
		const results = await client.indexBundleAttestations(input);

		// 1 schedule + 3 crew = 4 (healthcheck skipped)
		expect(results).toHaveLength(4);
		expect(results.map((r) => r.uid)).not.toContain("0xhc");
	});

	it("serializes BigInt values as strings in indexer payload", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true });
		vi.stubGlobal("fetch", fetchMock);

		const client = createTestClient({
			schemaUIDs: { Activity: "0xschema" },
		});
		await client.indexBundleAttestations(buildInput());

		const envelope = JSON.parse(fetchMock.mock.calls[0][1].body);
		const pkg = JSON.parse(envelope.textJson);
		expect(typeof pkg.sig.message.time).toBe("string");
	});

	it("surfaces per-activity errors on non-200 response", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
			text: async () => "internal server error",
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = createTestClient({
			schemaUIDs: { Activity: "0xschema" },
		});
		const results = await client.indexBundleAttestations(buildInput());
		expect(results.every((r) => !r.ok)).toBe(true);
		expect(results[0].error).toMatch(/HTTP 500/);
	});

	it("returns empty array when chain has no store endpoint", async () => {
		const unknownChain: ChainConfig = {
			chainId: 99999n,
			easAddress: "0x0",
			schemaRegistryAddress: "0x0",
		};
		const client = createTestClient({
			chain: unknownChain,
			schemaUIDs: { Activity: "0xschema" },
		});
		const results = await client.indexBundleAttestations(buildInput());
		expect(results).toEqual([]);
	});
});

// ============================================================================
// finalizeIntervention
// ============================================================================

describe("OpenGardenClient finalizeIntervention", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function buildValidInput() {
		const scope = hashInterventionScope(INTERVENTION_ID);
		return {
			interventionId: INTERVENTION_ID,
			areaUID: AREA_UID,
			schedule: makeFakeActivityResult("0xsched", "schedule", {
				onchainTimestamp: 100n,
				refUID: scope,
				attester: ORG,
				payload: {
					interventionId: INTERVENTION_ID,
					areaUID: AREA_UID,
					interventionType: 1,
					scheduledDate: 100,
					plannedDuration: 60,
					tasksPlanned: [],
					description: "",
					commissionRef: ZERO_BYTES32,
					crewSize: 1,
				},
			}),
			crewActivities: [
				makeFakeActivityResult("0xci", "checkin", {
					onchainTimestamp: 200n,
					refUID: scope,
					attester: ALICE,
					payload: { latitude: 41890000, longitude: 12492000 },
				}),
				makeFakeActivityResult("0xco", "checkout", {
					onchainTimestamp: 300n,
					refUID: scope,
					attester: ALICE,
					payload: {},
				}),
				makeFakeActivityResult("0xrp", "report", {
					onchainTimestamp: 400n,
					refUID: scope,
					attester: ALICE,
					payload: {
						tasksCompleted: ["PRUNE"],
						reportedEffort: 45,
						mediaCID: "",
						notes: "",
					},
				}),
			],
			interventionType: InterventionType.RoutineMaintenance,
			executionDate: 1_000_000n,
			commissionId: null,
		};
	}

	function createFinalizeClient() {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true });
		vi.stubGlobal("fetch", fetchMock);

		const storageMock = {
			upload: vi.fn().mockResolvedValue("0xbundlehash"),
			download: vi.fn(),
		};

		const attestCalls: Array<{ data: { data: string } }> = [];
		const client = createTestClient({
			schemaUIDs: { Intervention: "0xinterventionschema", Activity: "0xact" },
			storage: storageMock,
			// biome-ignore lint/suspicious/noExplicitAny: test stub cast
			eas: {
				attest: async (p: { data: { data: string } }) => {
					attestCalls.push(p);
					return {
						wait: async () => "0xpublishuid",
						receipt: FAKE_TX_RECEIPT,
					};
				},
			} as any,
		});
		return { client, storageMock, attestCalls, fetchMock };
	}

	it("builds, uploads, indexes, and publishes in one call", async () => {
		const { client, storageMock, attestCalls } = createFinalizeClient();
		const result = await client.finalizeIntervention(buildValidInput());

		expect(storageMock.upload).toHaveBeenCalledTimes(1);
		expect(result.bundle.bundleVersion).toBe(EVIDENCE_BUNDLE_VERSION);
		expect(result.evidenceBundleHash).toBe("0xbundlehash");
		expect(result.indexedCount).toBe(4);
		expect(result.publication.uid).toBe("0xpublishuid");
		expect(attestCalls).toHaveLength(1);
	});

	it("throws INVALID_INPUT when executionDate is before schedule timestamp", async () => {
		const { client } = createFinalizeClient();
		const input = buildValidInput();
		input.executionDate = 50n;
		try {
			await client.finalizeIntervention(input);
			throw new Error("expected throw");
		} catch (e) {
			expect((e as OpenGardenError).code).toBe(
				OpenGardenErrorCode.INVALID_INPUT,
			);
		}
	});

	it("LENIENT_FINALIZE_POLICY publishes despite preflight issues", async () => {
		const { client } = createFinalizeClient();
		const input = buildValidInput();
		input.executionDate = 50n; // STRICT would block
		const result = await client.finalizeIntervention(input, {
			policy: LENIENT_FINALIZE_POLICY,
		});
		expect(result.publication.uid).toBe("0xpublishuid");
	});

	it("custom policy blocks only selected issue codes", async () => {
		const { client } = createFinalizeClient();
		const input = buildValidInput();
		input.crewActivities = [];
		const policy = finalizePolicy({
			blocking: [FinalizeInputIssueCode.EMPTY_CREW],
		});
		try {
			await client.finalizeIntervention(input, { policy });
			throw new Error("expected throw");
		} catch (e) {
			expect((e as Error).message).toContain("EMPTY_CREW");
		}
	});

	it("published bundle contains canonical schedule + crew activities", async () => {
		const { client, storageMock } = createFinalizeClient();
		await client.finalizeIntervention(buildValidInput());
		const [serialized] = storageMock.upload.mock.calls[0];
		const bundle = JSON.parse(serialized) as EvidenceBundle;
		expect(bundle.activities).toHaveLength(4);
		expect(bundle.activities.map((a) => a.type).sort()).toEqual([
			"checkin",
			"checkout",
			"report",
			"schedule",
		]);
	});
});

// ============================================================================
// getArea, getIntervention (by UID)
// ============================================================================

describe("OpenGardenClient getArea", () => {
	it("returns decoded Area for valid uid", async () => {
		const encodedData = await (async () => {
			const { encodeAreaRegistration } = await import(
				"../src/schemas/encoders"
			);
			return encodeAreaRegistration({
				areaId: "RM-PIGN-042",
				latitude: 41.89,
				longitude: 12.4964,
				areaType: 1,
				name: "Test",
				municipality: "RM-I",
				boundary: null,
				metadata: "",
			});
		})();

		const client = createTestClient({
			// biome-ignore lint/suspicious/noExplicitAny: test stub cast
			eas: {
				getAttestation: async () => ({
					uid: "0xareauid",
					refUID: ZERO_BYTES32,
					data: encodedData,
					attester: ORG,
					recipient: ZERO_ADDRESS,
					time: 1_700_000_000n,
				}),
			} as any,
		});

		const area = await client.getArea("0xareauid");
		expect(area.uid).toBe("0xareauid");
		expect(area.areaId).toBe("RM-PIGN-042");
		expect(area.attester).toBe(ORG);
	});

	it("throws ATTESTATION_NOT_FOUND when UID returns ZERO_BYTES32", async () => {
		const client = createTestClient({
			// biome-ignore lint/suspicious/noExplicitAny: test stub cast
			eas: {
				getAttestation: async () => ({
					uid: ZERO_BYTES32,
					refUID: ZERO_BYTES32,
					data: "0x",
					attester: ZERO_ADDRESS,
					recipient: ZERO_ADDRESS,
					time: 0n,
				}),
			} as any,
		});
		try {
			await client.getArea("0xmissing");
			throw new Error("expected throw");
		} catch (e) {
			expect((e as OpenGardenError).code).toBe(
				OpenGardenErrorCode.ATTESTATION_NOT_FOUND,
			);
		}
	});
});

describe("OpenGardenClient getIntervention", () => {
	const encodedIntervention = () =>
		encodeIntervention({
			areaUID: AREA_UID,
			interventionId: INTERVENTION_ID,
			interventionType: InterventionType.RoutineMaintenance,
			executionDate: 1_700_000_500n,
			commissionId: null,
			evidenceBundleHash:
				"0x0000000000000000000000000000000000000000000000000000000000000002",
		});

	it("returns decoded Intervention with refUID routed to areaUID", async () => {
		const client = createTestClient({
			// biome-ignore lint/suspicious/noExplicitAny: test stub cast
			eas: {
				getAttestation: async () => ({
					uid: "0xinterventionuid",
					refUID: AREA_UID,
					data: encodedIntervention(),
					attester: ORG,
					recipient: ZERO_ADDRESS,
					time: 1_700_000_600n,
				}),
			} as any,
		});
		const intervention = await client.getIntervention("0xinterventionuid");
		expect(intervention.areaUID).toBe(AREA_UID);
		expect(intervention.interventionId).toBe(INTERVENTION_ID);
		expect(intervention.executionDate).toBe(1_700_000_500n);
	});

	it("throws ATTESTATION_NOT_FOUND when not found", async () => {
		const client = createTestClient({
			// biome-ignore lint/suspicious/noExplicitAny: test stub cast
			eas: {
				getAttestation: async () => ({
					uid: ZERO_BYTES32,
					refUID: ZERO_BYTES32,
					data: "0x",
					attester: ZERO_ADDRESS,
					recipient: ZERO_ADDRESS,
					time: 0n,
				}),
			} as any,
		});
		try {
			await client.getIntervention("0xmissing");
			throw new Error("expected throw");
		} catch (e) {
			expect((e as OpenGardenError).code).toBe(
				OpenGardenErrorCode.ATTESTATION_NOT_FOUND,
			);
		}
	});
});

// ============================================================================
// GraphQL reads
// ============================================================================

describe("OpenGardenClient GraphQL reads", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("getAreaInterventions decodes response and routes refUID to areaUID", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			json: async () => ({
				data: {
					attestations: [
						{
							id: "0xint1",
							attester: ORG,
							recipient: ZERO_ADDRESS,
							time: "1700000500",
							data: encodeIntervention({
								areaUID: AREA_UID,
								interventionId: INTERVENTION_ID,
								interventionType: 1,
								executionDate: 1_700_000_500n,
								commissionId: null,
								evidenceBundleHash: ZERO_BYTES32,
							}),
							refUID: AREA_UID,
						},
					],
				},
			}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = createTestClient({
			schemaUIDs: { Intervention: "0xschema" },
		});
		const interventions = await client.getAreaInterventions(AREA_UID);
		expect(interventions).toHaveLength(1);
		expect(interventions[0].uid).toBe("0xint1");
		expect(interventions[0].areaUID).toBe(AREA_UID);
		expect(interventions[0].interventionId).toBe(INTERVENTION_ID);
	});

	it("getAreaInterventions returns empty array when GraphQL returns no attestations", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				json: async () => ({ data: { attestations: [] } }),
			}),
		);
		const client = createTestClient({
			schemaUIDs: { Intervention: "0xschema" },
		});
		expect(await client.getAreaInterventions(AREA_UID)).toEqual([]);
	});

	it("getAreaInterventions throws INVALID_INPUT for chain without GraphQL endpoint", async () => {
		const unknownChain: ChainConfig = {
			chainId: 99999n,
			easAddress: "0x0",
			schemaRegistryAddress: "0x0",
		};
		const client = createTestClient({
			chain: unknownChain,
			schemaUIDs: { Intervention: "0xschema" },
		});
		try {
			await client.getAreaInterventions(AREA_UID);
			throw new Error("expected throw");
		} catch (e) {
			expect((e as OpenGardenError).code).toBe(
				OpenGardenErrorCode.INVALID_INPUT,
			);
		}
	});

	it("getGardenerMilestones filters by recipient", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			json: async () => ({ data: { attestations: [] } }),
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = createTestClient({
			schemaUIDs: { GardenerMilestone: "0xschema" },
		});
		await client.getGardenerMilestones(ALICE);

		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(body.variables.recipient).toBe(ALICE);
	});

	function decodedDataJsonFor(type: ActivityType, payloadHash: string): string {
		return JSON.stringify([
			{
				name: "activityType",
				type: "uint8",
				signature: "uint8 activityType",
				value: {
					name: "activityType",
					type: "uint8",
					value: String(type),
				},
			},
			{
				name: "payloadHash",
				type: "bytes32",
				signature: "bytes32 payloadHash",
				value: {
					name: "payloadHash",
					type: "bytes32",
					value: payloadHash,
				},
			},
		]);
	}

	it("getInterventionActivities queries by keccak256(interventionId) refUID", async () => {
		const payloadHash = hashActivityPayload({ latitude: 41890000, longitude: 12492000 });

		const fetchMock = vi.fn().mockResolvedValue({
			json: async () => ({
				data: {
					attestations: [
						{
							id: "0xactuid",
							attester: ALICE,
							time: "1700000300",
							decodedDataJson: decodedDataJsonFor(
								ActivityType.Checkout,
								payloadHash,
							),
							refUID: hashInterventionScope(INTERVENTION_ID),
							revoked: false,
						},
					],
				},
			}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = createTestClient({
			schemaUIDs: { Activity: "0xactschema" },
		});
		const activities = await client.getInterventionActivities(INTERVENTION_ID);

		expect(activities).toHaveLength(1);
		expect(activities[0].activityType).toBe(ActivityType.Checkout);
		expect(activities[0].payloadHash.toLowerCase()).toBe(
			payloadHash.toLowerCase(),
		);
		expect(activities[0].signer).toBe(ALICE);

		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(body.variables.refUID).toBe(hashInterventionScope(INTERVENTION_ID));
	});

	it("getAreaHealthchecks filters returned activities by type=healthcheck", async () => {
		const healthPayload = { healthScore: 8, mediaCID: "", notes: "" };
		const hcHash = hashActivityPayload(healthPayload);
		const scheduleHash = hashActivityPayload({ anything: 1 });

		// Intentionally mix in a non-healthcheck activity that shares the
		// refUID=areaUID (should be filtered out).
		const fetchMock = vi.fn().mockResolvedValue({
			json: async () => ({
				data: {
					attestations: [
						{
							id: "0xhcuid",
							attester: ALICE,
							time: "1700000100",
							decodedDataJson: decodedDataJsonFor(
								ActivityType.Healthcheck,
								hcHash,
							),
							refUID: AREA_UID,
						},
						{
							id: "0xothernonhc",
							attester: ORG,
							time: "1700000200",
							decodedDataJson: decodedDataJsonFor(
								ActivityType.Schedule,
								scheduleHash,
							),
							refUID: AREA_UID,
						},
					],
				},
			}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = createTestClient({
			schemaUIDs: { Activity: "0xactschema" },
		});
		const healthchecks = await client.getAreaHealthchecks(AREA_UID);
		expect(healthchecks).toHaveLength(1);
		expect(healthchecks[0].uid).toBe("0xhcuid");
		expect(healthchecks[0].signer).toBe(ALICE);
	});
});

// ============================================================================
// verifyEvidenceBundle
// ============================================================================

describe("OpenGardenClient verifyEvidenceBundle", () => {
	const VERIFY_SCOPE = hashInterventionScope(INTERVENTION_ID);

	function schedulePayload(crewSize = 1) {
		return {
			interventionId: INTERVENTION_ID,
			areaUID: AREA_UID,
			interventionType: 1,
			scheduledDate: 100,
			plannedDuration: 60,
			tasksPlanned: [],
			description: "",
			commissionRef: ZERO_BYTES32,
			crewSize,
		};
	}

	function makeActivity(opts: {
		uid: string;
		type: BundleActivity["type"];
		signer: string;
		onchainTimestamp: number;
		payload: Record<string, unknown>;
	}): BundleActivity {
		const payloadHash = hashActivityPayload(opts.payload);
		const data = encodeActivityData(
			activityTypeFromName(opts.type),
			payloadHash,
		);
		return {
			type: opts.type,
			uid: opts.uid,
			signer: opts.signer,
			claimedTimestamp: opts.onchainTimestamp,
			onchainTimestamp: opts.onchainTimestamp,
			signedAttestation: {
				version: 1,
				uid: opts.uid,
				signer: opts.signer,
				message: {
					schema: "0xschema",
					recipient: ZERO_ADDRESS,
					time: opts.onchainTimestamp,
					expirationTime: 0,
					revocable: true,
					refUID: VERIFY_SCOPE,
					data,
				},
				signature: { r: "0x", s: "0x", v: 27 },
			},
			payload: opts.payload as never,
		} as BundleActivity;
	}

	function makeSoloBundle(): EvidenceBundle {
		return {
			interventionId: INTERVENTION_ID,
			areaUID: AREA_UID,
			activities: [
				makeActivity({
					uid: "0xsched",
					type: "schedule",
					signer: ORG,
					onchainTimestamp: 100,
					payload: schedulePayload(1),
				}),
				makeActivity({
					uid: "0xci",
					type: "checkin",
					signer: ALICE,
					onchainTimestamp: 200,
					payload: { latitude: 0, longitude: 0 },
				}),
				makeActivity({
					uid: "0xco",
					type: "checkout",
					signer: ALICE,
					onchainTimestamp: 300,
					payload: {},
				}),
				makeActivity({
					uid: "0xrp",
					type: "report",
					signer: ALICE,
					onchainTimestamp: 400,
					payload: {
						tasksCompleted: [],
						reportedEffort: 60,
						mediaCID: "",
						notes: "",
					},
				}),
			],
			bundleVersion: EVIDENCE_BUNDLE_VERSION,
		};
	}

	function createVerifyClient(
		bundle: EvidenceBundle,
		interventionOverrides?: {
			executionDate?: bigint;
			time?: bigint;
		},
		timestampMap?: Record<string, number>,
	) {
		const tsMap =
			timestampMap ??
			Object.fromEntries(
				bundle.activities.map((a) => [a.uid, a.onchainTimestamp]),
			);

		const encodedData = encodeIntervention({
			areaUID: AREA_UID,
			interventionId: INTERVENTION_ID,
			interventionType: 1,
			executionDate: interventionOverrides?.executionDate ?? 200n,
			commissionId: null,
			evidenceBundleHash:
				"0x0000000000000000000000000000000000000000000000000000000000000002",
		});

		const storageMock = {
			upload: vi.fn(),
			download: vi
				.fn()
				.mockResolvedValue(
					new TextEncoder().encode(
						JSON.stringify(bundle, (_key, value) =>
							typeof value === "bigint" ? value.toString() : value,
						),
					),
				),
		};

		const client = createTestClient({
			storage: storageMock,
			// biome-ignore lint/suspicious/noExplicitAny: test stub cast
			eas: {
				getAttestation: async () => ({
					uid: "0xinterventionuid",
					refUID: AREA_UID,
					data: encodedData,
					attester: ORG,
					recipient: ZERO_ADDRESS,
					time: interventionOverrides?.time ?? 600n,
				}),
				getTimestamp: async (uid: string) => BigInt(tsMap[uid] ?? 0),
				getOffchain: async () => ({
					verifyOffchainAttestationSignature: () => true,
				}),
			} as any,
		});
		return { client, storageMock };
	}

	it("valid solo bundle passes all checks", async () => {
		const { client } = createVerifyClient(makeSoloBundle());
		const result = await client.verifyEvidenceBundle("0xinterventionuid");
		expect(result.valid).toBe(true);
		expect(result.bundleVersionValid).toBe(true);
		expect(result.signaturesValid).toBe(true);
		expect(result.payloadIntegrityValid).toBe(true);
		expect(result.timestampsVerified).toBe(true);
		expect(result.interventionScopeValid).toBe(true);
		expect(result.temporalOrderValid).toBe(true);
		expect(result.executionDateBracketed).toBe(true);
	});

	it("out-of-order crew chain fails temporal check", async () => {
		const bundle = makeSoloBundle();
		// Bump report earlier than checkout
		bundle.activities = bundle.activities.map((a) =>
			a.type === "report" ? { ...a, onchainTimestamp: 150 } : a,
		);
		const { client } = createVerifyClient(bundle, undefined, {
			"0xsched": 100,
			"0xci": 200,
			"0xco": 300,
			"0xrp": 150,
		});
		const result = await client.verifyEvidenceBundle("0xinterventionuid");
		expect(result.valid).toBe(false);
		expect(result.temporalOrderValid).toBe(false);
	});

	it("executionDate before schedule fails bracket", async () => {
		const { client } = createVerifyClient(makeSoloBundle(), {
			executionDate: 50n,
			time: 600n,
		});
		const result = await client.verifyEvidenceBundle("0xinterventionuid");
		expect(result.valid).toBe(false);
		expect(result.executionDateBracketed).toBe(false);
	});

	it("on-chain timestamp mismatch fails protocol check", async () => {
		const { client } = createVerifyClient(makeSoloBundle(), undefined, {
			"0xsched": 100,
			"0xci": 200,
			"0xco": 300,
			"0xrp": 9999, // wrong
		});
		const result = await client.verifyEvidenceBundle("0xinterventionuid");
		expect(result.valid).toBe(false);
		expect(result.timestampsVerified).toBe(false);
	});

	it("payload mutation fails integrity check", async () => {
		const bundle = makeSoloBundle();
		const checkout = bundle.activities.find((a) => a.type === "checkout");
		if (checkout) {
			(checkout.payload as { latitude?: number }).latitude = 99999999;
		}
		const { client } = createVerifyClient(bundle);
		const result = await client.verifyEvidenceBundle("0xinterventionuid");
		expect(result.valid).toBe(false);
		expect(result.payloadIntegrityValid).toBe(false);
	});

	it("mis-scoped activity fails intervention-scope policy check", async () => {
		const bundle = makeSoloBundle();
		const checkin = bundle.activities.find((a) => a.type === "checkin");
		if (checkin) {
			(checkin.signedAttestation as {
				message: Record<string, unknown>;
			}).message.refUID = "0xwrongscope";
		}
		const { client } = createVerifyClient(bundle);
		const result = await client.verifyEvidenceBundle("0xinterventionuid");
		expect(result.valid).toBe(false);
		expect(result.interventionScopeValid).toBe(false);
	});

	it("PROTOCOL_ONLY_VERIFY_POLICY ignores policy-tier failures", async () => {
		const { client } = createVerifyClient(makeSoloBundle(), {
			executionDate: 5000n, // post-publication
			time: 600n,
		});
		const result = await client.verifyEvidenceBundle("0xinterventionuid", {
			policy: PROTOCOL_ONLY_VERIFY_POLICY,
		});
		expect(result.executionDateBracketed).toBe(false);
		expect(result.valid).toBe(true);
	});

	it("custom verify policy requires only selected checks", async () => {
		const bundle = makeSoloBundle();
		bundle.activities = bundle.activities.map((a) =>
			a.type === "report" ? { ...a, onchainTimestamp: 150 } : a,
		);
		const { client } = createVerifyClient(bundle, undefined, {
			"0xsched": 100,
			"0xci": 200,
			"0xco": 300,
			"0xrp": 150,
		});
		const policy = verifyPolicy({
			required: [
				VerificationCheckCode.BUNDLE_VERSION,
				VerificationCheckCode.SIGNATURES,
				VerificationCheckCode.PAYLOAD_INTEGRITY,
			],
		});
		const result = await client.verifyEvidenceBundle("0xinterventionuid", {
			policy,
		});
		expect(result.temporalOrderValid).toBe(false);
		expect(result.valid).toBe(true);
	});

	it("rejects a bundle with unsupported bundleVersion", async () => {
		const bundle = {
			...makeSoloBundle(),
			bundleVersion: "99.9.9" as unknown as typeof EVIDENCE_BUNDLE_VERSION,
		};
		const { client } = createVerifyClient(bundle);
		try {
			await client.verifyEvidenceBundle("0xinterventionuid");
			throw new Error("expected throw");
		} catch (e) {
			expect((e as OpenGardenError).code).toBe(
				OpenGardenErrorCode.BUNDLE_VERIFICATION_FAILED,
			);
			expect((e as Error).message).toContain("99.9.9");
		}
	});
});
