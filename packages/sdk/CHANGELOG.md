# @refi-italia/opengarden

## 0.2.0

### Minor Changes

- de029b0: Switch evidence bundle versioning to semver and centralize in a constant.

  - `EvidenceBundle.bundleVersion` is now `"0.1.0"` (was `"2.0"`). Pre-1.0 semver signals the format is still unstable and may change incompatibly.
  - New exported constant `EVIDENCE_BUNDLE_VERSION` is the single source of truth. `buildEvidenceBundle` emits it, `verifyEvidenceBundle` checks against it, and the `EvidenceBundle` type is parameterized over `typeof EVIDENCE_BUNDLE_VERSION` so type literals stay in sync automatically.
  - Consumers pinning to the old `"2.0"` literal need to update to the exported constant (or the new literal). The crew-handling redesign hasn't been published yet, so there should be no active consumers on `"2.0"`.

- 46ee928: Redesign crew handling: one record per job instead of one per gardener, with per-gardener reports inside the evidence bundle.

  **Schema changes** (all three require re-registration; existing on-chain UIDs are stale):

  - **PublishedIntervention**: remove `gardener` and `isLead` fields. One PublishedIntervention per intervention (not per crew member). Recipient is now always `ZERO_ADDRESS` — it's a public job record, not a credential addressed to any individual.
  - **ScheduledIntervention**: remove `assignedGardener` field. The crew lead's wallet is captured via the EAS `recipient` metadata, matching how off-chain gardener attestations use the `attester` field for identity.
  - **AdminValidation**: replace `reportUID` with `scheduleUID`. Validation is job-level and anchors on the ScheduledIntervention; individual reports live in the evidence bundle. Recipient is `ZERO_ADDRESS`.

  **Per-gardener attestations** (GardenerCheckin / GardenerCheckout / GardenerReport): unchanged fields, but the spec now explicitly documents that each crew member independently signs their own checkin/checkout/report chain, all referencing the same `interventionUID`.

  **Evidence bundle becomes version 2.0**: `checkins`, `checkouts`, and `reports` are now arrays (length 1 for solo jobs, length N for a crew of N). Each entry carries an `attester` field so verifiers can prove which gardener contributed to the intervention. Consumers must reject bundles with unknown `bundleVersion` values.

  **Temporal integrity rules (spec §4.2) generalized for crews**:

  - `T_schedule < min(T_checkin[*])`
  - for each `i`: `T_checkin[i] < T_checkout[i] < T_report[i]`
  - `max(T_report[*]) < T_validation < T_publication`

  **SDK API changes**:

  - `EvidenceBundleBuilderInput.crew: CrewMemberAttestations[]` replaces the flat `checkin`/`checkout`/`report` fields.
  - `ScheduledInterventionInput.assignedGardener` renamed to `crewLead` and is used as the EAS recipient (not encoded into the schema data).
  - `AdminValidationInput` drops `gardener` (recipient is always ZERO_ADDRESS) and replaces `reportUID` with `scheduleUID`.
  - `PublishedInterventionInput` drops `gardener` and `isLead`.
  - `Intervention` result type drops `gardener` and `isLead`.
  - `verifyEvidenceBundle` rewritten to enforce per-gardener temporal ordering over the new array shape.
  - `finalizeIntervention` computes `offchainCount = 2 + 3 * crew.length` (+ optional healthchecks).

  **Gardener credentialing** (spec §2.3 clarified): `GardenerMilestone.totalInterventions` now counts interventions the gardener personally signed a GardenerReport for; `evidenceRoot` is a merkle of the PublishedIntervention UIDs they contributed to. The organization computes this at mint time by scanning evidence bundles for reports signed by the recipient wallet.

  **Docs**: spec renamed "OpenGarden wallet" to "Organization wallet" throughout (protocol is used by many organizations). The attestation graph and schema registration reference were updated to match the new field sets.

  **Tooling**: `packages/sdk/tsconfig.json` now includes `tests/` so `pnpm run check` typechecks the test suite. Dead emit-related options dropped (unbuild handles build via rollup, not tsc).

- 6d13917: Break `verifyEvidenceBundle` into composable, independently-callable checks.

  - New `src/verification.ts` module exports pure, sync helpers for every integrity check the SDK runs on an evidence bundle: `verifyBundleVersion`, `verifyBundleCompleteness`, `verifyBundleTemporalOrder`, `verifyBundleHealthcheckBracket`, `verifyBundleExecutionDateBracket`, `verifyBundleValidationApproved`. Each returns a typed `VerificationCheck` with `{ code, valid, message? }`. `VerificationCheckCode` is exported as an enum so UIs can render per-check badges by code instead of hardcoded strings.
  - New async helper `verifyBundleOnChainTimestamps(bundle, fetchTimestamp)` accepts an injected `TimestampFetcher` so the network-bound check is usable with any EAS instance or test stub. Fetch failures for individual UIDs are treated as mismatches, not thrown errors.
  - `client.verifyEvidenceBundle(uid)` is now a thin orchestrator that delegates to the new helpers and adds a new `checks: VerificationCheck[]` field to `EvidenceBundleVerification` for rendering "X of N integrity checks passed" UX. All previously-exposed boolean fields are preserved.
  - Apps that already have a bundle in memory (e.g. just after finalizing, or loaded from an external source) can now run the individual checks without going through the client's storage-backed round trip.

- 86fe5c0: Shift `AreaType` and `InterventionType` enums to reserve `0` for `Unspecified`.

  - `AreaType.PublicGreenSpace` moves from 0 to 1; remaining values increment. New `AreaType.Unspecified = 0`.
  - `InterventionType.RoutineMaintenance` moves from 0 to 1; remaining values increment. New `InterventionType.Unspecified = 0`.

  Unlocks: legacy data imports, uncategorized areas, and intervention types that don't fit the existing categories, without needing a v2 schema.

  **No schema re-registration required.** The schema strings still declare `uint8 areaType` and `uint8 interventionType` — only the meaning of value `0` has changed. However, any already-written attestations with `areaType = 0` or `interventionType = 0` now mean "Unspecified" instead of their previous category. This is semantically breaking for any indexer or dashboard that has cached the old enum interpretation.

- 885d113: Add `assessorId` to Healthcheck, ship hash helpers, and document SDK encoding conventions.

  - **`Healthcheck.assessorId: bytes32`** — privacy-preserving hash of the staff member who performed the assessment, mirroring `AdminValidation.validatorId`. The attester wallet is shared across an organization's staff, so the wallet alone can't attribute individual assessments; `assessorId` closes that gap. `HealthcheckInput` now requires this field. The `Healthcheck` schema string changed — existing on-chain UIDs are stale and must be re-registered.
  - **`hashIdentifier(id)`** — new SDK helper that produces the canonical bytes32 hash (`keccak256(utf8Bytes(id))`) for any hashed-identifier field (`commissionRef`, `validatorId`, `assessorId`).
  - **`hashPhotoBundle(items)`** — new SDK helper for collapsing N media references into a single bytes32, via a canonical `{v:1,items:[sorted]}` JSON manifest. Lets multi-photo fields (`GardenerReport.photosHash`, etc.) be derived reproducibly across implementations.
  - **SDK Encoding Conventions (new spec section 9)** documents the hashed-identifier rule, the photo-bundle manifest format, coordinate microdegrees, and the self-reported-vs-on-chain-timestamp distinction. These conventions are normative for any implementation claiming SDK compatibility.
  - **Terminology**: the spec now refers to "Organization wallet" / "the organization" for the attesting entity instead of "OpenGarden wallet" / "OpenGarden", since the OpenGarden Protocol is adopted by many organizations rather than being run by a single one.

- c3bdabc: Add `interventionUID` field to the Healthcheck attestation, making the link between a healthcheck and its ScheduledIntervention explicit and on-chain auditable instead of relying on temporal proximity.

  - `HealthcheckInput` now requires `interventionUID: string` (use `ZERO_BYTES32` for standalone monitoring)
  - `Healthcheck` schema string changed — existing on-chain UIDs are stale and must be re-registered

  Spec, encoder, types, and tests updated accordingly.

- ce3ed93: Surface per-attestation indexer errors with structured results.

  - **Breaking**: `submitToIndexer` now returns `Promise<IndexerSubmissionResult>` (`{ ok, error? }`) instead of `Promise<boolean>`. The HTTP status and response body (or thrown error message) are surfaced via `error` so callers can act on failures. Console warnings are preserved.
  - **Breaking**: `client.indexBundleAttestations` now returns `Promise<BundleIndexingResult[]>` instead of `Promise<number>`. Every attestation in the bundle is tagged with `uid`, a `role` literal (`"scheduled"` / `"checkin"` / `"checkout"` / `"report"` / `"validation"` / `"healthcheckBefore"` / `"healthcheckAfter"`), and — for per-member roles — a 0-based `crewIndex`. A caller whose single checkout failed can now see _which_ crew member's checkout failed and _why_.
  - `FinalizeInterventionResult` gains a new `indexingResults: BundleIndexingResult[]` field. The legacy `indexedCount: number` field is preserved and derived from the new array, so existing dashboards keep working unchanged.
  - `IndexerSubmissionResult`, `BundleIndexingResult`, and `BundleIndexingRole` are exported from the SDK root.

- 6d4ddb1: Allow overriding the GraphQL and off-chain store endpoints.

  `OpenGardenConfig` gains two optional fields: `graphqlUrl` and `storeUrl`. When set, the SDK uses them for read queries and indexer submissions respectively, falling back to the EASScan defaults derived from the chain ID only when the override is absent. This unblocks self-hosted indexers and makes the SDK usable on chains where EAS is deployed but EASScan is not — callers can point the client at any EAS-compatible GraphQL endpoint without patching the SDK.

- ad852d1: Add a preflight module with a pure `validateFinalizeInput` and per-step wiring helpers.

  - New `validateFinalizeInput(input): FinalizeInputIssue[]` runs the full spec §4.2 temporal-integrity check on a `FinalizeInterventionInput` and returns a flat list of issues (empty means ready to finalize). In addition to the previous schedule-vs-execution-date check, it now verifies per-crew-member attester consistency across checkin/checkout/report, refUID wiring across schedule → checkin/report, checkout → checkin, validation → schedule, and healthcheck → area, healthcheck temporal brackets, and `validation.approved`. Intended for UIs that want to preview readiness and surface all problems at once instead of failing on the first check.
  - `FinalizeInputIssueCode` enum and `FinalizeInputIssue` type are exported for structured issue handling.
  - New `extractAttestationMetadata(result)` exposes the signer / refUID / time / on-chain timestamp of a `TimestampedOffChainResult` (lowercased) so apps can compose their own pre-flight checks.
  - New `assertAttesterMatches(result, expectedAttester, descriptor?)` and `assertRefUIDMatches(result, expectedRefUID, descriptor?)` are per-HTTP-request helpers for webapps that reconstruct a persisted attestation from their DB before signing a downstream step (e.g. "the wallet about to sign a checkout matches the one that signed the checkin I just loaded").
  - **Behavioral change**: `client.finalizeIntervention` now delegates to `validateFinalizeInput` and throws a single `OpenGardenError(INVALID_INPUT)` whose message enumerates every issue found. Crew inputs that previously survived the ad-hoc checks but violated per-member temporal ordering (checkin < checkout < report) or wiring consistency will now fail at finalize time — callers with buggy wiring will see clearer errors instead of broken bundles.

- ad852d1: Tighten SDK input ergonomics: typed enums, hashed ids, `Date` inputs, range checks.

  - Input types now use the `AreaType` / `InterventionType` / `MilestoneLevel` enums instead of raw `number` (in `AreaRegistrationInput`, `PublishedInterventionInput`, `ScheduledInterventionInput`, `GardenerMilestoneInput`). Decoded attestation outputs in `Area`, `Intervention`, and `Milestone` are typed to the same enums.
  - **Breaking**: `commissionRef` is renamed to `commissionId` on `PublishedInterventionInput` and `ScheduledInterventionInput`. `commissionId`, `validatorId`, and `assessorId` now accept a plain identifier (or `null` for the `ZERO_BYTES32` sentinel) and are hashed internally per spec §9.1. Callers that previously pre-hashed via `hashIdentifier` should drop the wrapper call. Callers that passed a literal `ZERO_BYTES32` for volunteer/unsponsored work should pass `null` instead. The decoded on-chain field name (`commissionRef`) is unchanged. `AreaRegistrationInput.metadataHash` also accepts `null` for "no extended metadata".
  - Timestamp inputs (`executionDate`, `scheduledDate`, `achievedAt`, check-in and checkout `timestamp`) now accept `Date | bigint`. A new `toUnixSeconds(value)` helper is exported for callers who need the normalization outside the SDK. `number` is intentionally not accepted to avoid the seconds-vs-milliseconds ambiguity at call sites.
  - Encoders now validate inputs at the boundary and throw `OpenGardenError(INVALID_INPUT)` with the offending field name instead of letting bad values reach the EAS schema encoder. Checks cover the spec range for `healthBefore`/`healthAfter`/`qualityScore` (0..10), `healthScore` (1..10), `rating` (0..5), `uint8`/`uint16` overflow for count fields, `crewSize`, `offchainCount`, `taskCount`, `estimatedMinutes`, `actualMinutes`, `totalInterventions`, `totalValidated`, latitude/longitude degree ranges, and runtime defense against unsafe enum casts.

- ea1ccda: Add read methods for off-chain attestations: schedules, healthchecks, citizen feedback.

  - `getScheduledInterventions({ areaUID?, crewLead? })` queries the EAS indexer for `ScheduledIntervention` attestations filtered by area, crew lead, or both (at least one filter is required). Powers "schedules for this area" admin views and "my assignments" screens on the gardener app.
  - `getAreaHealthchecks(areaUID)` returns every `Healthcheck` attestation referencing the area, newest first.
  - `getAreaCitizenFeedback(areaUID)` returns every `CitizenFeedback` attestation referencing the area, newest first.
  - New decoded output types are exported from the SDK root: `ScheduledIntervention`, `Healthcheck`, `CitizenFeedback`. Matching decoders `decodeScheduledIntervention`, `decodeHealthcheck`, and `decodeCitizenFeedback` ship alongside the existing ones.

- 2ae5f41: Accept a structured `SponsorRef` for `commissionId` inputs.

  - New `SponsorRef` discriminated union with four variants — `corporate` / `municipal` / `grant` / `volunteer` — lets callers model the commissioning entity explicitly instead of inventing their own string convention per-org.
  - `serializeSponsorRef(ref)` produces the canonical JSON shape hashed into `commissionRef`. Volunteer → `null` (SDK maps to `ZERO_BYTES32`). The JSON field order is load-bearing: kind first, kind-specific identifier second. Changing it is a breaking change to the on-chain hash — auditors reproducing a historical `commissionRef` MUST use the serialization in effect at attestation time.
  - `PublishedInterventionInput.commissionId` and `ScheduledInterventionInput.commissionId` now accept `string | SponsorRef | null`. The plain-string form from the previous release still works; the structured form is additive. Mixing both forms for the same entity produces different hashes, so callers should commit to one convention per intervention lifecycle.
  - `SponsorRef` and `serializeSponsorRef` are exported from the SDK root.

### Patch Changes

- a5661d6: Harden evidence bundle validation and trim one unused type.

  - `buildEvidenceBundle` now throws `INVALID_INPUT` if a crew member's checkin/checkout/report attestation has no `signer` or `message.attester`. Previously the attester field in the bundle silently defaulted to an empty string.
  - `verifyEvidenceBundle` now rejects bundles whose `bundleVersion` is not `"2.0"` with `BUNDLE_VERIFICATION_FAILED`. Pre-2.0 bundles (pre-crew-handling redesign) would have failed later with a confusing error about undefined array access.
  - The previously-exported `CrewMemberAttestations` type is removed. `EvidenceBundleBuilderInput.crew` is now an inline array type with the same shape — no functional change for consumers passing object literals.

- e1a3bc8: Parallelize bundle indexing and verification.

  - `indexBundleAttestations` now submits all attestations concurrently via `Promise.all` instead of awaiting each in sequence. For a crew-of-N intervention with healthchecks, this collapses `2 + 3N + healthcheckCount` serial HTTP round-trips into a single fan-out.
  - `verifyEvidenceBundle` now reads on-chain timestamps concurrently instead of sequentially. It also now includes optional healthchecks in the timestamp-verification set — previously `attestationCount` counted them but `timestampsVerified` silently skipped them, so a tampered healthcheck timestamp could have slipped through.
  - `verifyEvidenceBundle` hoists `minCheckin` / `maxCheckout` / `maxReport` so the healthcheck temporal block stops recomputing them from the crew arrays.

  Behavior note: because indexing and timestamp reads now fan out, callers with strict per-host concurrency limits (e.g. an indexer that rate-limits per IP) may see more concurrent requests than before. The total number of requests is unchanged.

## 0.1.0

### Minor Changes

- cdf430e: Initial public release as `@refi-italia/opengarden`.
