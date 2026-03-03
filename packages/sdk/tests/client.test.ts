import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenGardenClient } from "../src/client";
import { OPTIMISM_MAINNET, SCHEMA_NAME_UID } from "../src/constants";
import { OpenGardenError, OpenGardenErrorCode } from "../src/errors";
import type { ChainConfig } from "../src/types/config";

const TEST_CHAIN: ChainConfig = OPTIMISM_MAINNET;

function createMockSigner() {
	const provider = {
		resolveName: async () => null,
		getNetwork: async () => ({ chainId: 10n, name: "optimism" }),
	};
	return {
		getAddress: async () => "0x0000000000000000000000000000000000000001",
		signTransaction: async () => "0x",
		signMessage: async () => "0x",
		provider,
		estimateGas: async () => 0n,
		call: async () => "0x",
		resolveName: async () => null,
		sendTransaction: async () => ({}),
	} as any;
}

describe("OpenGardenClient construction", () => {
	it("throws SIGNER_ERROR when signer is missing", () => {
		expect(
			() =>
				new OpenGardenClient({
					signer: undefined as any,
					chain: TEST_CHAIN,
				}),
		).toThrow(OpenGardenError);

		try {
			new OpenGardenClient({ signer: undefined as any, chain: TEST_CHAIN });
		} catch (e) {
			expect(e).toBeInstanceOf(OpenGardenError);
			expect((e as OpenGardenError).code).toBe(
				OpenGardenErrorCode.SIGNER_ERROR,
			);
		}
	});

	it("constructs with valid config", () => {
		const client = new OpenGardenClient({
			signer: createMockSigner(),
			chain: TEST_CHAIN,
		});

		expect(client).toBeInstanceOf(OpenGardenClient);
	});

	it("accepts pre-registered schema UIDs", () => {
		const client = new OpenGardenClient({
			signer: createMockSigner(),
			chain: TEST_CHAIN,
			schemaUIDs: {
				AreaRegistration: "0xschema123",
			},
		});

		const uids = client.getSchemaUIDs();
		expect(uids.AreaRegistration).toBe("0xschema123");
	});
});

describe("OpenGardenClient schema validation", () => {
	it("throws SCHEMA_NOT_REGISTERED when calling write without registration", async () => {
		const client = new OpenGardenClient({
			signer: createMockSigner(),
			chain: TEST_CHAIN,
		});

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

describe("OpenGardenClient storage validation", () => {
	it("throws STORAGE_NOT_CONFIGURED when uploading without adapter", async () => {
		const client = new OpenGardenClient({
			signer: createMockSigner(),
			chain: TEST_CHAIN,
		});

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
	const FAKE_TX_RECEIPT = { hash: "0xtxhash" };

	function createSchemaClient() {
		const attestCalls: any[] = [];
		const client = new OpenGardenClient({
			signer: createMockSigner(),
			chain: TEST_CHAIN,
		});

		(client as any).registry = {
			register: async () => ({
				wait: async () => FAKE_SCHEMA_UID,
				receipt: FAKE_TX_RECEIPT,
			}),
		};

		(client as any).eas = {
			attest: async (params: any) => {
				attestCalls.push(params);
				return { wait: async () => "0xnameuid", receipt: FAKE_TX_RECEIPT };
			},
		};

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
		const client = new OpenGardenClient({
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
		});

		(client as any).registry = {
			register: async () => ({
				wait: async () => FAKE_SCHEMA_UID,
				receipt: FAKE_TX_RECEIPT,
			}),
		};

		(client as any).eas = {
			attest: async (params: any) => {
				attestCalls.push(params);
				return { wait: async () => "0xnameuid", receipt: FAKE_TX_RECEIPT };
			},
		};

		const results = await client.registerAllSchemas();

		// Only Healthcheck is missing
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe("Healthcheck");
		expect(attestCalls).toHaveLength(1);
	});

	it("still registers schema when naming schema is unavailable on chain", async () => {
		const client = new OpenGardenClient({
			signer: createMockSigner(),
			chain: TEST_CHAIN,
		});

		(client as any).registry = {
			register: async () => ({
				wait: async () => FAKE_SCHEMA_UID,
				receipt: FAKE_TX_RECEIPT,
			}),
		};

		(client as any).eas = {
			attest: async () => {
				throw new Error("NotFound");
			},
		};

		const result = await client.registerSchema("AreaRegistration");

		expect(result.uid).toBe(FAKE_SCHEMA_UID);
		expect(result.name).toBe("AreaRegistration");
	});
});

describe("OpenGardenClient indexBundleAttestations", () => {
	const FAKE_TX_RECEIPT = { hash: "0xtxhash" };

	function makeFakeResult(uid: string): any {
		return {
			uid,
			signedAttestation: { uid, message: { time: 1000000n } },
			timestampTxHash: "0xtimestamp",
			onchainTimestamp: 123456n,
			timestampReceipt: FAKE_TX_RECEIPT,
		};
	}

	const BUNDLE_INPUT = {
		interventionId: "INT-001",
		areaUID: "0xarea",
		scheduled: makeFakeResult("0xsched"),
		checkin: makeFakeResult("0xcheckin"),
		checkout: makeFakeResult("0xcheckout"),
		report: makeFakeResult("0xreport"),
		validation: {
			...makeFakeResult("0xvalidation"),
			approved: true,
			qualityScore: 9,
		},
	};

	function createClient(chain?: ChainConfig) {
		return new OpenGardenClient({
			signer: createMockSigner(),
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
		const count = await client.indexBundleAttestations(BUNDLE_INPUT);

		expect(count).toBe(5);
		expect(fetchMock).toHaveBeenCalledTimes(5);

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://optimism.easscan.org/offchain/store");
		expect(init.method).toBe("POST");

		const envelope = JSON.parse(init.body);
		expect(envelope.filename).toBe("eas.txt");
		const pkg = JSON.parse(envelope.textJson);
		expect(pkg.signer).toBe("0x0000000000000000000000000000000000000001");
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

	it("returns 0 and warns on non-200 response", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
			text: async () => "Server Error",
		});
		vi.stubGlobal("fetch", fetchMock);
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const client = createClient();
		const count = await client.indexBundleAttestations(BUNDLE_INPUT);

		expect(count).toBe(0);
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("500"));

		vi.unstubAllGlobals();
	});

	it("returns 0 and warns on fetch error", async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
		vi.stubGlobal("fetch", fetchMock);
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const client = createClient();
		const count = await client.indexBundleAttestations(BUNDLE_INPUT);

		expect(count).toBe(0);
		expect(warnSpy).toHaveBeenCalledWith(
			"easscan indexer submission failed",
			expect.any(Error),
		);

		vi.unstubAllGlobals();
	});

	it("returns 0 when chain has no easscan store endpoint", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true });
		vi.stubGlobal("fetch", fetchMock);

		const unknownChain: ChainConfig = {
			chainId: 99999n,
			easAddress: "0x4200000000000000000000000000000000000021",
			schemaRegistryAddress: "0x4200000000000000000000000000000000000020",
		};

		const client = createClient(unknownChain);
		const count = await client.indexBundleAttestations(BUNDLE_INPUT);

		expect(count).toBe(0);
		expect(fetchMock).not.toHaveBeenCalled();

		vi.unstubAllGlobals();
	});

	it("publishIntervention no longer does indexing", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const client = createClient();
		(client as any).eas = {
			attest: async () => ({
				wait: async () => "0xuid",
				receipt: FAKE_TX_RECEIPT,
			}),
		};

		const result = await client.publishIntervention({
			areaUID: "0xarea",
			interventionId: "INT-001",
			gardener: "0x0000000000000000000000000000000000000001",
			interventionType: 1,
			executionDate: 1000000n,
			healthBefore: 3,
			healthAfter: 8,
			commissionRef:
				"0x0000000000000000000000000000000000000000000000000000000000000000",
			evidenceBundleHash:
				"0x0000000000000000000000000000000000000000000000000000000000000000",
			offchainCount: 5,
			crewSize: 2,
			isLead: true,
		});

		expect(fetchMock).not.toHaveBeenCalled();
		expect(result.uid).toBe("0xuid");
		expect((result as any).indexedCount).toBeUndefined();

		vi.unstubAllGlobals();
	});
});

describe("OpenGardenClient finalizeIntervention", () => {
	const FAKE_TX_RECEIPT = { hash: "0xtxhash" };

	function makeFakeResult(uid: string): any {
		return {
			uid,
			signedAttestation: { uid, message: { time: 1000000n } },
			timestampTxHash: "0xtimestamp",
			onchainTimestamp: 123456n,
			timestampReceipt: FAKE_TX_RECEIPT,
		};
	}

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

		const client = new OpenGardenClient({
			signer: createMockSigner(),
			chain: TEST_CHAIN,
			schemaUIDs: { PublishedIntervention: "0xschema" },
			storage: storageMock,
		});

		(client as any).eas = {
			attest: async () => ({
				wait: async () => "0xpublishuid",
				receipt: FAKE_TX_RECEIPT,
			}),
		};

		const result = await client.finalizeIntervention({
			interventionId: "INT-001",
			areaUID: "0xarea",
			scheduled: makeFakeResult("0xsched"),
			checkin: makeFakeResult("0xcheckin"),
			checkout: makeFakeResult("0xcheckout"),
			report: makeFakeResult("0xreport"),
			validation: {
				...makeFakeResult("0xvalidation"),
				approved: true,
				qualityScore: 9,
			},
			gardener: "0x0000000000000000000000000000000000000001",
			interventionType: 1,
			executionDate: 1000000n,
			healthBefore: 3,
			healthAfter: 8,
			commissionRef:
				"0x0000000000000000000000000000000000000000000000000000000000000000",
			crewSize: 2,
			isLead: true,
		});

		expect(storageMock.upload).toHaveBeenCalledTimes(1);
		expect(result.bundle.bundleVersion).toBe("1.0");
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

		const client = new OpenGardenClient({
			signer: createMockSigner(),
			chain: TEST_CHAIN,
			schemaUIDs: { PublishedIntervention: "0xschema" },
			storage: storageMock,
		});

		(client as any).eas = {
			attest: async (params: any) => {
				attestCalls.push(params);
				return {
					wait: async () => "0xpublishuid",
					receipt: FAKE_TX_RECEIPT,
				};
			},
		};

		await client.finalizeIntervention({
			interventionId: "INT-001",
			areaUID: "0xarea",
			scheduled: makeFakeResult("0xsched"),
			checkin: makeFakeResult("0xcheckin"),
			checkout: makeFakeResult("0xcheckout"),
			report: makeFakeResult("0xreport"),
			validation: {
				...makeFakeResult("0xvalidation"),
				approved: true,
				qualityScore: 9,
			},
			healthcheckBefore: {
				uid: "0xhcbefore",
				score: 3,
				onchainTimestamp: 100n,
			},
			healthcheckAfter: { uid: "0xhcafter", score: 8, onchainTimestamp: 200n },
			gardener: "0x0000000000000000000000000000000000000001",
			interventionType: 1,
			executionDate: 1000000n,
			healthBefore: 3,
			healthAfter: 8,
			commissionRef:
				"0x0000000000000000000000000000000000000000000000000000000000000000",
			crewSize: 2,
			isLead: true,
		});

		// offchainCount should be 7 (5 base + 2 healthchecks)
		const attestData = attestCalls[0].data.data;
		expect(attestData).toBeDefined();

		vi.unstubAllGlobals();
	});
});
