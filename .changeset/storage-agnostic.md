---
"@refi-italia/opengarden": minor
---

Storage-Agnostic Commitments (spec §1) — SDK no longer uploads or downloads anything; protocol commits to bytes via `keccak256`, storage is the publisher's concern. SDK computes hashes from raw inputs.

**Architectural change**

- `StorageAdapter` interface removed. `OpenGardenConfig.storage` field removed. The client never touches storage.
- `OpenGardenErrorCode.STORAGE_NOT_CONFIGURED` removed.
- `client.uploadEvidenceBundle(bundle)` → `client.serializeEvidenceBundle(bundle)` returning `{ bytes, hash }`. The caller persists the bytes wherever verifiers can fetch them; the hash is committed on-chain as `Intervention.evidenceBundleHash`.
- `client.uploadMedia(data)` and `client.uploadMediaBundle(items)` removed.
- `client.verifyEvidenceBundle(uid)` → `client.verifyEvidenceBundle(uid, bundleBytes)`. The caller fetches bytes from wherever the publisher serves them and passes them in. Verification checks `keccak256(bundleBytes) === intervention.evidenceBundleHash` and surfaces it as `EvidenceBundleVerification.bundleHashValid`.
- `FinalizeInterventionResult` keeps `bundle: EvidenceBundle` + `evidenceBundleHash`. The app persists whatever shape it wants and calls `serializeEvidenceBundle(bundle)` when it needs canonical bytes. The SDK doesn't prescribe a storage shape.

**Boundary input — SDK computes hash**

- `AreaRegistrationInput.boundariesHash: string | null` replaced by `AreaRegistrationInput.boundary: Record<string, unknown> | null`.
- Callers pass the raw boundary blob (polygon GeoJSON plus any inline attributes they want signature coverage over). SDK canonicalizes per spec §9.8 and commits `keccak256(canonicalJSON(boundary))` to the on-chain `boundariesHash` slot. `null` still encodes as `ZERO_BYTES32`.
- Matches the pattern used by `commissionRef` (SDK hashes an identifier string) and `payloadHash` (SDK hashes a payload object) — callers never hand-hash.
- New helper `hashBoundary(blob: Record<string, unknown>): string` exposed for callers that need to reproduce the hash outside the encoding path (verifier-side audit).

**Payload field rename (mediaCID → mediaHash)**

- `ReportActivityInput.mediaCID` / `ReportActivityPayload.mediaCID` / `HealthcheckActivityInput.mediaCID` / `HealthcheckActivityPayload.mediaCID` → `mediaHash` (`keccak256` of the media bytes or canonical manifest, 0x-prefixed bytes32 hex).

**Media manifest (spec §9.2)**

- New shape `{ v: 1, items: [{hash, contentType?}] }`, sorted by `hash`.
- Publishers persist both the individual file bytes and the manifest bytes; the payload's `mediaHash` is `keccak256(fileBytes)` (single-file shape) or `keccak256(manifestBytes)` (multi-file shape).

**Utility changes**

- `hashMediaManifest(items: string[])` removed.
- `hashMediaFile(bytes: Uint8Array | string): string` added — single-file keccak helper.
- `buildMediaManifest(items: MediaManifestItem[]): { bytes, hash }` added — builds the canonical `{v:1, items:[...]}` manifest, returns both serialized bytes (for persistence) and their keccak256 (for the payload's `mediaHash`). `MediaManifestItem` = `{ hash: string; contentType?: string }`.
- `serializeEvidenceBundle(bundle): { bytes, hash }` added (also exposed on `OpenGardenClient`).

**Migration**

```ts
// Write-side: SDK no longer uploads
const result = await client.finalizeIntervention(input);
// result.bundle + result.evidenceBundleHash — persist however the app prefers;
// call serializeEvidenceBundle(result.bundle) when canonical bytes are needed.

// Read-side: app fetches bytes from wherever it stored them
const verification = await client.verifyEvidenceBundle(interventionUID, bundleBytes);
// verification.bundleHashValid === true iff keccak256(bundleBytes) matches the on-chain hash

// Media
import { hashMediaFile } from '@refi-italia/opengarden';
await client.submitReport({ ..., mediaHash: hashMediaFile(photoBytes) });
```
