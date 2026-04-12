---
"@refi-italia/opengarden": minor
---

Add `assessorId` to Healthcheck, ship hash helpers, and document SDK encoding conventions.

- **`Healthcheck.assessorId: bytes32`** — privacy-preserving hash of the staff member who performed the assessment, mirroring `AdminValidation.validatorId`. The attester wallet is shared across an organization's staff, so the wallet alone can't attribute individual assessments; `assessorId` closes that gap. `HealthcheckInput` now requires this field. The `Healthcheck` schema string changed — existing on-chain UIDs are stale and must be re-registered.
- **`hashIdentifier(id)`** — new SDK helper that produces the canonical bytes32 hash (`keccak256(utf8Bytes(id))`) for any hashed-identifier field (`commissionRef`, `validatorId`, `assessorId`).
- **`hashPhotoBundle(items)`** — new SDK helper for collapsing N media references into a single bytes32, via a canonical `{v:1,items:[sorted]}` JSON manifest. Lets multi-photo fields (`GardenerReport.photosHash`, etc.) be derived reproducibly across implementations.
- **SDK Encoding Conventions (new spec section 9)** documents the hashed-identifier rule, the photo-bundle manifest format, coordinate microdegrees, and the self-reported-vs-on-chain-timestamp distinction. These conventions are normative for any implementation claiming SDK compatibility.
- **Terminology**: the spec now refers to "Organization wallet" / "the organization" for the attesting entity instead of "OpenGarden wallet" / "OpenGarden", since the OpenGarden Protocol is adopted by many organizations rather than being run by a single one.
