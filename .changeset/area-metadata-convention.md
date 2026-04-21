---
"@refi-italia/opengarden": minor
---

Unify metadata/hash conventions on `AreaRegistration` and formalize the rule in spec §9.6.

**Breaking changes:**

- **AreaRegistration schema** reshaped from
  `string areaId, int32 latitude, int32 longitude, uint8 areaType, string name, string municipality, bytes32 metadataHash`
  to
  `string areaId, int32 latitude, int32 longitude, uint8 areaType, string name, string municipality, bytes32 boundariesHash, string metadata`.
  - Generic `metadataHash` renamed to purpose-named `boundariesHash` (content-addressable hash of a large boundary payload: polygon GeoJSON, photo bundle, etc.; `ZERO_BYTES32` for orgs without boundary data).
  - New inline `metadata` string field: small JSON escape hatch for app-specific extras (surface area, access hours, institutional labels). Empty string for none.
- **`AreaRegistrationInput`** drops `metadataHash: string | null`; gains `boundariesHash: string | null` + `metadata: string`.
- **`Area`** attestation type drops `metadataHash: string`; gains `boundariesHash: string` + `metadata: string`.
- **`chains/schemas.json`** — stale `AreaRegistration` UID for `optimism-sepolia` cleared; the schema must be re-registered on every chain.

**Spec changes (`docs/eas-schema-spec.md`):**

- New **§9.6 Inline metadata vs hashed payloads** formalizes the protocol-wide rule: `string metadata` is the inline JSON escape hatch (small, signed bytes, SHOULD stay under 512 bytes); `bytes32 *Hash` is the content-addressable hash for large/binary payloads and MUST use a purpose-named field (`photoHash`, `photosHash`, `evidenceBundleHash`, `boundariesHash`). The generic name `metadataHash` is banned.
- §2.1 (AreaRegistration), §3.5 (Healthcheck), §8 (schema registration), §9.2 (photo/media bundle derivation) updated to match.

**Rationale:** Two metadata-shaped fields existed with divergent shapes — `AreaRegistration.metadataHash` (bytes32 → IPFS JSON) and `Healthcheck.metadata` (inline string JSON). Same conceptual slot, two implementations, no documented rule for which to pick. §9.6 codifies a single convention keyed off payload size (inline small struct vs hashed large/binary), aligns AreaRegistration to it, and removes the ambiguity for any future schema extension. Budget is advisory — SDK does not enforce it at the write layer.
