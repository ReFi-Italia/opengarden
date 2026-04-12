---
"@refi-italia/opengarden": minor
---

Switch evidence bundle versioning to semver and centralize in a constant.

- `EvidenceBundle.bundleVersion` is now `"0.1.0"` (was `"2.0"`). Pre-1.0 semver signals the format is still unstable and may change incompatibly.
- New exported constant `EVIDENCE_BUNDLE_VERSION` is the single source of truth. `buildEvidenceBundle` emits it, `verifyEvidenceBundle` checks against it, and the `EvidenceBundle` type is parameterized over `typeof EVIDENCE_BUNDLE_VERSION` so type literals stay in sync automatically.
- Consumers pinning to the old `"2.0"` literal need to update to the exported constant (or the new literal). The crew-handling redesign hasn't been published yet, so there should be no active consumers on `"2.0"`.
