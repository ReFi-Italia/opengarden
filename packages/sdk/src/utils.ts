import { keccak256, toUtf8Bytes } from "ethers";

export function toMicrodegrees(decimal: number): number {
	return Math.trunc(decimal * 1_000_000);
}

export function fromMicrodegrees(micro: number): number {
	return micro / 1_000_000;
}

/**
 * Produces a bytes32 hash of an internal identifier (UUID, staff ID, etc.)
 * for use in hashed-identifier fields: `commissionRef`, `validatorId`,
 * `assessorId`. Keeps personal or contractual identifiers off-chain while
 * preserving equality checks on-chain.
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
