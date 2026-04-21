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
	encodeAreaRegistration,
	encodeGardenerMilestone,
	encodeHealthcheck,
	encodePublishedIntervention,
	encodeScheduledIntervention,
} from "../src/schemas/encoders";
import type { ChainConfig } from "../src/types/config";
import { InterventionType } from "../src/types/enums";
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
		expect(uids.PublishedIntervention).toBe(
			"0xdd878a5f30778556539f95ad707687ad882348add80f264aa613cec830a0a9cc",
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
		expect(uids.PublishedIntervention).toBe(
			"0xdd878a5f30778556539f95ad707687ad882348add80f264aa613cec830a0a9cc",
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
				boundariesHash:
					"0x0000000000000000000000000000000000000000000000000000000000000000",
				metadata: "",
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
				boundariesHash:
					"0x0000000000000000000000000000000000000000000000000000000000000000",
				metadata: "",
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
		});

		expect(results).toHaveLength(4);
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

		// 8 schemas total
		expect(results).toHaveLength(8);
		expect(attestCalls).toHaveLength(8);

		const names = results.map((r) => r.name);
		expect(names).toContain("AreaRegistration");
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

	it("submits all 4 attestations to easscan store", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true });
		vi.stubGlobal("fetch", fetchMock);

		const client = createClient();
		const results = await client.indexBundleAttestations(BUNDLE_INPUT);

		expect(results).toHaveLength(4);
		expect(results.every((r) => r.ok)).toBe(true);
		expect(results.map((r) => r.role)).toEqual([
			"scheduled",
			"checkin",
			"checkout",
			"report",
		]);
		expect(results[1].crewIndex).toBe(0);
		expect(results[2].crewIndex).toBe(0);
		expect(results[3].crewIndex).toBe(0);
		expect(results[0].uid).toBe("0xsched");
		expect(results[1].uid).toBe("0xcheckin");
		expect(fetchMock).toHaveBeenCalledTimes(4);

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

		expect(results).toHaveLength(4);
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

		expect(results).toHaveLength(4);
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
		expect(okCount).toBe(3);
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
			commissionId: null,
			evidenceBundleHash:
				"0x0000000000000000000000000000000000000000000000000000000000000000",
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
			interventionType: 1,
			executionDate: 1000000n,
			commissionId: null,
		});

		expect(storageMock.upload).toHaveBeenCalledTimes(1);
		expect(result.bundle.bundleVersion).toBe(EVIDENCE_BUNDLE_VERSION);
		expect(result.evidenceBundleHash).toBe("0xbundlehash");
		expect(result.indexedCount).toBe(4);
		expect(result.publication.uid).toBe("0xpublishuid");
		expect(fetchMock).toHaveBeenCalledTimes(4);

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
			interventionType: 1,
			executionDate: 1000000n,
			commissionId: null,
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

	it("LENIENT_FINALIZE_POLICY publishes despite preflight issues", async () => {
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

		// Backfilled execution date — STRICT would block, LENIENT allows.
		const { LENIENT_FINALIZE_POLICY } = await import("../src/policy");
		const result = await client.finalizeIntervention(
			{
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
				interventionType: 1,
				executionDate: 1000000n,
				commissionId: null,
			},
			{ policy: LENIENT_FINALIZE_POLICY },
		);

		expect(result.publication.uid).toBe("0xpublishuid");
		vi.unstubAllGlobals();
	});

	it("custom policy blocks only selected issue codes", async () => {
		const { finalizePolicy } = await import("../src/policy");
		const { FinalizeInputIssueCode } = await import("../src/preflight");

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

		// Policy blocks only EMPTY_CREW. Backfilled date is tolerated.
		const policy = finalizePolicy({
			blocking: [FinalizeInputIssueCode.EMPTY_CREW],
		});

		// Empty crew → blocks.
		await expect(
			client.finalizeIntervention(
				{
					interventionId: "INT-001",
					areaUID: "0xarea",
					scheduled: makeFakeResult("0xsched"),
					crew: [],
					interventionType: 1,
					executionDate: 1000000n,
					commissionId: null,
				},
				{ policy },
			),
		).rejects.toThrow(/EMPTY_CREW/);
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
			boundariesHash:
				"0x0000000000000000000000000000000000000000000000000000000000000001",
			metadata: "",
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
	const FAKE_AREA_UID =
		"0x000000000000000000000000000000000000000000000000000000000000abcd";

	function makeEncodedIntervention() {
		return encodePublishedIntervention({
			areaUID: FAKE_AREA_UID,
			interventionId: "INT-001",
			interventionType: 1,
			executionDate: 1000000n,
			commissionId: null,
			evidenceBundleHash:
				"0x0000000000000000000000000000000000000000000000000000000000000002",
		});
	}

	it("returns decoded intervention for valid uid", async () => {
		const encodedData = makeEncodedIntervention();
		const client = createTestClient({
			eas: {
				getAttestation: async () => ({
					uid: FAKE_INTERVENTION_UID,
					refUID: FAKE_AREA_UID,
					data: encodedData,
					attester: MOCK_SIGNER_ADDRESS,
					recipient: ZERO_ADDRESS,
					time: 1700000000n,
				}),
			} as any,
		});

		const intervention = await client.getIntervention(FAKE_INTERVENTION_UID);

		expect(intervention.uid).toBe(FAKE_INTERVENTION_UID);
		expect(intervention.areaUID).toBe(FAKE_AREA_UID);
		expect(intervention.interventionId).toBe("INT-001");
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
			commissionId: null,
			evidenceBundleHash:
				"0x0000000000000000000000000000000000000000000000000000000000000002",
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
	const FAKE_AREA_UID =
		"0x000000000000000000000000000000000000000000000000000000000000abcd";

	function makeEncodedIntervention(overrides?: {
		executionDate?: bigint;
		evidenceBundleHash?: string;
	}) {
		return encodePublishedIntervention({
			areaUID: FAKE_AREA_UID,
			interventionId: "INT-001",
			interventionType: 1,
			executionDate: overrides?.executionDate ?? 200n,
			commissionId: null,
			evidenceBundleHash:
				overrides?.evidenceBundleHash ??
				"0x0000000000000000000000000000000000000000000000000000000000000002",
		});
	}

	function sig(uid: string, signer: string, refUID: string, time: number) {
		return {
			version: 1,
			uid,
			signer,
			message: {
				schema: "0xschema",
				recipient: ZERO_ADDRESS,
				time,
				expirationTime: 0,
				revocable: false,
				refUID,
				data: "0x",
			},
			signature: { r: "0x", s: "0x", v: 0 },
		};
	}

	function schedEntry(uid: string, ts: number, areaUID = FAKE_AREA_UID) {
		return {
			uid,
			claimedTimestamp: ts,
			onchainTimestamp: ts,
			signedAttestation: sig(uid, "0xOrg", areaUID, ts),
		};
	}

	function crewEntry(
		uid: string,
		attester: string,
		ts: number,
		refUID: string,
	) {
		return {
			uid,
			attester,
			claimedTimestamp: ts,
			onchainTimestamp: ts,
			signedAttestation: sig(uid, attester, refUID, ts),
		};
	}

	function makeValidBundle(
		overrides?: Partial<EvidenceBundle>,
	): EvidenceBundle {
		return {
			interventionId: "INT-001",
			areaUID: FAKE_AREA_UID,
			attestations: {
				scheduled: schedEntry("0xsched", 100),
				checkins: [crewEntry("0xcheckin", "0xAlice", 200, "0xsched")],
				checkouts: [crewEntry("0xcheckout", "0xAlice", 300, "0xcheckin")],
				reports: [crewEntry("0xreport", "0xAlice", 400, "0xsched")],
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
		},
		timestampMap?: Record<string, number>,
	) {
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

		const tsMap = timestampMap ?? {
			"0xsched": 100,
			"0xcheckin": 200,
			"0xcheckout": 300,
			"0xreport": 400,
		};

		const encodedData = makeEncodedIntervention({
			executionDate: interventionOverrides?.executionDate ?? 200n,
		});

		const client = new OpenGardenClient(
			createTestConfig({
				signer: createMockSigner(),
				chain: TEST_CHAIN,
				storage: storageMock,
				eas: {
					getAttestation: async () => ({
						uid: FAKE_INTERVENTION_UID,
						refUID: FAKE_AREA_UID,
						data: encodedData,
						attester: MOCK_SIGNER_ADDRESS,
						recipient: ZERO_ADDRESS,
						time: interventionOverrides?.time ?? 600n,
					}),
					getTimestamp: async (uid: string) => BigInt(tsMap[uid] ?? 0),
					// Stub Offchain so sig verify passes in unit tests. E2E tests
					// exercise real signature recovery against testnet attestations.
					getOffchain: async () => ({
						verifyOffchainAttestationSignature: () => true,
					}),
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
		expect(result.temporalOrderValid).toBe(true);
		expect(result.timestampsVerified).toBe(true);
		expect(result.executionDateBracketed).toBe(true);
	});

	it("valid 2-person crew bundle passes all checks", async () => {
		const bundle = makeValidBundle({
			attestations: {
				scheduled: schedEntry("0xsched", 100),
				checkins: [
					crewEntry("0xciA", "0xAlice", 200, "0xsched"),
					crewEntry("0xciB", "0xBob", 210, "0xsched"),
				],
				checkouts: [
					crewEntry("0xcoA", "0xAlice", 300, "0xciA"),
					crewEntry("0xcoB", "0xBob", 320, "0xciB"),
				],
				reports: [
					crewEntry("0xrpA", "0xAlice", 400, "0xsched"),
					crewEntry("0xrpB", "0xBob", 420, "0xsched"),
				],
			},
		});
		const { client } = createVerifyClient(bundle, undefined, {
			"0xsched": 100,
			"0xciA": 200,
			"0xciB": 210,
			"0xcoA": 300,
			"0xcoB": 320,
			"0xrpA": 400,
			"0xrpB": 420,
		});

		const result = await client.verifyEvidenceBundle(FAKE_INTERVENTION_UID);

		expect(result.valid).toBe(true);
		expect(result.temporalOrderValid).toBe(true);
	});

	it("per-gardener out-of-order (checkout before checkin) fails", async () => {
		const bundle = makeValidBundle({
			attestations: {
				...makeValidBundle().attestations,
				checkins: [crewEntry("0xcheckin", "0xAlice", 500, "0xsched")],
				checkouts: [crewEntry("0xcheckout", "0xAlice", 150, "0xcheckin")],
			},
		});
		const { client } = createVerifyClient(bundle, undefined, {
			"0xsched": 100,
			"0xcheckin": 500,
			"0xcheckout": 150,
			"0xreport": 400,
		});

		const result = await client.verifyEvidenceBundle(FAKE_INTERVENTION_UID);

		expect(result.valid).toBe(false);
		expect(result.temporalOrderValid).toBe(false);
	});

	it("equal per-gardener timestamps (same block) fails strict ordering", async () => {
		const bundle = makeValidBundle({
			attestations: {
				...makeValidBundle().attestations,
				checkins: [crewEntry("0xcheckin", "0xAlice", 200, "0xsched")],
				checkouts: [crewEntry("0xcheckout", "0xAlice", 200, "0xcheckin")],
			},
		});
		const { client } = createVerifyClient(bundle, undefined, {
			"0xsched": 100,
			"0xcheckin": 200,
			"0xcheckout": 200,
			"0xreport": 400,
		});

		const result = await client.verifyEvidenceBundle(FAKE_INTERVENTION_UID);

		expect(result.valid).toBe(false);
		expect(result.temporalOrderValid).toBe(false);
	});

	it("execution date before schedule fails bracketing", async () => {
		const bundle = makeValidBundle({
			attestations: {
				...makeValidBundle().attestations,
				scheduled: schedEntry("0xsched", 300),
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

	it("PROTOCOL_ONLY_VERIFY_POLICY ignores policy-tier failures", async () => {
		const { PROTOCOL_ONLY_VERIFY_POLICY } = await import("../src/policy");
		// Bundle with executionDate post-publication — policy-tier check fails,
		// but PROTOCOL_ONLY doesn't require it.
		const bundle = makeValidBundle();
		const { client } = createVerifyClient(bundle, {
			executionDate: 700n,
			time: 600n,
		});

		const result = await client.verifyEvidenceBundle(FAKE_INTERVENTION_UID, {
			policy: PROTOCOL_ONLY_VERIFY_POLICY,
		});

		expect(result.executionDateBracketed).toBe(false); // sub-check still ran
		expect(result.valid).toBe(true); // but policy doesn't require it
	});

	it("custom verify policy requires only selected checks", async () => {
		const { verifyPolicy } = await import("../src/policy");
		const { VerificationCheckCode } = await import("../src/verification");

		const bundle = makeValidBundle({
			attestations: {
				...makeValidBundle().attestations,
				// Break temporal ordering but leave signatures/timestamps intact.
				checkins: [crewEntry("0xcheckin", "0xAlice", 500, "0xsched")],
				checkouts: [crewEntry("0xcheckout", "0xAlice", 150, "0xcheckin")],
			},
		});
		const { client } = createVerifyClient(bundle, undefined, {
			"0xsched": 100,
			"0xcheckin": 500,
			"0xcheckout": 150,
			"0xreport": 400,
		});

		const policy = verifyPolicy({
			required: [
				VerificationCheckCode.BUNDLE_VERSION,
				VerificationCheckCode.SIGNATURES,
			],
		});
		const result = await client.verifyEvidenceBundle(FAKE_INTERVENTION_UID, {
			policy,
		});

		expect(result.temporalOrderValid).toBe(false);
		expect(result.valid).toBe(true);
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
			"0xreport": 999,
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
							refUID: AREA_UID,
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
		expect(schedules[0].areaUID).toBe(AREA_UID);
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
							refUID: AREA_UID,
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

	it("passes areaUID as EAS refUID", async () => {
		const { client, signCalls } = createRecordClient();

		await client.recordHealthcheck({
			areaUID: AREA_UID,
			healthScore: 8,
			photoHash: ZERO_BYTES32,
			notes: "all good",
			metadata: "",
		});

		expect(signCalls).toHaveLength(1);
		expect(signCalls[0].refUID).toBe(AREA_UID);
	});
});

describe("OpenGardenClient checkin/checkout — message.time override", () => {
	const INT_UID =
		"0x000000000000000000000000000000000000000000000000000000000000beef";
	const CHECKIN_UID =
		"0x000000000000000000000000000000000000000000000000000000000000feed";

	function createSignSpyClient() {
		const signCalls: any[] = [];
		const eas = {
			getOffchain: async () => ({
				signOffchainAttestation: async (params: any) => {
					signCalls.push(params);
					return {
						uid: "0xuid",
						signer: MOCK_SIGNER_ADDRESS,
						message: params,
					};
				},
			}),
			timestamp: async () => ({
				wait: async () => 123n,
				receipt: FAKE_TX_RECEIPT,
			}),
		};
		const client = createTestClient({
			eas: eas as any,
			schemaUIDs: {
				GardenerCheckin: "0xcheckinschema",
				GardenerCheckout: "0xcheckoutschema",
			},
		});
		return { client, signCalls };
	}

	it("checkin uses explicit `time` in message.time", async () => {
		const { client, signCalls } = createSignSpyClient();
		const claimed = 1_700_000_000n;

		await client.checkin({
			interventionUID: INT_UID,
			latitude: 41.89,
			longitude: 12.4964,
			photoHash: ZERO_BYTES32,
			time: claimed,
		});

		expect(signCalls[0].time).toBe(claimed);
	});

	it("checkin accepts a Date for `time`", async () => {
		const { client, signCalls } = createSignSpyClient();
		const claimed = new Date("2024-03-01T12:00:00.000Z");

		await client.checkin({
			interventionUID: INT_UID,
			latitude: 41.89,
			longitude: 12.4964,
			photoHash: ZERO_BYTES32,
			time: claimed,
		});

		expect(signCalls[0].time).toBe(
			BigInt(Math.floor(claimed.getTime() / 1000)),
		);
	});

	it("checkout uses explicit `time` in message.time", async () => {
		const { client, signCalls } = createSignSpyClient();
		const claimed = 1_700_000_500n;

		await client.checkout({
			checkinUID: CHECKIN_UID,
			actualMinutes: 55,
			time: claimed,
		});

		expect(signCalls[0].time).toBe(claimed);
	});

	it("falls back to wall-clock when `time` omitted", async () => {
		const { client, signCalls } = createSignSpyClient();
		const before = BigInt(Math.floor(Date.now() / 1000));

		await client.checkin({
			interventionUID: INT_UID,
			latitude: 41.89,
			longitude: 12.4964,
			photoHash: ZERO_BYTES32,
		});

		const after = BigInt(Math.floor(Date.now() / 1000));
		expect(signCalls[0].time).toBeGreaterThanOrEqual(before);
		expect(signCalls[0].time).toBeLessThanOrEqual(after);
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
			areaUID: AREA_UID,
			healthScore: 6,
			photoHash: ZERO_BYTES32,
			notes: "",
			metadata: "",
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
							refUID: AREA_UID,
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
		expect(healthchecks[0].areaUID).toBe(AREA_UID);
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
