---
"@refi-italia/opengarden": minor
---

Add a preflight module with a pure `validateFinalizeInput` and per-step wiring helpers.

- New `validateFinalizeInput(input): FinalizeInputIssue[]` runs the full spec §4.2 temporal-integrity check on a `FinalizeInterventionInput` and returns a flat list of issues (empty means ready to finalize). In addition to the previous schedule-vs-execution-date check, it now verifies per-crew-member attester consistency across checkin/checkout/report, refUID wiring across schedule → checkin/report, checkout → checkin, validation → schedule, and healthcheck → area, healthcheck temporal brackets, and `validation.approved`. Intended for UIs that want to preview readiness and surface all problems at once instead of failing on the first check.
- `FinalizeInputIssueCode` enum and `FinalizeInputIssue` type are exported for structured issue handling.
- New `extractAttestationMetadata(result)` exposes the signer / refUID / time / on-chain timestamp of a `TimestampedOffChainResult` (lowercased) so apps can compose their own pre-flight checks.
- New `assertAttesterMatches(result, expectedAttester, descriptor?)` and `assertRefUIDMatches(result, expectedRefUID, descriptor?)` are per-HTTP-request helpers for webapps that reconstruct a persisted attestation from their DB before signing a downstream step (e.g. "the wallet about to sign a checkout matches the one that signed the checkin I just loaded").
- **Behavioral change**: `client.finalizeIntervention` now delegates to `validateFinalizeInput` and throws a single `OpenGardenError(INVALID_INPUT)` whose message enumerates every issue found. Crew inputs that previously survived the ad-hoc checks but violated per-member temporal ordering (checkin < checkout < report) or wiring consistency will now fail at finalize time — callers with buggy wiring will see clearer errors instead of broken bundles.
