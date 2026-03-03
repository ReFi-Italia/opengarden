import { describe, expect, it } from "vitest";
import { fromMicrodegrees, toMicrodegrees } from "../src/utils";

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
