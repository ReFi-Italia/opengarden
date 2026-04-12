import type { TransactionReceipt } from "ethers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenGardenClient } from "../src/client";
import {
	OPTIMISM_MAINNET,
	SCHEMA_NAME_UID,
	ZERO_ADDRESS,
	ZERO_BYTES32,
} from "../src/constants";
import { OpenGardenError, OpenGardenErrorCode } from "../src/errors";
import {
	encodeAreaRegistration,
	encodeGardenerMilestone,
	encodePublishedIntervention,
} from "../src/schemas/encoders";
import type { ChainConfig } from "../src/types/config";
import type { EvidenceBundle } from "../src/types/evidence";
import type { TimestampedOffChainResult } from "../src/types/results";

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
	const FAKE_TX_RECEIPT = { hash: "0xtxhash" } as unknown as TransactionReceipt;

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
	const FAKE_TX_RECEIPT = { hash: "0xtxhash" } as unknown as TransactionReceipt;

	function makeFakeResult(uid: string): TimestampedOffChainResult {
		return {
			uid,
			signedAttestation: {
				uid,
				signer: "0x0000000000000000000000000000000000000001",
				message: { time: 1000000n },
			},
			timestampTxHash: "0xtimestamp",
			onchainTimestamp: 123456n,
			timestampReceipt: FAKE_TX_RECEIPT,
		};
	}

	const BUNDLE_INPUT = {
		interventionId: "INT-001",
		areaUID: "0xarea",
		scheduled: makeFakeResult("0xsched"),
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
			interventionType: 1,
			executionDate: 1000000n,
			healthBefore: 3,
			healthAfter: 8,
			commissionRef:
				"0x0000000000000000000000000000000000000000000000000000000000000000",
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
	const FAKE_TX_RECEIPT = { hash: "0xtxhash" } as unknown as TransactionReceipt;

	function makeFakeResult(uid: string): TimestampedOffChainResult {
		return {
			uid,
			signedAttestation: {
				uid,
				signer: "0x0000000000000000000000000000000000000001",
				message: { time: 1000000n },
			},
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
			commissionRef:
				"0x0000000000000000000000000000000000000000000000000000000000000000",
			crewSize: 1,
		});

		expect(storageMock.upload).toHaveBeenCalledTimes(1);
		expect(result.bundle.bundleVersion).toBe("2.0");
		expect(result.evidenceBundleHash).toBe("0xbundlehash");
		// 1 scheduled + 3 per gardener + 1 validation = 5 off-chain attestations
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
			crew: [
				{
					checkin: makeFakeResult("0xcheckinA"),
					checkout: makeFakeResult("0xcheckoutA"),
					report: makeFakeResult("0xreportA"),
				},
				{
					checkin: makeFakeResult("0xcheckinB"),
					checkout: makeFakeResult("0xcheckoutB"),
					report: makeFakeResult("0xreportB"),
				},
			],
			validation: {
				...makeFakeResult("0xvalidation"),
				approved: true,
				qualityScore: 9,
			},
			healthcheckBefore: {
				...makeFakeResult("0xhcbefore"),
				score: 3,
			},
			healthcheckAfter: {
				...makeFakeResult("0xhcafter"),
				score: 8,
			},
			interventionType: 1,
			executionDate: 1000000n,
			healthBefore: 3,
			healthAfter: 8,
			commissionRef:
				"0x0000000000000000000000000000000000000000000000000000000000000000",
			crewSize: 2,
		});

		// offchainCount = 2 + 3*2 (crew of 2) + 2 (healthchecks) = 10
		const attestData = attestCalls[0].data.data;
		expect(attestData).toBeDefined();

		vi.unstubAllGlobals();
	});

	it("throws INVALID_INPUT when executionDate is before scheduled timestamp", async () => {
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
			commissionRef:
				"0x0000000000000000000000000000000000000000000000000000000000000000",
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

	function createReadClient() {
		const client = new OpenGardenClient({
			signer: createMockSigner(),
			chain: TEST_CHAIN,
		});
		return client;
	}

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
		const client = createReadClient();
		const encodedData = makeEncodedArea();

		(client as any).eas = {
			getAttestation: async () => ({
				uid: FAKE_AREA_UID,
				data: encodedData,
				attester: "0x0000000000000000000000000000000000000001",
				time: 1700000000n,
			}),
		};

		const area = await client.getArea(FAKE_AREA_UID);

		expect(area.uid).toBe(FAKE_AREA_UID);
		expect(area.areaId).toBe("RM-PIGN-042");
		expect(area.name).toBe("Pigneto Park");
		expect(area.municipality).toBe("Roma");
		expect(area.attester).toBe("0x0000000000000000000000000000000000000001");
		expect(area.time).toBe(1700000000n);
	});

	it("throws ATTESTATION_NOT_FOUND for ZERO_BYTES32 uid", async () => {
		const client = createReadClient();

		(client as any).eas = {
			getAttestation: async () => ({
				uid: ZERO_BYTES32,
				data: "0x",
				attester: "0x0000000000000000000000000000000000000000",
				time: 0n,
			}),
		};

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

	function createReadClient() {
		return new OpenGardenClient({
			signer: createMockSigner(),
			chain: TEST_CHAIN,
		});
	}

	function makeEncodedIntervention() {
		return encodePublishedIntervention({
			areaUID:
				"0x000000000000000000000000000000000000000000000000000000000000abcd",
			interventionId: "INT-001",
			interventionType: 1,
			executionDate: 1000000n,
			healthBefore: 3,
			healthAfter: 8,
			commissionRef:
				"0x0000000000000000000000000000000000000000000000000000000000000000",
			evidenceBundleHash:
				"0x0000000000000000000000000000000000000000000000000000000000000002",
			offchainCount: 8,
			crewSize: 2,
		});
	}

	it("returns decoded intervention for valid uid", async () => {
		const client = createReadClient();
		const encodedData = makeEncodedIntervention();

		(client as any).eas = {
			getAttestation: async () => ({
				uid: FAKE_INTERVENTION_UID,
				data: encodedData,
				attester: "0x0000000000000000000000000000000000000001",
				recipient: ZERO_ADDRESS,
				time: 1700000000n,
			}),
		};

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
		const client = createReadClient();

		(client as any).eas = {
			getAttestation: async () => ({
				uid: ZERO_BYTES32,
				data: "0x",
				attester: "0x0000000000000000000000000000000000000000",
				recipient: "0x0000000000000000000000000000000000000000",
				time: 0n,
			}),
		};

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

	function createClient(chain?: ChainConfig) {
		return new OpenGardenClient({
			signer: createMockSigner(),
			chain: chain ?? TEST_CHAIN,
			schemaUIDs: { PublishedIntervention: "0xschema" },
		});
	}

	function makeEncodedIntervention() {
		return encodePublishedIntervention({
			areaUID:
				"0x000000000000000000000000000000000000000000000000000000000000abcd",
			interventionId: "INT-001",
			interventionType: 1,
			executionDate: 1000000n,
			healthBefore: 3,
			healthAfter: 8,
			commissionRef:
				"0x0000000000000000000000000000000000000000000000000000000000000000",
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
							attester: "0x0000000000000000000000000000000000000001",
							recipient: "0x0000000000000000000000000000000000000001",
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

	function createClient() {
		return new OpenGardenClient({
			signer: createMockSigner(),
			chain: TEST_CHAIN,
			schemaUIDs: { GardenerMilestone: "0xschema" },
		});
	}

	function makeEncodedMilestone() {
		return encodeGardenerMilestone({
			recipient: "0x0000000000000000000000000000000000000001",
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
							attester: "0x0000000000000000000000000000000000000001",
							recipient: "0x0000000000000000000000000000000000000001",
							time: "1700000000",
							data: encodedData,
						},
					],
				},
			}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = createClient();
		const milestones = await client.getGardenerMilestones(
			"0x0000000000000000000000000000000000000001",
		);

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
		const milestones = await client.getGardenerMilestones(
			"0x0000000000000000000000000000000000000001",
		);

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
			commissionRef:
				"0x0000000000000000000000000000000000000000000000000000000000000000",
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
			bundleVersion: "2.0",
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

		const client = new OpenGardenClient({
			signer: createMockSigner(),
			chain: TEST_CHAIN,
			storage: storageMock,
		});

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

		(client as any).eas = {
			getAttestation: async () => ({
				uid: FAKE_INTERVENTION_UID,
				data: encodedData,
				attester: "0x0000000000000000000000000000000000000001",
				recipient: ZERO_ADDRESS,
				time: interventionOverrides?.time ?? 600n,
			}),
			getTimestamp: async (uid: string) => BigInt(tsMap[uid] ?? 0),
		};

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

	it("healthcheck temporal ordering violation fails", async () => {
		const bundle = makeValidBundle({
			attestations: {
				...makeValidBundle().attestations,
				healthcheckBefore: {
					uid: "0xhcbefore",
					score: 3,
					onchainTimestamp: 250,
				},
				healthcheckAfter: {
					uid: "0xhcafter",
					score: 8,
					onchainTimestamp: 250,
				},
			},
		});
		const { client } = createVerifyClient(bundle, { offchainCount: 7 });

		const result = await client.verifyEvidenceBundle(FAKE_INTERVENTION_UID);

		expect(result.valid).toBe(false);
		expect(result.healthcheckOrderValid).toBe(false);
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
		const client = new OpenGardenClient({
			signer: createMockSigner(),
			chain: TEST_CHAIN,
		});

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
			bundleVersion: "1.0" as unknown as "2.0",
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
			expect((e as Error).message).toContain("1.0");
		}
	});

	it("rejects a bundle with missing bundleVersion", async () => {
		const bundle = makeValidBundle();
		// Strip bundleVersion to simulate a malformed / ancient bundle.
		const malformed = { ...bundle };
		delete (malformed as Partial<EvidenceBundle>).bundleVersion;
		const { client } = createVerifyClient(malformed as EvidenceBundle);

		await expect(
			client.verifyEvidenceBundle(FAKE_INTERVENTION_UID),
		).rejects.toThrow(/missing/);
	});
});
