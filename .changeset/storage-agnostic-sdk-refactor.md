---
"@refi-italia/opengarden": minor
---

Refactor the SDK around the Storage-Agnostic Commitments principle (spec §1): the protocol commits to bytes via keccak256, storage is the publisher's concern. The SDK no longer uploads or downloads anything.

**Breaking changes**

- `StorageAdapter` interface removed. `OpenGardenConfig.storage` field removed. The client never touches storage.
- `OpenGardenErrorCode.STORAGE_NOT_CONFIGURED` removed.
- `client.uploadEvidenceBundle(bundle)` → replaced by `client.serializeEvidenceBundle(bundle)` which returns `{ bytes, hash }`. The caller persists the bytes wherever verifiers can fetch them; the hash is committed on-chain as `Intervention.evidenceBundleHash`.
- `client.uploadMedia(data)` and `client.uploadMediaBundle(items)` removed (they were added in an earlier revision of this branch, pre-principle).
- `client.verifyEvidenceBundle(uid)` → `client.verifyEvidenceBundle(uid, bundleBytes)`. The caller fetches bytes from wherever the publisher serves them and passes them in. Verification now also checks `keccak256(bundleBytes) === intervention.evidenceBundleHash` and surfaces it as `EvidenceBundleVerification.bundleHashValid`.
- `FinalizeInterventionResult` keeps `bundle: EvidenceBundle` + `evidenceBundleHash` (no new fields). The app persists whatever shape it wants and calls `serializeEvidenceBundle(bundle)` when it needs canonical bytes. The SDK doesn't prescribe a storage shape.

**Payload field rename (mediaCID → mediaHash)**

- `ReportActivityInput.mediaCID: string` → `ReportActivityInput.mediaHash: string` (keccak256 of the media bytes or canonical manifest, 0x-prefixed bytes32 hex).
- `ReportActivityPayload.mediaCID` → `ReportActivityPayload.mediaHash`.
- `HealthcheckActivityInput.mediaCID` → `HealthcheckActivityInput.mediaHash`.
- `HealthcheckActivityPayload.mediaCID` → `HealthcheckActivityPayload.mediaHash`.

The spec §9.2 manifest format is the new shape `{ v: 1, items: [{hash, contentType?}] }`, sorted by `hash`. Publishers persist both the individual file bytes and the manifest bytes; the payload's `mediaHash` is either `keccak256(fileBytes)` (single-file shape) or `keccak256(manifestBytes)` (multi-file shape).

**Utility changes**

- `hashMediaManifest(items: string[]): string` removed.
- `hashMediaFile(bytes: Uint8Array | string): string` added — single-file keccak helper.
- `buildMediaManifest(items: MediaManifestItem[]): { bytes, hash }` added — builds the canonical `{v:1, items:[...]}` manifest, returns both the serialized bytes (for persistence) and their keccak256 (for the payload's `mediaHash`). `MediaManifestItem` = `{ hash: string; contentType?: string }`.
- `serializeEvidenceBundle(bundle): { bytes, hash }` added (also exposed on `OpenGardenClient`).

**Migration**

Write-side:

```ts
// Before
const result = await client.finalizeIntervention(input);
// SDK uploaded; result.evidenceBundleHash came from the adapter

// After
const result = await client.finalizeIntervention(input);
// result.bundle + result.evidenceBundleHash — persist however the app prefers;
// call serializeEvidenceBundle(result.bundle) when canonical bytes are needed.
```

Read-side:

```ts
// Before
const verification = await client.verifyEvidenceBundle(interventionUID);

// After — app fetches bytes from wherever it chose to store them
const verification = await client.verifyEvidenceBundle(interventionUID, bundleBytes);
// verification.bundleHashValid === true iff keccak256(bundleBytes) matches the on-chain hash
```

Media:

```ts
// Before
const cid = await client.uploadMedia(photoBytes);
await client.submitReport({ ..., mediaCID: cid });

// After
import { hashMediaFile } from '@refi-italia/opengarden';
await client.submitReport({ ..., mediaHash: hashMediaFile(photoBytes) });
```

All 337 SDK tests pass (324 unit + 13 E2E on optimism-sepolia).
