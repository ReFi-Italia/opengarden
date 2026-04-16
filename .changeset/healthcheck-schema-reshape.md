---
"@refi-italia/opengarden": minor
---

Reshape Healthcheck attestation schema for single-assessment model.

**Breaking changes:**

- `areaUID` removed from `HealthcheckInput` and from the encoded on-chain schema. Area linkage now flows through the EAS native `refUID` parameter (free on-chain indexing, no schema field consumed).
- `assessorNotes` and `interventionNeeded` removed from `HealthcheckInput` and the on-chain schema. Both move to off-chain `metadataHash` JSON: `{ version: 1, baseline?: { score, sourceUID? }, assessorNotes?, interventionNeeded? }`.
- `metadataHash: string | null` added to `HealthcheckInput`. Encodes as `ZERO_BYTES32` when null.
- `recordHealthcheck` signature changed from `(data)` to `(areaUID: string, data: HealthcheckInput)`.
- Evidence bundle `healthcheckBefore`/`healthcheckAfter` replaced by a single `healthcheck?: { ...result, score, baselineScore? }`. One healthcheck attestation per intervention instead of two. `offchainCount` decreases by 1 accordingly.
- `BundleIndexingRole` values `healthcheckBefore`/`healthcheckAfter` replaced by `healthcheck`.
- `FinalizeInputIssueCode` values `HEALTHCHECK_BEFORE_REFUID_MISMATCH`, `HEALTHCHECK_AFTER_REFUID_MISMATCH`, `HEALTHCHECK_BEFORE_OUT_OF_BRACKET`, `HEALTHCHECK_AFTER_OUT_OF_BRACKET` removed; replaced by `HEALTHCHECK_REFUID_MISMATCH`.
- `verifyBundleHealthcheckBracket` always returns valid — retroactive assessment means no temporal bracket is enforced.
- New Healthcheck EAS schema UID deployed on Optimism Sepolia: `0xb5f901113d6db303c6c7857e3b79f7ff9f472694334e282473cbb0c08c8ee2ae`.

**Rationale:** The original two-attestation before/after model required two separate site visits. The new single-assessment model lets the admin record both the current score and an optional baseline (from pre-work crew photos) in one retroactive attestation at validation time. `areaUID` as a schema field was redundant since EAS already indexes by `refUID`.

Spec, encoders, decoder, types, tests, and README updated.
