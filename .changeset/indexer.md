---
"@refi-italia/opengarden": minor
---

Indexer — structured per-attestation results, overridable endpoints.

**Structured submission results**

- **Breaking**: `submitToIndexer` now returns `Promise<IndexerSubmissionResult>` (`{ ok, error? }`) instead of `Promise<boolean>`. The HTTP status and response body (or thrown error message) are surfaced via `error` so callers can act on failures. Console warnings are preserved.
- **Breaking**: `client.indexBundleAttestations` now returns `Promise<BundleIndexingResult[]>` instead of `Promise<number>`. Every attestation in the bundle is tagged with `uid`, a `role` literal (`"scheduled"` / `"checkin"` / `"checkout"` / `"report"` / `"validation"` / `"healthcheckBefore"` / `"healthcheckAfter"`), and — for per-member roles — a 0-based `crewIndex`. A caller whose single checkout failed can now see *which* crew member's checkout failed and *why*.
- `FinalizeInterventionResult` gains a new `indexingResults: BundleIndexingResult[]` field. The legacy `indexedCount: number` field is preserved and derived from the new array, so existing dashboards keep working unchanged.
- `IndexerSubmissionResult`, `BundleIndexingResult`, and `BundleIndexingRole` are exported from the SDK root.

**Overridable endpoints**

- `OpenGardenConfig` gains two optional fields: `graphqlUrl` and `storeUrl`. When set, the SDK uses them for read queries and indexer submissions respectively, falling back to the EASScan defaults derived from the chain ID only when the override is absent. This unblocks self-hosted indexers and makes the SDK usable on chains where EAS is deployed but EASScan is not — callers can point the client at any EAS-compatible GraphQL endpoint without patching the SDK.
