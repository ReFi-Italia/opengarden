---
"@refi-italia/opengarden": minor
---

Rework AreaRegistration boundary input so the SDK computes the on-chain hash.

`AreaRegistrationInput.boundariesHash: string | null` is replaced by `AreaRegistrationInput.boundary: Record<string, unknown> | null`. Callers pass the raw boundary blob (polygon GeoJSON plus any inline attributes they want signature coverage over); the SDK canonicalizes per spec §9.8 and commits `keccak256(canonicalJSON(boundary))` to the on-chain `boundariesHash` slot. `null` still encodes as `ZERO_BYTES32`.

Previously the JSDoc framed the field as an "IPFS CID / storage adapter hash" but the on-chain slot is `bytes32` — a raw CID wouldn't fit. Boundary blobs live in the publisher's app database, not on IPFS; the chain commits only to the keccak256. The new shape matches the pattern used by `commissionRef` (SDK hashes an identifier string) and `payloadHash` (SDK hashes a payload object), so callers never hand-hash.

New helper `hashBoundary(blob: Record<string, unknown>): string` exposed for callers that need to reproduce the hash outside the encoding path (e.g. verifier-side audit).
