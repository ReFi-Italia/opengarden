import { keccak256, toUtf8Bytes } from "ethers";
import { describe, expect, it } from "vitest";
import {
	canonicalJSON,
	fromMicrodegrees,
	hashActivityPayload,
	hashIdentifier,
	hashInterventionScope,
	hashPhotoBundle,
	toMicrodegrees,
	toUnixSeconds,
} from "../src/utils";

describe("toMicrodegrees", () => {
	it("converts positive latitude", () => {
		expect(toMicrodegrees(41.89)).toBe(41890000);
	});

	it("converts negative longitude", () => {
		expect(toMicrodegrees(-12.345678)).toBe(-12345678);
	});

	it("truncates extra decimal places", () => {
		expect(toMicrodegrees(41.8901239)).toBe(41890123);
	});

	it("handles zero", () => {
		expect(toMicrodegrees(0)).toBe(0);
	});

	it("handles equator/prime meridian edge case", () => {
		expect(toMicrodegrees(0.000001)).toBe(1);
	});
});

describe("fromMicrodegrees", () => {
	it("converts back to decimal", () => {
		expect(fromMicrodegrees(41890000)).toBe(41.89);
	});

	it("handles negative values", () => {
		expect(fromMicrodegrees(-12345678)).toBe(-12.345678);
	});

	it("roundtrips correctly", () => {
		const original = 41.890123;
		expect(fromMicrodegrees(toMicrodegrees(original))).toBe(original);
	});

	it("handles zero", () => {
		expect(fromMicrodegrees(0)).toBe(0);
	});
});

describe("hashIdentifier", () => {
	it("returns a 32-byte hex string", () => {
		const hash = hashIdentifier("client-uuid-001");
		expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
	});

	it("is deterministic for the same input", () => {
		expect(hashIdentifier("staff-42")).toBe(hashIdentifier("staff-42"));
	});

	it("produces different hashes for different inputs", () => {
		expect(hashIdentifier("a")).not.toBe(hashIdentifier("b"));
	});

	it("matches keccak256(toUtf8Bytes(id))", () => {
		const id = "commission-2026-017";
		expect(hashIdentifier(id)).toBe(keccak256(toUtf8Bytes(id)));
	});

	it("throws on empty string", () => {
		expect(() => hashIdentifier("")).toThrow(/empty/);
	});
});

describe("hashPhotoBundle", () => {
	it("returns a 32-byte hex string", () => {
		const hash = hashPhotoBundle(["ipfs://Qm1", "ipfs://Qm2"]);
		expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
	});

	it("is order-independent", () => {
		const a = hashPhotoBundle(["b", "a", "c"]);
		const b = hashPhotoBundle(["c", "a", "b"]);
		expect(a).toBe(b);
	});

	it("is deterministic for the same input", () => {
		const items = ["ipfs://Qm1", "ipfs://Qm2", "ipfs://Qm3"];
		expect(hashPhotoBundle(items)).toBe(hashPhotoBundle(items));
	});

	it("produces different hashes for different bundles", () => {
		expect(hashPhotoBundle(["a"])).not.toBe(hashPhotoBundle(["a", "b"]));
	});

	it("reproduces the documented manifest shape", () => {
		const items = ["ipfs://Qm-b", "ipfs://Qm-a"];
		const manifest = JSON.stringify({
			v: 1,
			items: ["ipfs://Qm-a", "ipfs://Qm-b"],
		});
		expect(hashPhotoBundle(items)).toBe(keccak256(toUtf8Bytes(manifest)));
	});

	it("throws on empty bundle", () => {
		expect(() => hashPhotoBundle([])).toThrow(/empty/);
	});
});

describe("toUnixSeconds", () => {
	it("passes a bigint through unchanged", () => {
		expect(toUnixSeconds(1709251200n)).toBe(1709251200n);
	});

	it("converts a Date to seconds (truncating ms)", () => {
		const date = new Date("2024-03-01T00:00:00.789Z");
		expect(toUnixSeconds(date)).toBe(1709251200n);
	});

	it("converts the Unix epoch", () => {
		expect(toUnixSeconds(new Date(0))).toBe(0n);
	});
});

describe("hashInterventionScope", () => {
	it("returns a 32-byte hex string", () => {
		expect(hashInterventionScope("INT-2026-0187")).toMatch(/^0x[0-9a-f]{64}$/);
	});

	it("matches keccak256(utf8Bytes(interventionId))", () => {
		const id = "INT-2026-0187";
		expect(hashInterventionScope(id)).toBe(keccak256(toUtf8Bytes(id)));
	});

	it("is deterministic", () => {
		expect(hashInterventionScope("INT-001")).toBe(
			hashInterventionScope("INT-001"),
		);
	});

	it("produces different hashes for different interventionIds", () => {
		expect(hashInterventionScope("INT-001")).not.toBe(
			hashInterventionScope("INT-002"),
		);
	});

	it("throws on empty string", () => {
		expect(() => hashInterventionScope("")).toThrow(/empty/);
	});
});

describe("canonicalJSON", () => {
	it("sorts object keys lexicographically", () => {
		expect(canonicalJSON({ b: 1, a: 2, c: 3 })).toBe(`{"a":2,"b":1,"c":3}`);
	});

	it("sorts keys recursively at every nesting depth", () => {
		expect(canonicalJSON({ z: { b: 1, a: 2 }, a: 3 })).toBe(
			`{"a":3,"z":{"a":2,"b":1}}`,
		);
	});

	it("preserves array element order", () => {
		expect(canonicalJSON({ items: ["c", "a", "b"] })).toBe(
			`{"items":["c","a","b"]}`,
		);
	});

	it("drops undefined values", () => {
		expect(canonicalJSON({ a: 1, b: undefined, c: 3 })).toBe(`{"a":1,"c":3}`);
	});

	it("preserves null values", () => {
		expect(canonicalJSON({ a: null, b: 1 })).toBe(`{"a":null,"b":1}`);
	});

	it("emits no whitespace", () => {
		expect(canonicalJSON({ a: 1, b: [1, 2, 3] })).not.toMatch(/\s/);
	});

	it("produces byte-identical output for same logical payload regardless of insertion order", () => {
		expect(canonicalJSON({ a: 1, b: 2 })).toBe(canonicalJSON({ b: 2, a: 1 }));
	});

	it("handles deeply nested objects", () => {
		const payload = {
			outer: {
				z: 1,
				a: {
					nested: "value",
					more: true,
				},
			},
		};
		expect(canonicalJSON(payload)).toBe(
			`{"outer":{"a":{"more":true,"nested":"value"},"z":1}}`,
		);
	});

	it("handles arrays of objects without sorting element keys of different objects differently", () => {
		const payload = { list: [{ b: 2, a: 1 }, { a: 3, b: 4 }] };
		expect(canonicalJSON(payload)).toBe(
			`{"list":[{"a":1,"b":2},{"a":3,"b":4}]}`,
		);
	});
});

describe("hashActivityPayload", () => {
	it("returns a 32-byte hex string", () => {
		expect(hashActivityPayload({ actualMinutes: 45 })).toMatch(
			/^0x[0-9a-f]{64}$/,
		);
	});

	it("matches keccak256(utf8Bytes(canonicalJSON(payload)))", () => {
		const payload = { actualMinutes: 45 };
		expect(hashActivityPayload(payload)).toBe(
			keccak256(toUtf8Bytes(canonicalJSON(payload))),
		);
	});

	it("is stable regardless of key insertion order", () => {
		const a = hashActivityPayload({ a: 1, b: 2, c: 3 });
		const b = hashActivityPayload({ c: 3, b: 2, a: 1 });
		expect(a).toBe(b);
	});

	it("produces different hashes for different payloads", () => {
		expect(hashActivityPayload({ actualMinutes: 45 })).not.toBe(
			hashActivityPayload({ actualMinutes: 46 }),
		);
	});

	it("handles empty payload", () => {
		expect(hashActivityPayload({})).toMatch(/^0x[0-9a-f]{64}$/);
	});

	it("treats missing keys and undefined keys as equivalent", () => {
		expect(hashActivityPayload({ a: 1 })).toBe(
			hashActivityPayload({ a: 1, b: undefined }),
		);
	});

	it("does NOT treat missing keys and null keys as equivalent", () => {
		expect(hashActivityPayload({ a: 1 })).not.toBe(
			hashActivityPayload({ a: 1, b: null }),
		);
	});
});
