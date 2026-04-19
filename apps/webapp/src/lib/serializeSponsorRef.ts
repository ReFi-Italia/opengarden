import {
	type SponsorRef,
	serializeSponsorRef,
	ZERO_BYTES32,
} from "@refi-italia/opengarden";
import { keccak256, toUtf8Bytes } from "ethers";

interface DerivedSponsorHash {
	canonicalJson: string;
	hash: string;
}

/**
 * Derives the canonical JSON + keccak256 hash for a structured sponsor
 * reference. Volunteer maps to the literal 4-char string `"null"` and the
 * `ZERO_BYTES32` hash, matching the protocol's `commissionRef` convention
 * (spec §9.1).
 *
 * Never re-implements the canonical serialization: delegates to the SDK's
 * `serializeSponsorRef` so that any future schema change lands in one place.
 */
export function deriveSponsorHash(ref: SponsorRef): DerivedSponsorHash {
	const canonical = serializeSponsorRef(ref);
	if (canonical === null) {
		return { canonicalJson: "null", hash: ZERO_BYTES32 };
	}
	return {
		canonicalJson: canonical,
		hash: keccak256(toUtf8Bytes(canonical)),
	};
}
