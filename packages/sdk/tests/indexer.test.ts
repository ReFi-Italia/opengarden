import { afterEach, describe, expect, it, vi } from "vitest";
import { getGraphqlUrl, getStoreUrl, submitToIndexer } from "../src/indexer";

describe("getGraphqlUrl", () => {
	it("returns graphql URL for known chains", () => {
		expect(getGraphqlUrl(10n)).toBe("https://optimism.easscan.org/graphql");
		expect(getGraphqlUrl(8453n)).toBe("https://base.easscan.org/graphql");
	});

	it("returns undefined for unknown chains", () => {
		expect(getGraphqlUrl(99999n)).toBeUndefined();
	});
});

describe("getStoreUrl", () => {
	it("returns store URL for known chains", () => {
		expect(getStoreUrl(10n)).toBe(
			"https://optimism.easscan.org/offchain/store",
		);
		expect(getStoreUrl(8453n)).toBe("https://base.easscan.org/offchain/store");
		expect(getStoreUrl(42220n)).toBe("https://celo.easscan.org/offchain/store");
	});

	it("returns undefined for unknown chains", () => {
		expect(getStoreUrl(99999n)).toBeUndefined();
	});
});

describe("submitToIndexer", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("posts attestation to the store URL", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true });
		vi.stubGlobal("fetch", fetchMock);

		const result = await submitToIndexer(
			"https://example.com/store",
			{ uid: "0xabc", message: { time: 1000n } },
			"0xsigner",
		);

		expect(result).toEqual({ ok: true });
		expect(fetchMock).toHaveBeenCalledTimes(1);

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://example.com/store");
		expect(init.method).toBe("POST");

		const envelope = JSON.parse(init.body);
		expect(envelope.filename).toBe("eas.txt");
		const pkg = JSON.parse(envelope.textJson);
		expect(pkg.signer).toBe("0xsigner");
		expect(pkg.sig.uid).toBe("0xabc");
	});

	it("serializes BigInt values as strings", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true });
		vi.stubGlobal("fetch", fetchMock);

		await submitToIndexer(
			"https://example.com/store",
			{ uid: "0x1", message: { time: 999999n } },
			"0xsigner",
		);

		const envelope = JSON.parse(fetchMock.mock.calls[0][1].body);
		const pkg = JSON.parse(envelope.textJson);
		expect(pkg.sig.message.time).toBe("999999");
	});

	it("returns structured error and warns on non-200 response", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
			text: async () => "Server Error",
		});
		vi.stubGlobal("fetch", fetchMock);
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const result = await submitToIndexer(
			"https://example.com/store",
			{ uid: "0x1" },
			"0xsigner",
		);

		expect(result.ok).toBe(false);
		expect(result.error).toContain("500");
		expect(result.error).toContain("Server Error");
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("500"));
	});

	it("returns structured error and warns on network failure", async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
		vi.stubGlobal("fetch", fetchMock);
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const result = await submitToIndexer(
			"https://example.com/store",
			{ uid: "0x1" },
			"0xsigner",
		);

		expect(result.ok).toBe(false);
		expect(result.error).toBe("network down");
		expect(warnSpy).toHaveBeenCalledWith(
			"easscan indexer submission failed",
			expect.any(Error),
		);
	});
});
