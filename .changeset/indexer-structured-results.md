---
"@refi-italia/opengarden": minor
---

Surface per-attestation indexer errors with structured results.

- **Breaking**: `submitToIndexer` now returns `Promise<IndexerSubmissionResult>` (`{ ok, error? }`) instead of `Promise<boolean>`. The HTTP status and response body (or thrown error message) are surfaced via `error` so callers can act on failures. Console warnings are preserved.
- **Breaking**: `client.indexBundleAttestations` now returns `Promise<BundleIndexingResult[]>` instead of `Promise<number>`. Every attestation in the bundle is tagged with `uid`, a `role` literal (`"scheduled"` / `"checkin"` / `"checkout"` / `"report"` / `"validation"` / `"healthcheckBefore"` / `"healthcheckAfter"`), and — for per-member roles — a 0-based `crewIndex`. A caller whose single checkout failed can now see *which* crew member's checkout failed and *why*.
- `FinalizeInterventionResult` gains a new `indexingResults: BundleIndexingResult[]` field. The legacy `indexedCount: number` field is preserved and derived from the new array, so existing dashboards keep working unchanged.
- `IndexerSubmissionResult`, `BundleIndexingResult`, and `BundleIndexingRole` are exported from the SDK root.
