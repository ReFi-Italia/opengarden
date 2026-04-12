---
"@refi-italia/opengarden": minor
---

Break `verifyEvidenceBundle` into composable, independently-callable checks.

- New `src/verification.ts` module exports pure, sync helpers for every integrity check the SDK runs on an evidence bundle: `verifyBundleVersion`, `verifyBundleCompleteness`, `verifyBundleTemporalOrder`, `verifyBundleHealthcheckBracket`, `verifyBundleExecutionDateBracket`, `verifyBundleValidationApproved`. Each returns a typed `VerificationCheck` with `{ code, valid, message? }`. `VerificationCheckCode` is exported as an enum so UIs can render per-check badges by code instead of hardcoded strings.
- New async helper `verifyBundleOnChainTimestamps(bundle, fetchTimestamp)` accepts an injected `TimestampFetcher` so the network-bound check is usable with any EAS instance or test stub. Fetch failures for individual UIDs are treated as mismatches, not thrown errors.
- `client.verifyEvidenceBundle(uid)` is now a thin orchestrator that delegates to the new helpers and adds a new `checks: VerificationCheck[]` field to `EvidenceBundleVerification` for rendering "X of N integrity checks passed" UX. All previously-exposed boolean fields are preserved.
- Apps that already have a bundle in memory (e.g. just after finalizing, or loaded from an external source) can now run the individual checks without going through the client's storage-backed round trip.
