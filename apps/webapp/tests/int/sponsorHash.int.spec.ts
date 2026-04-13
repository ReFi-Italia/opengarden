import {
	type SponsorRef,
	serializeSponsorRef,
	ZERO_BYTES32,
} from "@refi-italia/opengarden/helpers";
import { keccak256, toUtf8Bytes } from "ethers";
import { describe, expect, it } from "vitest";
import { deriveSponsorHash } from "@/lib/serializeSponsorRef";

describe("deriveSponsorHash", () => {
	it("matches the SDK serialization for every variant", () => {
		const cases: SponsorRef[] = [
			{ kind: "corporate", sponsorId: "ACME-001" },
			{ kind: "municipal", contractNumber: "RM-2026-CT-42" },
			{ kind: "grant", grantId: "EU-LIFE-2024-1234" },
		];
		for (const ref of cases) {
			const expectedJson = serializeSponsorRef(ref);
			expect(expectedJson).not.toBeNull();
			const expectedHash = keccak256(toUtf8Bytes(expectedJson as string));

			const derived = deriveSponsorHash(ref);
			expect(derived.canonicalJson).toBe(expectedJson);
			expect(derived.hash).toBe(expectedHash);
		}
	});

	it('maps volunteer to "null" and ZERO_BYTES32', () => {
		const derived = deriveSponsorHash({ kind: "volunteer" });
		expect(derived.canonicalJson).toBe("null");
		expect(derived.hash).toBe(ZERO_BYTES32);
	});

	it("treats JSON field order as load-bearing", () => {
		const ref: SponsorRef = { kind: "corporate", sponsorId: "X-1" };
		const canonical = deriveSponsorHash(ref).hash;

		const reversedOrder = JSON.stringify({
			sponsorId: "X-1",
			kind: "corporate",
		});
		const reversedHash = keccak256(toUtf8Bytes(reversedOrder));

		expect(canonical).not.toBe(reversedHash);
	});
});
