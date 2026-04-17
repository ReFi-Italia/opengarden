import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenGardenClient } from "../src/client";
import {
	EVIDENCE_BUNDLE_VERSION,
	SCHEMA_NAME_UID,
	ZERO_ADDRESS,
	ZERO_BYTES32,
} from "../src/constants";
import { OpenGardenError, OpenGardenErrorCode } from "../src/errors";
import {
	decodePublishedIntervention,
	encodeAreaRegistration,
	encodeCitizenFeedback,
	encodeGardenerMilestone,
	encodeHealthcheck,
	encodePublishedIntervention,
	encodeScheduledIntervention,
} from "../src/schemas/encoders";
import { InterventionType } from "../src/types/enums";
import type { ChainConfig } from "../src/types/config";
import type { EvidenceBundle } from "../src/types/evidence";
import {
	createMockSigner,
	createTestClient,
	createTestConfig,
	DEFAULT_TEST_CHAIN,
	FAKE_TX_RECEIPT,
	MOCK_SIGNER_ADDRESS,
	makeFakeTimestampedResult,
} from "./_helpers";

const TEST_CHAIN = DEFAULT_TEST_CHAIN;

describe("OpenGardenClient construction", () => {
	it("throws SIGNER_ERROR when signer is missing", () => {
		expect(
			() =>
				new OpenGardenClient(
					createTestConfig({
						signer: undefined as any,
						chain: TEST_CHAIN,
					}),
				),
		).toThrow(OpenGardenError);

		try {
			new OpenGardenClient(
				createTestConfig({ signer: undefined as any, chain: TEST_CHAIN }),
			);
		} catch (e) {
			expect(e).toBeInstanceOf(OpenGardenError);
			expect((e as OpenGardenError).code).toBe(
				OpenGardenErrorCode.SIGNER_ERROR,
			);
		}
	});

	it("constructs with valid config", () => {
		const client = new OpenGardenClient(
			createTestConfig({
				signer: createMockSigner(),
				chain: TEST_CHAIN,
			}),
		);

		expect(client).toBeInstanceOf(OpenGardenClient);
	});

	it("accepts pre-registered schema UIDs", () => {
		const client = new OpenGardenClient(
			createTestConfig({
				signer: createMockSigner(),
				chain: TEST_CHAIN,
				schemaUIDs: {
					AreaRegistration: "0xschema123",
				},
			}),
		);

		const uids = client.getSchemaUIDs();
		expect(uids.AreaRegistration).toBe("0xschema123");
	});

	it("resolves a known chain name via the built-in registry", () => {
		const client = new OpenGardenClient(
			createTestConfig({
				signer: createMockSigner(),
				chain: "optimism-mainnet",
			}),
		);

		expect(client).toBeInstanceOf(OpenGardenClient);
	});

	it("throws INVALID_INPUT for an unknown chain name", () => {
		try {
			new OpenGardenClient(
				createTestConfig({
					signer: createMockSigner(),
					chain: "not-a-chain" as any,
				}),
			);
			expect.fail("expected OpenGardenError");
		} catch (e) {
			expect(e).toBeInstanceOf(OpenGardenError);
			expect((e as OpenGardenError).code).toBe(
				OpenGardenErrorCode.INVALID_INPUT,
			);
		}
	});

	it("inherits schemaUIDs from the chain config when the chain carries them", () => {
		const client = new OpenGardenClient(
			createTestConfig({
				signer: createMockSigner(),
				chain: "optimism-sepolia",
			}),
		);

		const uids = client.getSchemaUIDs();
		expect(uids.AreaRegistration).toBe(
			"0x948b5dcc84298941bcbbe7c4f94c781b94eb90fb25c8a9ee4176b09603e06070",
		);
		expect(uids.Healthcheck).toBe(
			"0xb5f901113d6db303c6c7857e3b79f7ff9f472694334e282473cbb0c08c8ee2ae",
		);
	});

	it("lets explicit config.schemaUIDs override chain defaults", () => {
		const client = new OpenGardenClient(
			createTestConfig({
				signer: createMockSigner(),
				chain: "optimism-sepolia",
				schemaUIDs: {
					AreaRegistration: "0xoverridearea",
				},
			}),
		);

		const uids = client.getSchemaUIDs();
		expect(uids.AreaRegistration).toBe("0xoverridearea");
		// Unoverridden entries still come from the chain default.
		expect(uids.GardenerCheckin).toBe(
			"0xdddcacda1ced4340541523acb6e448a583673890dbbe17b140138aa163c3c7dc",
		);
	});
});

describe("OpenGardenClient schema validation", () => {
	it("throws SCHEMA_NOT_REGISTERED when calling write without registration", async () => {
		const client = new OpenGardenClient(
			createTestConfig({
				signer: createMockSigner(),
				chain: TEST_CHAIN,
			}),
		);

		await expect(
			client.registerArea({
				areaId: "RM-PIGN-042",
				latitude: 41.89,
				longitude: 12.4964,
				areaType: 0,
				name: "Test",
				municipality: "RM",
				metadataHash:
					"0x0000000000000000000000000000000000000000000000000000000000000000",
			}),
		).rejects.toThrow(OpenGardenError);

		try {
			await client.registerArea({
				areaId: "RM-PIGN-042",
				latitude: 41.89,
				longitude: 12.4964,
				areaType: 0,
				name: "Test",
				municipality: "RM",
				metadataHash:
					"0x0000000000000000000000000000000000000000000000000000000000000000",
			});
		} catch (e) {
			expect((e as OpenGardenError).code).toBe(
				OpenGardenErrorCode.SCHEMA_NOT_REGISTERED,
			);
		}
	});
});

describe("OpenGardenClient endpoint overrides", () => {
	const CUSTOM_AREA_UID =
		"0x000000000000000000000000000000000000000000000000000000000000abcd";

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("uses an explicit graphqlUrl override for read queries", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			json: async () => ({ data: { attestations: [] } }),
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = new OpenGardenClient(
			createTestConfig({
				signer: createMockSigner(),
				chain: TEST_CHAIN,
				schemaUIDs: { PublishedIntervention: "0xschema" },
				graphqlUrl: "https://self-hosted-indexer.example.com/graphql",
			}),
		);

		await client.getAreaInterventions(CUSTOM_AREA_UID);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][0]).toBe(
			"https://self-hosted-indexer.example.com/graphql",
		);
	});

	it("uses an explicit storeUrl override for bundle indexing", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true });
		vi.stubGlobal("fetch", fetchMock);

		const client = new OpenGardenClient(
			createTestConfig({
				signer: createMockSigner(),
				chain: TEST_CHAIN,
				schemaUIDs: { PublishedIntervention: "0xschema" },
				storeUrl: "https://self-hosted-store.example.com/offchain/store",
			}),
		);

		const results = await client.indexBundleAttestations({
			interventionId: "INT-001",
			areaUID: "0xarea",
			scheduled: makeFakeTimestampedResult("0xsched"),
			crew: [
				{
					checkin: makeFakeTimestampedResult("0xcheckin"),
					checkout: makeFakeTimestampedResult("0xcheckout"),
					report: makeFakeTimestampedResult("0xreport"),
				},
			],
			validation: {
				...makeFakeTimestampedResult("0xvalidation"),
				approved: true,
				qualityScore: 9,
			},
		});

		expect(results).toHaveLength(5);
		expect(fetchMock.mock.calls[0][0]).toBe(
			"https://self-hosted-store.example.com/offchain/store",
		);
	});

	it("override works for chains with no built-in default", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			json: async () => ({ data: { attestations: [] } }),
		});
		vi.stubGlobal("fetch", fetchMock);

		const unknownChain: ChainConfig = {
			chainId: 99999n,
			easAddress: "0x4200000000000000000000000000000000000021",
			schemaRegistryAddress: "0x4200000000000000000000000000000000000020",
		};

		const client = new OpenGardenClient(
			createTestConfig({
				signer: createMockSigner(),
				chain: unknownChain,
				schemaUIDs: { PublishedIntervention: "0xschema" },
				graphqlUrl: "https://private.example.com/graphql",
			}),
		);

		await client.getAreaInterventions(CUSTOM_AREA_UID);
		expect(fetchMock.mock.calls[0][0]).toBe(
			"https://private.example.com/graphql",
		);
	});
});

describe("OpenGardenClient storage validation", () => {
	it("throws STORAGE_NOT_CONFIGURED when uploading without adapter", async () => {
		const client = new OpenGardenClient(
			createTestConfig({
				signer: createMockSigner(),
				chain: TEST_CHAIN,
			}),
		);

		await expect(client.uploadEvidenceBundle({} as any)).rejects.toThrow(
			OpenGardenError,
		);

		try {
			await client.uploadEvidenceBundle({} as any);
		} catch (e) {
			expect((e as OpenGardenError).code).toBe(
				OpenGardenErrorCode.STORAGE_NOT_CONFIGURED,
			);
		}
	});
});

describe("OpenGardenClient schema naming", () => {
	const FAKE_SCHEMA_UID =
		"0x0000000000000000000000000000000000000000000000000000000000000abc";

	function createSchemaClient() {
		const attestCalls: any[] = [];
		const client = createTestClient({
			registry: {
				register: async () => ({
					wait: async () => FAKE_SCHEMA_UID,
					receipt: FAKE_TX_RECEIPT,
				}),
			} as any,
			eas: {
				attest: async (params: any) => {
					attestCalls.push(params);
					return { wait: async () => "0xnameuid", receipt: FAKE_TX_RECEIPT };
				},
			} as any,
		});

		return { client, attestCalls };
	}

	it("attests schema name using SCHEMA_NAME_UID after registration", async () => {
		const { client, attestCalls } = createSchemaClient();

		await client.registerSchema("AreaRegistration");

		expect(attestCalls).toHaveLength(1);
		expect(attestCalls[0].schema).toBe(SCHEMA_NAME_UID);
		expect(attestCalls[0].data.refUID).toBe(
			"0x0000000000000000000000000000000000000000000000000000000000000000",
		);
		expect(attestCalls[0].data.revocable).toBe(true);
	});

	it("stores the schema UID after registration", async () => {
		const { client } = createSchemaClient();

		const result = await client.registerSchema("GardenerCheckin");

		expect(result.uid).toBe(FAKE_SCHEMA_UID);
		expect(result.name).toBe("GardenerCheckin");
		expect(result.txHash).toBe("0xtxhash");
		expect(client.getSchemaUIDs().GardenerCheckin).toBe(FAKE_SCHEMA_UID);
	});

	it("names each schema in registerAllSchemas", async () => {
		const { client, attestCalls } = createSchemaClient();

		const results = await client.registerAllSchemas();

		// 10 schemas total
		expect(results).toHaveLength(10);
		expect(attestCalls).toHaveLength(10);

		const names = results.map((r) => r.name);
		expect(names).toContain("AreaRegistration");
		expect(names).toContain("CitizenFeedback");
		expect(names).toContain("Healthcheck");
	});

	it("skips already-registered schemas but names new ones", async () => {
		const attestCalls: any[] = [];
		const client = new OpenGardenClient(
			createTestConfig({
				signer: createMockSigner(),
				chain: TEST_CHAIN,
				schemaUIDs: {
					AreaRegistration: "0xexisting",
					PublishedIntervention: "0xexisting2",
					GardenerMilestone: "0xexisting3",
					ScheduledIntervention: "0xexisting4",
					GardenerCheckin: "0xexisting5",
					GardenerCheckout: "0xexisting6",
					GardenerReport: "0xexisting7",
					AdminValidation: "0xexisting8",
					CitizenFeedback: "0xexisting9",
				},
				registry: {
					register: async () => ({
						wait: async () => FAKE_SCHEMA_UID,
						receipt: FAKE_TX_RECEIPT,
					}),
				} as any,
				eas: {
					attest: async (params: any) => {
						attestCalls.push(params);
						return { wait: async () => "0xnameuid", receipt: FAKE_TX_RECEIPT };
					},
				} as any,
			}),
		);

		const results = await client.registerAllSchemas();

		// Only Healthcheck is missing
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe("Healthcheck");
		expect(attestCalls).toHaveLength(1);
	});

	it("still registers schema when naming schema is unavailable on chain", async () => {
		const client = new OpenGardenClient(
			createTestConfig({
				signer: createMockSigner(),
				chain: TEST_CHAIN,
				registry: {
					register: async () => ({
						wait: async () => FAKE_SCHEMA_UID,
						receipt: FAKE_TX_RECEIPT,
					}),
				} as any,
				eas: {
					attest: async () => {
						throw new Error("NotFound");
					},
				} as any,
			}),
		);

		const result = await client.registerSchema("AreaRegistration");

		expect(result.uid).toBe(FAKE_SCHEMA_UID);
		expect(result.name).toBe("AreaRegistration");
	});
});

describe("OpenGardenClient indexBundleAttestations", () => {
	const BUNDLE_INPUT = {
		interventionId: "INT-001",
		areaUID: "0xarea",
		scheduled: makeFakeTimestampedResult("0xsched"),
		crew: [
			{
				checkin: makeFakeTimestampedResult("0xcheckin"),
				checkout: makeFakeTimestampedResult("0xcheckout"),
				report: makeFakeTimestampedResult("0xreport"),
			},
		],
		validation: {
			...makeFakeTimestampedResult("0xvalidation"),
			approved: true,
			qualityScore: 9,
		},
	};

	function createClient(chain?: ChainConfig) {
		return createTestClient({
			chain: chain ?? TEST_CHAIN,
			schemaUIDs: { PublishedIntervention: "0xschema" },
		});
	}

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("submits all 5 attestations to easscan store", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true });
		vi.stubGlobal("fetch", fetchMock);

		const client = createClient();
		const results = await client.indexBundleAttestations(BUNDLE_INPUT);

		expect(results).toHaveLength(5);
		expect(results.every((r) => r.ok)).toBe(true);
		expect(results.map((r) => r.role)).toEqual([
			"scheduled",
			"checkin",
			"checkout",
			"report",
			"validation",
		]);
		expect(results[1].crewIndex).toBe(0);
		expect(results[2].crewIndex).toBe(0);
		expect(results[3].crewIndex).toBe(0);
		expect(results[0].uid).toBe("0xsched");
		expect(results[1].uid).toBe("0xcheckin");
		expect(fetchMock).toHaveBeenCalledTimes(5);

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://optimism.easscan.org/offchain/store");
		expect(init.method).toBe("POST");

		const envelope = JSON.parse(init.body);
		expect(envelope.filename).toBe("eas.txt");
		const pkg = JSON.parse(envelope.textJson);
		expect(pkg.signer).toBe(MOCK_SIGNER_ADDRESS);
		expect(pkg.sig).toBeDefined();

		vi.unstubAllGlobals();
	});

	it("serializes BigInt values as strings in indexer payload", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true });
		vi.stubGlobal("fetch", fetchMock);

		const client = createClient();
		await client.indexBundleAttestations(BUNDLE_INPUT);

		const envelope = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(() => JSON.parse(envelope.textJson)).not.toThrow();
		const pkg = JSON.parse(envelope.textJson);
		expect(pkg.sig.message.time).toBe("1000000");

		vi.unstubAllGlobals();
	});

	it("surfaces per-attestation errors on non-200 response", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
			text: async () => "Server Error",
		});
		vi.stubGlobal("fetch", fetchMock);
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const client = createClient();
		const results = await client.indexBundleAttestations(BUNDLE_INPUT);

		expect(results).toHaveLength(5);
		expect(results.every((r) => r.ok === false)).toBe(true);
		expect(results[0].error).toContain("500");
		expect(results[0].error).toContain("Server Error");
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("500"));

		vi.unstubAllGlobals();
	});

	it("surfaces per-attestation errors on fetch failure", async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
		vi.stubGlobal("fetch", fetchMock);
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const client = createClient();
		const results = await client.indexBundleAttestations(BUNDLE_INPUT);

		expect(results).toHaveLength(5);
		expect(results.every((r) => r.ok === false)).toBe(true);
		expect(results[0].error).toBe("network down");
		expect(warnSpy).toHaveBeenCalledWith(
			"easscan indexer submission failed",
			expect.any(Error),
		);

		vi.unstubAllGlobals();
	});

	it("reports partial failures with the specific failing role", async () => {
		let call = 0;
		const fetchMock = vi.fn().mockImplementation(async () => {
			call++;
			// Third submission (checkout) fails
			if (call === 3) {
				return {
					ok: false,
					status: 503,
					text: async () => "Service Unavailable",
				};
			}
			return { ok: true };
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.spyOn(console, "warn").mockImplementation(() => {});

		const client = createClient();
		const results = await client.indexBundleAttestations(BUNDLE_INPUT);

		const okCount = results.filter((r) => r.ok).length;
		const failed = results.filter((r) => !r.ok);
		expect(okCount).toBe(4);
		expect(failed).toHaveLength(1);
		expect(failed[0].role).toBe("checkout");
		expect(failed[0].crewIndex).toBe(0);
		expect(failed[0].error).toContain("503");

		vi.unstubAllGlobals();
	});

	it("returns empty array when chain has no easscan store endpoint", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true });
		vi.stubGlobal("fetch", fetchMock);

		const unknownChain: ChainConfig = {
			chainId: 99999n,
			easAddress: "0x4200000000000000000000000000000000000021",
			schemaRegistryAddress: "0x4200000000000000000000000000000000000020",
		};

		const client = createClient(unknownChain);
		const results = await client.indexBundleAttestations(BUNDLE_INPUT);

		expect(results).toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();

		vi.unstubAllGlobals();
	});

	it("publishIntervention no longer does indexing", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const client = createTestClient({
			chain: TEST_CHAIN,
			schemaUIDs: { PublishedIntervention: "0xschema" },
			eas: {
				attest: async () => ({
					wait: async () => "0xuid",
					receipt: FAKE_TX_RECEIPT,
				}),
			} as any,
		});

		const result = await client.publishIntervention({
			areaUID: "0xarea",
			interventionId: "INT-001",
			interventionType: 1,
			executionDate: 1000000n,
			healthBefore: 3,
			healthAfter: 8,
			commissionId: null,
			evidenceBundleHash:
				"0x0000000000000000000000000000000000000000000000000000000000000000",
			offchainCount: 5,
			crewSize: 1,
		});

		expect(fetchMock).not.toHaveBeenCalled();
		expect(result.uid).toBe("0xuid");
		expect((result as any).indexedCount).toBeUndefined();

		vi.unstubAllGlobals();
	});
});

describe("OpenGardenClient finalizeIntervention", () => {
	const makeFakeResult = makeFakeTimestampedResult;

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("builds, uploads, indexes, and publishes in one call", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true });
		vi.stubGlobal("fetch", fetchMock);

		const storageMock = {
			upload: vi.fn().mockResolvedValue("0xbundlehash"),
			download: vi.fn(),
		};

		const client = new OpenGardenClient(
			createTestConfig({
				signer: createMockSigner(),
				chain: TEST_CHAIN,
				schemaUIDs: { PublishedIntervention: "0xschema" },
				storage: storageMock,
				eas: {
					attest: async () => ({
						wait: async () => "0xpublishuid",
						receipt: FAKE_TX_RECEIPT,
					}),
				} as any,
			}),
		);

		const result = await client.finalizeIntervention({
			interventionId: "INT-001",
			areaUID: "0xarea",
			scheduled: makeFakeResult("0xsched", { onchainTimestamp: 100n }),
			crew: [
				{
					checkin: makeFakeResult("0xcheckin", { onchainTimestamp: 200n }),
					checkout: makeFakeResult("0xcheckout", { onchainTimestamp: 300n }),
					report: makeFakeResult("0xreport", { onchainTimestamp: 400n }),
				},
			],
			validation: {
				...makeFakeResult("0xvalidation", { onchainTimestamp: 500n }),
				approved: true,
				qualityScore: 9,
			},
			interventionType: 1,
			executionDate: 1000000n,
			healthBefore: 3,
			healthAfter: 8,
			commissionId: null,
			crewSize: 1,
		});

		expect(storageMock.upload).toHaveBeenCalledTimes(1);
		expect(result.bundle.bundleVersion).toBe(EVIDENCE_BUNDLE_VERSION);
		expect(result.evidenceBundleHash).toBe("0xbundlehash");
		expect(result.indexedCount).toBe(5);
		expect(result.publication.uid).toBe("0xpublishuid");
		expect(fetchMock).toHaveBeenCalledTimes(5);

		vi.unstubAllGlobals();
	});

	it("computes offchainCount including healthchecks", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true });
		vi.stubGlobal("fetch", fetchMock);

		const attestCalls: any[] = [];
		const storageMock = {
			upload: vi.fn().mockResolvedValue("0xbundlehash"),
			download: vi.fn(),
		};

		const client = new OpenGardenClient(
			createTestConfig({
				signer: createMockSigner(),
				chain: TEST_CHAIN,
				schemaUIDs: { PublishedIntervention: "0xschema" },
				storage: storageMock,
				eas: {
					attest: async (params: any) => {
						attestCalls.push(params);
						return {
							wait: async () => "0xpublishuid",
							receipt: FAKE_TX_RECEIPT,
						};
					},
				} as any,
			}),
		);

		await client.finalizeIntervention({
			interventionId: "INT-001",
			areaUID: "0xarea",
			scheduled: makeFakeResult("0xsched", { onchainTimestamp: 100n }),
			crew: [
				{
					checkin: makeFakeResult("0xcheckinA", { onchainTimestamp: 200n }),
					checkout: makeFakeResult("0xcheckoutA", { onchainTimestamp: 300n }),
					report: makeFakeResult("0xreportA", { onchainTimestamp: 400n }),
				},
				{
					checkin: makeFakeResult("0xcheckinB", { onchainTimestamp: 210n }),
					checkout: makeFakeResult("0xcheckoutB", { onchainTimestamp: 310n }),
					report: makeFakeResult("0xreportB", { onchainTimestamp: 410n }),
				},
			],
			validation: {
				...makeFakeResult("0xvalidation", { onchainTimestamp: 500n }),
				approved: true,
				qualityScore: 9,
			},
			healthcheck: {
				...makeFakeResult("0xhc", { onchainTimestamp: 450n }),
				score: 8,
				baselineScore: 3,
			},
			interventionType: 1,
			executionDate: 1000000n,
			healthBefore: 3,
			healthAfter: 8,
			commissionId: null,
			crewSize: 2,
		});

		const attestData = attestCalls[0].data.data;
		const decoded = decodePublishedIntervention(attestData);
		expect(decoded.offchainCount).toBe(9); // 2 + 3*2 crew + 1 healthcheck
		expect(decoded.crewSize).toBe(2);

		vi.unstubAllGlobals();
	});

	it("throws INVALID_INPUT when executionDate is before scheduled timestamp", async () => {
		const storageMock = {
			upload: vi.fn().mockResolvedValue("0xbundlehash"),
			download: vi.fn(),
		};

		const client = new OpenGardenClient(
			createTestConfig({
				signer: createMockSigner(),
				chain: TEST_CHAIN,
				schemaUIDs: { PublishedIntervention: "0xschema" },
				storage: storageMock,
			}),
		);

		const backfilledInput = {
			interventionId: "INT-001",
			areaUID: "0xarea",
			scheduled: {
				...makeFakeResult("0xsched"),
				onchainTimestamp: 2000000n,
			},
			crew: [
				{
					checkin: makeFakeResult("0xcheckin"),
					checkout: makeFakeResult("0xcheckout"),
					report: makeFakeResult("0xreport"),
				},
			],
			validation: {
				...makeFakeResult("0xvalidation"),
				approved: true,
				qualityScore: 9,
			},
			interventionType: 1,
			executionDate: 1000000n,
			healthBefore: 3,
			healthAfter: 8,
			commissionId: null,
			crewSize: 1,
		};

		await expect(client.finalizeIntervention(backfilledInput)).rejects.toThrow(
			OpenGardenError,
		);

		try {
			await client.finalizeIntervention(backfilledInput);
		} catch (e) {
			expect((e as OpenGardenError).code).toBe(
				OpenGardenErrorCode.INVALID_INPUT,
			);
		}
	});
});

// --- Read method tests ---

describe("OpenGardenClient getArea", () => {
	const FAKE_AREA_UID =
		"0x000000000000000000000000000000000000000000000000000000000000abcd";

	function makeEncodedArea() {
		return encodeAreaRegistration({
			areaId: "RM-PIGN-042",
			latitude: 41.89,
			longitude: 12.4964,
			areaType: 0,
			name: "Pigneto Park",
			municipality: "Roma",
			metadataHash:
				"0x0000000000000000000000000000000000000000000000000000000000000001",
		});
	}

	it("returns decoded area for valid uid", async () => {
		const encodedData = makeEncodedArea();
		const client = createTestClient({
			eas: {
				getAttestation: async () => ({
					uid: FAKE_AREA_UID,
					data: encodedData,
					attester: MOCK_SIGNER_ADDRESS,
					time: 1700000000n,
				}),
			} as any,
		});

		const area = await client.getArea(FAKE_AREA_UID);

		expect(area.uid).toBe(FAKE_AREA_UID);
		expect(area.areaId).toBe("RM-PIGN-042");
		expect(area.name).toBe("Pigneto Park");
		expect(area.municipality).toBe("Roma");
		expect(area.attester).toBe(MOCK_SIGNER_ADDRESS);
		expect(area.time).toBe(1700000000n);
	});

	it("throws ATTESTATION_NOT_FOUND for ZERO_BYTES32 uid", async () => {
		const client = createTestClient({
			eas: {
				getAttestation: async () => ({
					uid: ZERO_BYTES32,
					data: "0x",
					attester: "0x0000000000000000000000000000000000000000",
					time: 0n,
				}),
			} as any,
		});

		await expect(client.getArea(FAKE_AREA_UID)).rejects.toThrow(
			OpenGardenError,
		);

		try {
			await client.getArea(FAKE_AREA_UID);
		} catch (e) {
			expect((e as OpenGardenError).code).toBe(
				OpenGardenErrorCode.ATTESTATION_NOT_FOUND,
			);
		}
	});
});

describe("OpenGardenClient getIntervention", () => {
	const FAKE_INTERVENTION_UID =
		"0x000000000000000000000000000000000000000000000000000000000000beef";

	function makeEncodedIntervention() {
		return encodePublishedIntervention({
			areaUID:
				"0x000000000000000000000000000000000000000000000000000000000000abcd",
			interventionId: "INT-001",
			interventionType: 1,
			executionDate: 1000000n,
			healthBefore: 3,
			healthAfter: 8,
			commissionId: null,
			evidenceBundleHash:
				"0x0000000000000000000000000000000000000000000000000000000000000002",
			offchainCount: 8,
			crewSize: 2,
		});
	}

	it("returns decoded intervention for valid uid", async () => {
		const encodedData = makeEncodedIntervention();
		const client = createTestClient({
			eas: {
				getAttestation: async () => ({
					uid: FAKE_INTERVENTION_UID,
					data: encodedData,
					attester: MOCK_SIGNER_ADDRESS,
					recipient: ZERO_ADDRESS,
					time: 1700000000n,
				}),
			} as any,
		});

		const intervention = await client.getIntervention(FAKE_INTERVENTION_UID);

		expect(intervention.uid).toBe(FAKE_INTERVENTION_UID);
		expect(intervention.interventionId).toBe("INT-001");
		expect(intervention.healthBefore).toBe(3);
		expect(intervention.healthAfter).toBe(8);
		expect(intervention.offchainCount).toBe(8);
		expect(intervention.crewSize).toBe(2);
		expect(intervention.recipient).toBe(ZERO_ADDRESS);
		expect(intervention.time).toBe(1700000000n);
	});

	it("throws ATTESTATION_NOT_FOUND for ZERO_BYTES32 uid", async () => {
		const client = createTestClient({
			eas: {
				getAttestation: async () => ({
					uid: ZERO_BYTES32,
					data: "0x",
					attester: "0x0000000000000000000000000000000000000000",
					recipient: "0x0000000000000000000000000000000000000000",
					time: 0n,
				}),
			} as any,
		});

		await expect(client.getIntervention(FAKE_INTERVENTION_UID)).rejects.toThrow(
			OpenGardenError,
		);

		try {
			await client.getIntervention(FAKE_INTERVENTION_UID);
		} catch (e) {
			expect((e as OpenGardenError).code).toBe(
				OpenGardenErrorCode.ATTESTATION_NOT_FOUND,
			);
		}
	});
});

describe("OpenGardenClient getAreaInterventions", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	const createClient = (chain?: ChainConfig) =>
		createTestClient({
			chain: chain ?? TEST_CHAIN,
			schemaUIDs: { PublishedIntervention: "0xschema" },
		});

	function makeEncodedIntervention() {
		return encodePublishedIntervention({
			areaUID:
				"0x000000000000000000000000000000000000000000000000000000000000abcd",
			interventionId: "INT-001",
			interventionType: 1,
			executionDate: 1000000n,
			healthBefore: 3,
			healthAfter: 8,
			commissionId: null,
			evidenceBundleHash:
				"0x0000000000000000000000000000000000000000000000000000000000000002",
			offchainCount: 5,
			crewSize: 1,
		});
	}

	it("returns decoded interventions from GraphQL response", async () => {
		const encodedData = makeEncodedIntervention();
		const fetchMock = vi.fn().mockResolvedValue({
			json: async () => ({
				data: {
					attestations: [
						{
							id: "0xintervention1",
							attester: MOCK_SIGNER_ADDRESS,
							recipient: MOCK_SIGNER_ADDRESS,
							time: "1700000000",
							data: encodedData,
							refUID: "0xarea",
						},
					],
				},
			}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = createClient();
		const interventions = await client.getAreaInterventions("0xarea");

		expect(interventions).toHaveLength(1);
		expect(interventions[0].uid).toBe("0xintervention1");
		expect(interventions[0].interventionId).toBe("INT-001");
		expect(interventions[0].time).toBe(1700000000n);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("returns empty array when no attestations found", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			json: async () => ({ data: { attestations: [] } }),
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = createClient();
		const interventions = await client.getAreaInterventions("0xarea");

		expect(interventions).toHaveLength(0);
	});

	it("throws INVALID_INPUT for unknown chain without GraphQL endpoint", () => {
		const unknownChain: ChainConfig = {
			chainId: 99999n,
			easAddress: "0x4200000000000000000000000000000000000021",
			schemaRegistryAddress: "0x4200000000000000000000000000000000000020",
		};

		const client = createClient(unknownChain);

		expect(client.getAreaInterventions("0xarea")).rejects.toThrow(
			OpenGardenError,
		);
	});
});

describe("OpenGardenClient getGardenerMilestones", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	const createClient = () =>
		createTestClient({ schemaUIDs: { GardenerMilestone: "0xschema" } });

	function makeEncodedMilestone() {
		return encodeGardenerMilestone({
			recipient: MOCK_SIGNER_ADDRESS,
			milestoneLevel: 3,
			totalInterventions: 50,
			totalValidated: 48,
			avgHealthImprovement: 4,
			skillTier: "expert",
			achievedAt: 1700000000n,
			evidenceRoot:
				"0x0000000000000000000000000000000000000000000000000000000000000001",
		});
	}

	it("returns decoded milestones from GraphQL response", async () => {
		const encodedData = makeEncodedMilestone();
		const fetchMock = vi.fn().mockResolvedValue({
			json: async () => ({
				data: {
					attestations: [
						{
							id: "0xmilestone1",
							attester: MOCK_SIGNER_ADDRESS,
							recipient: MOCK_SIGNER_ADDRESS,
							time: "1700000000",
							data: encodedData,
						},
					],
				},
			}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = createClient();
		const milestones = await client.getGardenerMilestones(MOCK_SIGNER_ADDRESS);

		expect(milestones).toHaveLength(1);
		expect(milestones[0].uid).toBe("0xmilestone1");
		expect(milestones[0].milestoneLevel).toBe(3);
		expect(milestones[0].totalInterventions).toBe(50);
		expect(milestones[0].skillTier).toBe("expert");
		expect(milestones[0].time).toBe(1700000000n);
	});

	it("returns empty array when no milestones found", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			json: async () => ({ data: { attestations: [] } }),
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = createClient();
		const milestones = await client.getGardenerMilestones(MOCK_SIGNER_ADDRESS);

		expect(milestones).toHaveLength(0);
	});
});

describe("OpenGardenClient verifyEvidenceBundle", () => {
	const FAKE_INTERVENTION_UID =
		"0x000000000000000000000000000000000000000000000000000000000000beef";

	function makeEncodedIntervention(overrides?: {
		executionDate?: bigint;
		offchainCount?: number;
		evidenceBundleHash?: string;
		crewSize?: number;
	}) {
		return encodePublishedIntervention({
			areaUID:
				"0x000000000000000000000000000000000000000000000000000000000000abcd",
			interventionId: "INT-001",
			interventionType: 1,
			executionDate: overrides?.executionDate ?? 200n,
			healthBefore: 3,
			healthAfter: 8,
			commissionId: null,
			evidenceBundleHash:
				overrides?.evidenceBundleHash ??
				"0x0000000000000000000000000000000000000000000000000000000000000002",
			offchainCount: overrides?.offchainCount ?? 5,
			crewSize: overrides?.crewSize ?? 1,
		});
	}

	function makeValidBundle(
		overrides?: Partial<EvidenceBundle>,
	): EvidenceBundle {
		return {
			interventionId: "INT-001",
			areaUID: "0xarea",
			attestations: {
				scheduled: {
					uid: "0xsched",
					contentHash: "0xsched",
					claimedTimestamp: 100,
					onchainTimestamp: 100,
				},
				checkins: [
					{
						uid: "0xcheckin",
						contentHash: "0xcheckin",
						attester: "0xAlice",
						claimedTimestamp: 200,
						onchainTimestamp: 200,
					},
				],
				checkouts: [
					{
						uid: "0xcheckout",
						contentHash: "0xcheckout",
						attester: "0xAlice",
						claimedTimestamp: 300,
						onchainTimestamp: 300,
					},
				],
				reports: [
					{
						uid: "0xreport",
						contentHash: "0xreport",
						attester: "0xAlice",
						claimedTimestamp: 400,
						onchainTimestamp: 400,
					},
				],
				validation: {
					uid: "0xvalidation",
					contentHash: "0xvalidation",
					claimedTimestamp: 500,
					onchainTimestamp: 500,
					approved: true,
					qualityScore: 9,
				},
			},
			photos: {},
			bundleVersion: EVIDENCE_BUNDLE_VERSION,
			...overrides,
		};
	}

	function createVerifyClient(
		bundle: EvidenceBundle,
		interventionOverrides?: {
			executionDate?: bigint;
			time?: bigint;
			offchainCount?: number;
			crewSize?: number;
		},
		timestampMap?: Record<string, number>,
	) {
		const storageMock = {
			upload: vi.fn(),
			download: vi
				.fn()
				.mockResolvedValue(new TextEncoder().encode(JSON.stringify(bundle))),
		};

		const tsMap = timestampMap ?? {
			"0xsched": 100,
			"0xcheckin": 200,
			"0xcheckout": 300,
			"0xreport": 400,
			"0xvalidation": 500,
		};

		const encodedData = makeEncodedIntervention({
			executionDate: interventionOverrides?.executionDate ?? 200n,
			offchainCount: interventionOverrides?.offchainCount ?? 5,
			crewSize: interventionOverrides?.crewSize,
		});

		const client = new OpenGardenClient(
			createTestConfig({
				signer: createMockSigner(),
				chain: TEST_CHAIN,
				storage: storageMock,
				eas: {
					getAttestation: async () => ({
						uid: FAKE_INTERVENTION_UID,
						data: encodedData,
						attester: MOCK_SIGNER_ADDRESS,
						recipient: ZERO_ADDRESS,
						time: interventionOverrides?.time ?? 600n,
					}),
					getTimestamp: async (uid: string) => BigInt(tsMap[uid] ?? 0),
				} as any,
			}),
		);

		return { client, storageMock };
	}

	it("valid solo bundle passes all checks", async () => {
		const bundle = makeValidBundle();
		const { client } = createVerifyClient(bundle);

		const result = await client.verifyEvidenceBundle(FAKE_INTERVENTION_UID);

		expect(result.valid).toBe(true);
		expect(result.attestationCount).toBe(5);
		expect(result.expectedCount).toBe(5);
		expect(result.temporalOrderValid).toBe(true);
		expect(result.timestampsVerified).toBe(true);
		expect(result.healthcheckOrderValid).toBe(true);
		expect(result.executionDateBracketed).toBe(true);
		expect(result.validationApproved).toBe(true);
	});

	it("valid 2-person crew bundle passes all checks", async () => {
		const bundle = makeValidBundle({
			attestations: {
				scheduled: {
					uid: "0xsched",
					contentHash: "0xsched",
					claimedTimestamp: 100,
					onchainTimestamp: 100,
				},
				checkins: [
					{
						uid: "0xciA",
						contentHash: "0xciA",
						attester: "0xAlice",
						claimedTimestamp: 200,
						onchainTimestamp: 200,
					},
					{
						uid: "0xciB",
						contentHash: "0xciB",
						attester: "0xBob",
						claimedTimestamp: 210,
						onchainTimestamp: 210,
					},
				],
				checkouts: [
					{
						uid: "0xcoA",
						contentHash: "0xcoA",
						attester: "0xAlice",
						claimedTimestamp: 300,
						onchainTimestamp: 300,
					},
					{
						uid: "0xcoB",
						contentHash: "0xcoB",
						attester: "0xBob",
						claimedTimestamp: 320,
						onchainTimestamp: 320,
					},
				],
				reports: [
					{
						uid: "0xrpA",
						contentHash: "0xrpA",
						attester: "0xAlice",
						claimedTimestamp: 400,
						onchainTimestamp: 400,
					},
					{
						uid: "0xrpB",
						contentHash: "0xrpB",
						attester: "0xBob",
						claimedTimestamp: 420,
						onchainTimestamp: 420,
					},
				],
				validation: {
					uid: "0xvalidation",
					contentHash: "0xvalidation",
					claimedTimestamp: 500,
					onchainTimestamp: 500,
					approved: true,
					qualityScore: 9,
				},
			},
		});
		const { client } = createVerifyClient(
			bundle,
			{ offchainCount: 8, crewSize: 2 },
			{
				"0xsched": 100,
				"0xciA": 200,
				"0xciB": 210,
				"0xcoA": 300,
				"0xcoB": 320,
				"0xrpA": 400,
				"0xrpB": 420,
				"0xvalidation": 500,
			},
		);

		const result = await client.verifyEvidenceBundle(FAKE_INTERVENTION_UID);

		expect(result.valid).toBe(true);
		expect(result.attestationCount).toBe(8);
		expect(result.expectedCount).toBe(8);
		expect(result.temporalOrderValid).toBe(true);
	});

	it("mismatched attestation count fails", async () => {
		const bundle = makeValidBundle();
		const { client } = createVerifyClient(bundle, { offchainCount: 7 });

		const result = await client.verifyEvidenceBundle(FAKE_INTERVENTION_UID);

		expect(result.valid).toBe(false);
		expect(result.attestationCount).toBe(5);
		expect(result.expectedCount).toBe(7);
	});

	it("per-gardener out-of-order (checkout before checkin) fails", async () => {
		const bundle = makeValidBundle({
			attestations: {
				...makeValidBundle().attestations,
				checkins: [
					{
						uid: "0xcheckin",
						contentHash: "0xcheckin",
						attester: "0xAlice",
						claimedTimestamp: 200,
						onchainTimestamp: 500,
					},
				],
				checkouts: [
					{
						uid: "0xcheckout",
						contentHash: "0xcheckout",
						attester: "0xAlice",
						claimedTimestamp: 300,
						onchainTimestamp: 150,
					},
				],
			},
		});
		const { client } = createVerifyClient(bundle, undefined, {
			"0xsched": 100,
			"0xcheckin": 500,
			"0xcheckout": 150,
			"0xreport": 400,
			"0xvalidation": 500,
		});

		const result = await client.verifyEvidenceBundle(FAKE_INTERVENTION_UID);

		expect(result.valid).toBe(false);
		expect(result.temporalOrderValid).toBe(false);
	});

	it("equal per-gardener timestamps (same block) fails strict ordering", async () => {
		const bundle = makeValidBundle({
			attestations: {
				...makeValidBundle().attestations,
				checkins: [
					{
						uid: "0xcheckin",
						contentHash: "0xcheckin",
						attester: "0xAlice",
						claimedTimestamp: 200,
						onchainTimestamp: 200,
					},
				],
				checkouts: [
					{
						uid: "0xcheckout",
						contentHash: "0xcheckout",
						attester: "0xAlice",
						claimedTimestamp: 200,
						onchainTimestamp: 200,
					},
				],
			},
		});
		const { client } = createVerifyClient(bundle, undefined, {
			"0xsched": 100,
			"0xcheckin": 200,
			"0xcheckout": 200,
			"0xreport": 400,
			"0xvalidation": 500,
		});

		const result = await client.verifyEvidenceBundle(FAKE_INTERVENTION_UID);

		expect(result.valid).toBe(false);
		expect(result.temporalOrderValid).toBe(false);
	});

	it("healthcheck at any timestamp is valid (retroactive, no bracket enforced)", async () => {
		const bundle = makeValidBundle({
			attestations: {
				...makeValidBundle().attestations,
				healthcheck: {
					uid: "0xhc",
					score: 8,
					baselineScore: 3,
					onchainTimestamp: 250, // mid-lifecycle — allowed
				},
			},
		});
		const { client } = createVerifyClient(bundle, { offchainCount: 6 });

		const result = await client.verifyEvidenceBundle(FAKE_INTERVENTION_UID);

		expect(result.healthcheckOrderValid).toBe(true);
	});

	it("execution date before schedule fails bracketing", async () => {
		const bundle = makeValidBundle({
			attestations: {
				...makeValidBundle().attestations,
				scheduled: {
					uid: "0xsched",
					contentHash: "0xsched",
					claimedTimestamp: 100,
					onchainTimestamp: 300,
				},
			},
		});
		const { client } = createVerifyClient(
			bundle,
			{ executionDate: 200n, time: 600n },
			{
				"0xsched": 300,
				"0xcheckin": 400,
				"0xcheckout": 450,
				"0xreport": 480,
				"0xvalidation": 500,
			},
		);

		const result = await client.verifyEvidenceBundle(FAKE_INTERVENTION_UID);

		expect(result.valid).toBe(false);
		expect(result.executionDateBracketed).toBe(false);
	});

	it("execution date after publication fails bracketing", async () => {
		const bundle = makeValidBundle();
		const { client } = createVerifyClient(bundle, {
			executionDate: 700n,
			time: 600n,
		});

		const result = await client.verifyEvidenceBundle(FAKE_INTERVENTION_UID);

		expect(result.valid).toBe(false);
		expect(result.executionDateBracketed).toBe(false);
	});

	it("validation.approved === false fails", async () => {
		const bundle = makeValidBundle({
			attestations: {
				...makeValidBundle().attestations,
				validation: {
					uid: "0xvalidation",
					contentHash: "0xvalidation",
					claimedTimestamp: 500,
					onchainTimestamp: 500,
					approved: false,
					qualityScore: 2,
				},
			},
		});
		const { client } = createVerifyClient(bundle);

		const result = await client.verifyEvidenceBundle(FAKE_INTERVENTION_UID);

		expect(result.valid).toBe(false);
		expect(result.validationApproved).toBe(false);
	});

	it("throws STORAGE_NOT_CONFIGURED without storage adapter", async () => {
		const client = new OpenGardenClient(
			createTestConfig({
				signer: createMockSigner(),
				chain: TEST_CHAIN,
			}),
		);

		await expect(
			client.verifyEvidenceBundle(FAKE_INTERVENTION_UID),
		).rejects.toThrow(OpenGardenError);

		try {
			await client.verifyEvidenceBundle(FAKE_INTERVENTION_UID);
		} catch (e) {
			expect((e as OpenGardenError).code).toBe(
				OpenGardenErrorCode.STORAGE_NOT_CONFIGURED,
			);
		}
	});

	it("on-chain timestamp mismatch detected", async () => {
		const bundle = makeValidBundle();
		const { client } = createVerifyClient(bundle, undefined, {
			"0xsched": 100,
			"0xcheckin": 200,
			"0xcheckout": 300,
			"0xreport": 400,
			"0xvalidation": 999,
		});

		const result = await client.verifyEvidenceBundle(FAKE_INTERVENTION_UID);

		expect(result.valid).toBe(false);
		expect(result.timestampsVerified).toBe(false);
	});

	it("rejects a bundle with unsupported bundleVersion", async () => {
		const bundle = makeValidBundle({
			bundleVersion: "9.9.9" as unknown as typeof EVIDENCE_BUNDLE_VERSION,
		});
		const { client } = createVerifyClient(bundle);

		await expect(
			client.verifyEvidenceBundle(FAKE_INTERVENTION_UID),
		).rejects.toThrow(OpenGardenError);

		try {
			await client.verifyEvidenceBundle(FAKE_INTERVENTION_UID);
		} catch (e) {
			expect((e as OpenGardenError).code).toBe(
				OpenGardenErrorCode.BUNDLE_VERIFICATION_FAILED,
			);
			expect((e as Error).message).toContain("9.9.9");
		}
	});

	it("rejects a bundle with missing bundleVersion", async () => {
		const bundle = makeValidBundle();
		const malformed = { ...bundle };
		delete (malformed as Partial<EvidenceBundle>).bundleVersion;
		const { client } = createVerifyClient(malformed as EvidenceBundle);

		await expect(
			client.verifyEvidenceBundle(FAKE_INTERVENTION_UID),
		).rejects.toThrow(/missing/);
	});
});

describe("OpenGardenClient getScheduledInterventions", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	const CREW_LEAD = "0xCrewLead000000000000000000000000000000CC";
	const AREA_UID =
		"0x000000000000000000000000000000000000000000000000000000000000abcd";

	const createClient = () =>
		createTestClient({ schemaUIDs: { ScheduledIntervention: "0xschema" } });

	function makeEncodedSchedule() {
		return encodeScheduledIntervention({
			areaUID: AREA_UID,
			interventionId: "INT-2026-0001",
			interventionType: InterventionType.RoutineMaintenance,
			crewLead: CREW_LEAD,
			crewSize: 2,
			scheduledDate: 1709337600n,
			estimatedMinutes: 90,
			description: "Trim hedge and water beds",
			commissionId: null,
		});
	}

	it("throws INVALID_INPUT when no filter is provided", async () => {
		const client = createClient();
		await expect(client.getScheduledInterventions({})).rejects.toThrow(
			OpenGardenError,
		);
	});

	it("filters by areaUID and returns decoded schedules", async () => {
		const encodedData = makeEncodedSchedule();
		const fetchMock = vi.fn().mockResolvedValue({
			json: async () => ({
				data: {
					attestations: [
						{
							id: "0xschedule1",
							attester: MOCK_SIGNER_ADDRESS,
							recipient: CREW_LEAD,
							time: "1709337500",
							data: encodedData,
						},
					],
				},
			}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = createClient();
		const schedules = await client.getScheduledInterventions({
			areaUID: AREA_UID,
		});

		expect(schedules).toHaveLength(1);
		expect(schedules[0].uid).toBe("0xschedule1");
		expect(schedules[0].interventionId).toBe("INT-2026-0001");
		expect(schedules[0].recipient).toBe(CREW_LEAD);
		expect(schedules[0].crewSize).toBe(2);
		expect(schedules[0].time).toBe(1709337500n);

		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(body.variables.refUID).toBe(AREA_UID);
		expect(body.variables.recipient).toBeUndefined();
		expect(body.query).toContain("refUID: { equals: $refUID }");
		expect(body.query).not.toContain("recipient: { equals: $recipient }");
	});

	it("filters by crewLead and returns decoded schedules", async () => {
		const encodedData = makeEncodedSchedule();
		const fetchMock = vi.fn().mockResolvedValue({
			json: async () => ({
				data: {
					attestations: [
						{
							id: "0xschedule2",
							attester: MOCK_SIGNER_ADDRESS,
							recipient: CREW_LEAD,
							time: "1709337500",
							data: encodedData,
						},
					],
				},
			}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = createClient();
		const schedules = await client.getScheduledInterventions({
			crewLead: CREW_LEAD,
		});

		expect(schedules).toHaveLength(1);

		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(body.variables.recipient).toBe(CREW_LEAD);
		expect(body.variables.refUID).toBeUndefined();
		expect(body.query).toContain("recipient: { equals: $recipient }");
		expect(body.query).not.toContain("refUID: { equals: $refUID }");
	});

	it("combines both filters when provided", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			json: async () => ({ data: { attestations: [] } }),
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = createClient();
		await client.getScheduledInterventions({
			areaUID: AREA_UID,
			crewLead: CREW_LEAD,
		});

		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(body.variables.refUID).toBe(AREA_UID);
		expect(body.variables.recipient).toBe(CREW_LEAD);
		expect(body.query).toContain("refUID: { equals: $refUID }");
		expect(body.query).toContain("recipient: { equals: $recipient }");
	});
});

describe("OpenGardenClient recordHealthcheck", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	const AREA_UID =
		"0x000000000000000000000000000000000000000000000000000000000000cafe";
	const INTERVENTION_UID =
		"0x000000000000000000000000000000000000000000000000000000000000beef";

	function createRecordClient() {
		const signCalls: any[] = [];
		const eas = {
			getOffchain: async () => ({
				signOffchainAttestation: async (params: any) => {
					signCalls.push(params);
					return {
						uid: "0xhcuid",
						signer: MOCK_SIGNER_ADDRESS,
						message: params,
					};
				},
			}),
			timestamp: async () => ({
				wait: async () => 999999n,
				receipt: FAKE_TX_RECEIPT,
			}),
		};
		const client = createTestClient({
			eas: eas as any,
			schemaUIDs: { Healthcheck: "0xhcschema" },
		});
		return { client, signCalls };
	}

	it("passes areaUID as EAS refUID for intervention-linked healthcheck", async () => {
		const { client, signCalls } = createRecordClient();

		await client.recordHealthcheck(AREA_UID, {
			interventionUID: INTERVENTION_UID,
			healthScore: 8,
			photoHash: ZERO_BYTES32,
			assessorId: null,
			metadataHash: null,
		});

		expect(signCalls).toHaveLength(1);
		expect(signCalls[0].refUID).toBe(AREA_UID);
	});

	it("passes areaUID as EAS refUID for standalone healthcheck (null interventionUID)", async () => {
		const { client, signCalls } = createRecordClient();

		await client.recordHealthcheck(AREA_UID, {
			interventionUID: null,
			healthScore: 6,
			photoHash: ZERO_BYTES32,
			assessorId: null,
			metadataHash: null,
		});

		expect(signCalls).toHaveLength(1);
		expect(signCalls[0].refUID).toBe(AREA_UID);
	});

	it("areaUID and interventionUID are independent — different fields, different values", async () => {
		const { client, signCalls } = createRecordClient();

		await client.recordHealthcheck(AREA_UID, {
			interventionUID: INTERVENTION_UID,
			healthScore: 7,
			photoHash: ZERO_BYTES32,
			assessorId: null,
			metadataHash: null,
		});

		expect(signCalls[0].refUID).toBe(AREA_UID);
		expect(signCalls[0].refUID).not.toBe(INTERVENTION_UID);
	});
});

describe("OpenGardenClient getAreaHealthchecks", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	const AREA_UID =
		"0x000000000000000000000000000000000000000000000000000000000000abcd";

	const createClient = () =>
		createTestClient({ schemaUIDs: { Healthcheck: "0xschema" } });

	function makeEncodedHealthcheck() {
		return encodeHealthcheck({
			interventionUID: ZERO_BYTES32,
			healthScore: 6,
			photoHash: ZERO_BYTES32,
			assessorId: "staff-001",
			metadataHash: null,
		});
	}

	it("returns decoded healthchecks from GraphQL response", async () => {
		const encodedData = makeEncodedHealthcheck();
		const fetchMock = vi.fn().mockResolvedValue({
			json: async () => ({
				data: {
					attestations: [
						{
							id: "0xhealthcheck1",
							attester: MOCK_SIGNER_ADDRESS,
							time: "1700000000",
							data: encodedData,
						},
					],
				},
			}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = createClient();
		const healthchecks = await client.getAreaHealthchecks(AREA_UID);

		expect(healthchecks).toHaveLength(1);
		expect(healthchecks[0].uid).toBe("0xhealthcheck1");
		expect(healthchecks[0].healthScore).toBe(6);
		expect(healthchecks[0].attester).toBe(MOCK_SIGNER_ADDRESS);
		expect(healthchecks[0].time).toBe(1700000000n);
	});

	it("returns empty array when no attestations found", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			json: async () => ({ data: { attestations: [] } }),
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = createClient();
		const healthchecks = await client.getAreaHealthchecks(AREA_UID);
		expect(healthchecks).toHaveLength(0);
	});
});

describe("OpenGardenClient getAreaCitizenFeedback", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	const AREA_UID =
		"0x000000000000000000000000000000000000000000000000000000000000abcd";

	const createClient = () =>
		createTestClient({ schemaUIDs: { CitizenFeedback: "0xschema" } });

	function makeEncodedFeedback() {
		return encodeCitizenFeedback({
			areaUID: AREA_UID,
			rating: 4,
			comment: "The park looks better now",
			photoHash: ZERO_BYTES32,
		});
	}

	it("returns decoded feedback from GraphQL response", async () => {
		const encodedData = makeEncodedFeedback();
		const fetchMock = vi.fn().mockResolvedValue({
			json: async () => ({
				data: {
					attestations: [
						{
							id: "0xfeedback1",
							attester: MOCK_SIGNER_ADDRESS,
							time: "1700000000",
							data: encodedData,
						},
					],
				},
			}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = createClient();
		const feedback = await client.getAreaCitizenFeedback(AREA_UID);

		expect(feedback).toHaveLength(1);
		expect(feedback[0].uid).toBe("0xfeedback1");
		expect(feedback[0].rating).toBe(4);
		expect(feedback[0].comment).toBe("The park looks better now");
		expect(feedback[0].attester).toBe(MOCK_SIGNER_ADDRESS);
		expect(feedback[0].time).toBe(1700000000n);
	});

	it("returns empty array when no attestations found", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			json: async () => ({ data: { attestations: [] } }),
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = createClient();
		const feedback = await client.getAreaCitizenFeedback(AREA_UID);
		expect(feedback).toHaveLength(0);
	});
});
