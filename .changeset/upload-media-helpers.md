---
"@refi-italia/opengarden": minor
---

Add `uploadMedia` and `uploadMediaBundle` helpers for the common media-upload ergonomics case.

- `client.uploadMedia(data: Uint8Array | string): Promise<string>` — single-file passthrough over the configured `StorageAdapter.upload`. Returns the CID, suitable for embedding in `report.mediaCID` or `healthcheck.mediaCID`.
- `client.uploadMediaBundle(items: Array<Uint8Array | string>): Promise<string>` — uploads each blob (parallel), collects CIDs (alongside any already-uploaded CIDs passed as strings), serializes the spec §9.2 canonical manifest (`{v:1, items:[<sorted CIDs>]}`), uploads the manifest, and returns the manifest's CID. Use when a single `report.mediaCID` needs to attest multiple files.

Both throw `STORAGE_NOT_CONFIGURED` when no adapter is configured. `uploadMediaBundle` throws `INVALID_INPUT` on an empty item list.

No changes to the `StorageAdapter` interface. The SDK's storage model is otherwise unchanged — the evidence bundle is still the only SDK-driven upload inside `finalizeIntervention`; these helpers exist so callers don't have to either expose the private `storage` field or reimplement the canonical manifest format every time a report references N photos.
