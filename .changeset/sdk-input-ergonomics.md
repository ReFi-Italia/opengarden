---
"@refi-italia/opengarden": minor
---

Tighten SDK input ergonomics: typed enums, hashed ids, `Date` inputs, range checks.

- Input types now use the `AreaType` / `InterventionType` / `MilestoneLevel` enums instead of raw `number` (in `AreaRegistrationInput`, `PublishedInterventionInput`, `ScheduledInterventionInput`, `GardenerMilestoneInput`). Decoded attestation outputs in `Area`, `Intervention`, and `Milestone` are typed to the same enums.
- **Breaking**: `commissionRef` is renamed to `commissionId` on `PublishedInterventionInput` and `ScheduledInterventionInput`. `commissionId`, `validatorId`, and `assessorId` now accept a plain identifier (or `null` for the `ZERO_BYTES32` sentinel) and are hashed internally per spec §9.1. Callers that previously pre-hashed via `hashIdentifier` should drop the wrapper call. Callers that passed a literal `ZERO_BYTES32` for volunteer/unsponsored work should pass `null` instead. The decoded on-chain field name (`commissionRef`) is unchanged. `AreaRegistrationInput.metadataHash` also accepts `null` for "no extended metadata".
- Timestamp inputs (`executionDate`, `scheduledDate`, `achievedAt`, check-in and checkout `timestamp`) now accept `Date | bigint`. A new `toUnixSeconds(value)` helper is exported for callers who need the normalization outside the SDK. `number` is intentionally not accepted to avoid the seconds-vs-milliseconds ambiguity at call sites.
- Encoders now validate inputs at the boundary and throw `OpenGardenError(INVALID_INPUT)` with the offending field name instead of letting bad values reach the EAS schema encoder. Checks cover the spec range for `healthBefore`/`healthAfter`/`qualityScore` (0..10), `healthScore` (1..10), `rating` (0..5), `uint8`/`uint16` overflow for count fields, `crewSize`, `offchainCount`, `taskCount`, `estimatedMinutes`, `actualMinutes`, `totalInterventions`, `totalValidated`, latitude/longitude degree ranges, and runtime defense against unsafe enum casts.
