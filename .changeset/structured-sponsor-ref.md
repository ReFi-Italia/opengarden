---
"@refi-italia/opengarden": minor
---

Accept a structured `SponsorRef` for `commissionId` inputs.

- New `SponsorRef` discriminated union with four variants — `corporate` / `municipal` / `grant` / `volunteer` — lets callers model the commissioning entity explicitly instead of inventing their own string convention per-org.
- `serializeSponsorRef(ref)` produces the canonical JSON shape hashed into `commissionRef`. Volunteer → `null` (SDK maps to `ZERO_BYTES32`). The JSON field order is load-bearing: kind first, kind-specific identifier second. Changing it is a breaking change to the on-chain hash — auditors reproducing a historical `commissionRef` MUST use the serialization in effect at attestation time.
- `PublishedInterventionInput.commissionId` and `ScheduledInterventionInput.commissionId` now accept `string | SponsorRef | null`. The plain-string form from the previous release still works; the structured form is additive. Mixing both forms for the same entity produces different hashes, so callers should commit to one convention per intervention lifecycle.
- `SponsorRef` and `serializeSponsorRef` are exported from the SDK root.
