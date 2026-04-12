---
"@refi-italia/opengarden": patch
---

Parallelize bundle indexing and verification.

- `indexBundleAttestations` now submits all attestations concurrently via `Promise.all` instead of awaiting each in sequence. For a crew-of-N intervention with healthchecks, this collapses `2 + 3N + healthcheckCount` serial HTTP round-trips into a single fan-out.
- `verifyEvidenceBundle` now reads on-chain timestamps concurrently instead of sequentially. It also now includes optional healthchecks in the timestamp-verification set — previously `attestationCount` counted them but `timestampsVerified` silently skipped them, so a tampered healthcheck timestamp could have slipped through.
- `verifyEvidenceBundle` hoists `minCheckin` / `maxCheckout` / `maxReport` so the healthcheck temporal block stops recomputing them from the crew arrays.

Behavior note: because indexing and timestamp reads now fan out, callers with strict per-host concurrency limits (e.g. an indexer that rate-limits per IP) may see more concurrent requests than before. The total number of requests is unchanged.
