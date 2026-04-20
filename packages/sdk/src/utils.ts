import { keccak256, toUtf8Bytes } from "ethers";

export function toMicrodegrees(decimal: number): number {
	return Math.trunc(decimal * 1_000_000);
}

export function fromMicrodegrees(micro: number): number {
	return micro / 1_000_000;
}

/**
 * Normalizes a caller-supplied timestamp to a bigint of Unix seconds, matching
 * the `uint64` convention used by EAS schemas. Accepts a `Date` (converted via
 * `getTime() / 1000`, truncated) or a `bigint` already in Unix seconds.
 *
 * `number` is intentionally not accepted because the JS convention (`Date.now()`
 * returns milliseconds) makes `number` ambiguous at call sites; pass a `Date`
 * or `BigInt(unixSeconds)` explicitly.
 */
export function toUnixSeconds(value: Date | bigint): bigint {
	if (typeof value === "bigint") return value;
	return BigInt(Math.floor(value.getTime() / 1000));
}

/**
 * Produces a bytes32 hash of an internal identifier (UUID, staff ID, etc.)
 * per spec §9.1. The SDK applies this automatically to the `commissionId`
 * and `validatorId` input fields; this helper is exported for callers that
 * need to reproduce the same hash outside the encoding path (e.g. to resolve
 * an on-chain `commissionRef` against a known sponsor ID).
 */
export function hashIdentifier(id: string): string {
	if (!id) {
		throw new Error("Cannot hash an empty identifier");
	}
	return keccak256(toUtf8Bytes(id));
}

/**
 * Collapses N photo/media references into a single bytes32 hash suitable for
 * the `photoHash` / `photosHash` / `mediaHash` fields of EAS attestations.
 *
 * The manifest is canonicalized as `{ "v": 1, "items": [<sorted items>] }`
 * and hashed with keccak256. Pass the same list (in any order) to reproduce
 * the same hash. The manifest format is versioned for forward compatibility.
 */
export function hashPhotoBundle(items: readonly string[]): string {
	if (items.length === 0) {
		throw new Error("Cannot hash an empty photo bundle");
	}
	const sorted = [...items].sort();
	const manifest = JSON.stringify({ v: 1, items: sorted });
	return keccak256(toUtf8Bytes(manifest));
}
