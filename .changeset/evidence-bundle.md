---
"@refi-italia/opengarden": minor
---

Evidence bundle — self-verifying shape, pluggable policies, composable checks, preflight validation.

**Self-verifying bundles**

- Bundles embed full EIP-712 signed attestation per entry (`signedAttestation`). Readers verify signatures and refUID wiring locally — no off-chain store fetch required. `contentHash` field dropped (redundant with `uid`).
- SDK injects `signer` field on every signed attestation at sign time so bundles carry the authoritative signer without requiring recovery at read time.
- Bundle JSON: `signedAttestation.message.time` / `expirationTime` / `nonce` are decimal strings. SDK exposes `bundleJsonReplacer` + `restoreBundleBigInts`.

**Pluggable policies**

- `finalizeIntervention(input, { policy? })` and `verifyEvidenceBundle(uid, { policy? })` accept policy objects.
- Presets: `STRICT_FINALIZE_POLICY`, `MINIMAL_FINALIZE_POLICY`, `LENIENT_FINALIZE_POLICY`, `STRICT_VERIFY_POLICY`, `PROTOCOL_ONLY_VERIFY_POLICY`.
- Builders: `finalizePolicy`, `verifyPolicy`. Default is strict (back-compat).
- Spec `docs/eas-schema-spec.md` updated: §5 reorganized around fat bundle + split protocol/policy verification tiers; §7.1 policy-as-data paragraph; §9.5 bundle JSON serialization rules.

**Composable verification helpers** (`src/verification.ts`)

- Pure sync helpers per check: `verifyBundleVersion`, `verifyBundleCompleteness`, `verifyBundleTemporalOrder`, `verifyBundleExecutionDateBracket`, `verifyBundleSignatures` (protocol), `verifyBundleRefUIDs`, `verifyBundleCrewSize`, `verifyBundleCrewConsistency`, `verifyBundleCrewDistinctness` (policy).
- Each returns typed `VerificationCheck { code, valid, message? }`. `VerificationCheckCode` enum exported for per-check UI badges.
- Async `verifyBundleOnChainTimestamps(bundle, fetchTimestamp)` with injected `TimestampFetcher` — usable with any EAS instance or test stub. Fetch failures treated as mismatches, not thrown errors.
- `client.verifyEvidenceBundle(uid)` is now a thin orchestrator delegating to helpers; adds `checks: VerificationCheck[]` field to `EvidenceBundleVerification` for "X of N integrity checks passed" UX. All previously-exposed booleans preserved.
- `EvidenceBundleVerification` gains `signaturesValid`, `refUIDsValid`.

**Preflight validation**

- `validateFinalizeInput(input): FinalizeInputIssue[]` runs the full spec §4.2 temporal-integrity check; returns flat issue list (empty = ready). Verifies per-crew-member attester consistency, refUID wiring (schedule → checkin/report, checkout → checkin, validation → schedule, healthcheck → area), healthcheck temporal brackets, and `validation.approved`. UIs preview readiness without first-failure.
- `FinalizeInputIssueCode` enum + `FinalizeInputIssue` type exported.
- `extractAttestationMetadata(result)` exposes signer / refUID / time / on-chain timestamp of `TimestampedOffChainResult`.
- `assertAttesterMatches(result, expectedAttester, descriptor?)` and `assertRefUIDMatches(result, expectedRefUID, descriptor?)` for webapps reconstructing persisted attestations before signing a downstream step (e.g. wallet about to sign a checkout matches the one that signed the checkin loaded from DB).
- `client.finalizeIntervention` now delegates to `validateFinalizeInput` and throws a single `OpenGardenError(INVALID_INPUT)` enumerating every issue. Crew inputs that previously survived ad-hoc checks but violated per-member temporal ordering or wiring consistency now fail at finalize time with clearer errors.

**Versioning**

- `EvidenceBundle.bundleVersion` is `"0.1.0"` (was `"2.0"`); pre-1.0 semver signals format still unstable and may change incompatibly.
- New exported constant `EVIDENCE_BUNDLE_VERSION` is the single source of truth. `buildEvidenceBundle` emits it, `verifyEvidenceBundle` checks against it, and the `EvidenceBundle` type is parameterized over `typeof EVIDENCE_BUNDLE_VERSION` so type literals stay in sync.

**Hardening**

- `buildEvidenceBundle` throws `INVALID_INPUT` if a crew member's checkin/checkout/report attestation has no `signer` or `message.attester` (was silently defaulting to empty string).
- `verifyEvidenceBundle` rejects bundles whose `bundleVersion` doesn't match `EVIDENCE_BUNDLE_VERSION` with `BUNDLE_VERIFICATION_FAILED`.
- Removed unused `CrewMemberAttestations` export; `EvidenceBundleBuilderInput.crew` is inline array (no functional change for object-literal callers).

**Parallelization**

- `indexBundleAttestations` submits all attestations concurrently via `Promise.all`. Crew-of-N intervention with healthchecks collapses `2 + 3N + healthcheckCount` serial round-trips into a single fan-out.
- `verifyEvidenceBundle` reads on-chain timestamps concurrently. Now includes optional healthchecks in the timestamp-verification set (previously `attestationCount` counted them but `timestampsVerified` skipped — a tampered healthcheck timestamp could slip through).
- Hoists `minCheckin` / `maxCheckout` / `maxReport` so the healthcheck temporal block stops recomputing them from crew arrays.

Behavior note: callers with strict per-host concurrency limits (e.g. an indexer that rate-limits per IP) may see more concurrent requests. Total request count is unchanged.
