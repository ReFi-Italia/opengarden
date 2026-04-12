/**
 * Structured representation of the commissioning entity behind an
 * intervention. When passed as `commissionId` on `PublishedInterventionInput`
 * or `ScheduledInterventionInput`, the SDK canonicalizes it before hashing
 * so the same entity produces the same on-chain `commissionRef` regardless
 * of who constructed the input.
 *
 * The plain-string form is still accepted for callers who maintain their own
 * identifier convention; use `SponsorRef` when you want a protocol-level
 * canonical shape that auditors can reproduce.
 */
export type SponsorRef =
	| { kind: "corporate"; sponsorId: string }
	| { kind: "municipal"; contractNumber: string }
	| { kind: "grant"; grantId: string }
	| { kind: "volunteer" };

/**
 * Canonicalizes a `SponsorRef` into the string that gets hashed into
 * `commissionRef`. Returns `null` for volunteer work, matching the `null →
 * ZERO_BYTES32` convention used elsewhere in the SDK.
 *
 * Canonical shape:
 * - corporate  → `{"kind":"corporate","sponsorId":"<id>"}`
 * - municipal  → `{"kind":"municipal","contractNumber":"<n>"}`
 * - grant      → `{"kind":"grant","grantId":"<id>"}`
 * - volunteer  → `null`
 *
 * The JSON field order is load-bearing: changing it is a breaking change to
 * the on-chain hash and would orphan every historical `commissionRef`. An
 * auditor reproducing an old hash MUST use the serialization that was in
 * effect at attestation time.
 */
export function serializeSponsorRef(ref: SponsorRef): string | null {
	switch (ref.kind) {
		case "volunteer":
			return null;
		case "corporate":
			return JSON.stringify({
				kind: "corporate",
				sponsorId: ref.sponsorId,
			});
		case "municipal":
			return JSON.stringify({
				kind: "municipal",
				contractNumber: ref.contractNumber,
			});
		case "grant":
			return JSON.stringify({ kind: "grant", grantId: ref.grantId });
	}
}
