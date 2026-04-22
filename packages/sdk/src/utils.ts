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
 * input fields; this helper is exported for callers that need to reproduce
 * the same hash outside the encoding path (e.g. to resolve an on-chain
 * `commissionRef` against a known sponsor ID).
 */
export function hashIdentifier(id: string): string {
	if (!id) {
		throw new Error("Cannot hash an empty identifier");
	}
	return keccak256(toUtf8Bytes(id));
}

/**
 * Intervention scope hash — the bytes32 anchor every lifecycle Activity carries
 * in its EAS `refUID` slot. Computed as `keccak256(utf8Bytes(interventionId))`
 * per spec §9.7. Letting the hash be computable from the interventionId string
 * alone means crew devices can sign their checkins without needing the schedule
 * Activity's UID — they just need the human-readable interventionId.
 *
 * The derivation is identical to `hashIdentifier` but exposed under a purpose-
 * specific name so call sites read clearly and future changes to the scope-hash
 * convention (e.g. namespacing by publisher) don't ripple through unrelated
 * identifier hashes.
 */
export function hashInterventionScope(interventionId: string): string {
	if (!interventionId) {
		throw new Error("Cannot hash an empty interventionId");
	}
	return keccak256(toUtf8Bytes(interventionId));
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

/**
 * Canonical JSON serialization per spec §9.8. Recursively sorts object keys in
 * JavaScript default string-comparison order (UTF-16 code unit) and emits with
 * no whitespace. Arrays retain their original element order.
 *
 * This function is normative for Activity payload hashing: two implementations
 * producing the same logical payload MUST produce byte-identical canonical JSON
 * so their `payloadHash` values match.
 *
 * Missing / `undefined` values are dropped (JSON.stringify behavior), matching
 * §9.8 rule 6. `null` is preserved as-is. Duplicate keys are impossible in a
 * JS object literal so no special handling is needed.
 */
export function canonicalJSON(value: unknown): string {
	return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
	if (value === null) return null;
	if (typeof value !== "object") return value;
	if (Array.isArray(value)) return value.map(canonicalize);
	const input = value as Record<string, unknown>;
	const sorted: Record<string, unknown> = {};
	for (const key of Object.keys(input).sort()) {
		const v = input[key];
		if (v === undefined) continue;
		sorted[key] = canonicalize(v);
	}
	return sorted;
}

/**
 * Keccak256 of the canonical-JSON serialization of an Activity payload, per
 * spec §9.8. This value is committed on-chain via the Activity schema's
 * `payloadHash` field and re-derived by verifiers to prove payload integrity.
 *
 * Accepts `unknown` so that callers can pass typed payload interfaces (e.g.
 * `ScheduleActivityPayload`) without an intermediate `Record<string, unknown>`
 * cast — `canonicalJSON` handles arbitrary JSON-serializable input.
 */
export function hashActivityPayload(payload: unknown): string {
	return keccak256(toUtf8Bytes(canonicalJSON(payload)));
}
