---
"@refi-italia/opengarden": minor
---

Minimize schema data fields by routing parent linkages through the EAS native `refUID` slot, and fold quality sign-off into publication (no separate validation attestation).

**Breaking changes:**

- **AdminValidation removed entirely.** No separate off-chain validation attestation. Publishing a `PublishedIntervention` on-chain is the organization's quality sign-off. Internal QA fields (`approved`, `qualityScore`, `feedback`, `validatorId`) stay in the organization's database, outside the verifiable envelope.
  - `AdminValidationInput` type, `validateIntervention()` client method, `encodeAdminValidation`/`decodeAdminValidation`, and the `AdminValidation` schema definition removed.
  - `"AdminValidation"` dropped from `SchemaName` enum and `SchemaUIDs`.
- **`PublishedIntervention` schema reshaped.** Dropped `areaUID` (now carried by EAS `refUID`), `offchainCount`, and `crewSize` from the on-chain data. Final 5 fields: `interventionId, interventionType, executionDate, evidenceBundleHash, commissionRef`.
  - `PublishedInterventionInput` no longer carries `offchainCount` or `crewSize` on the public input. `areaUID` stays on the input; the SDK routes it to the EAS `refUID` slot internally.
  - `Intervention` read type no longer exposes `offchainCount` or `crewSize`. `areaUID` is sourced from `refUID`.
- **`ScheduledIntervention` schema reshaped.** `areaUID` dropped from on-chain data (carried by `refUID`). `ScheduledInterventionInput.areaUID` and `ScheduledIntervention.areaUID` stay on the public types.
- **`Healthcheck` schema reshaped.** `areaUID` dropped from on-chain data (carried by `refUID`). `HealthcheckInput.areaUID` and `Healthcheck.areaUID` stay on the public types.
- **`GardenerCheckin` schema reshaped.** `interventionUID` dropped from on-chain data (carried by `refUID`). `GardenerCheckinInput.interventionUID` stays on the public type.
- **`GardenerCheckout` schema reshaped.** `checkinUID` dropped from on-chain data (carried by `refUID`). `GardenerCheckoutInput.checkinUID` stays on the public type.
- **`GardenerReport` schema reshaped.** `interventionUID` dropped from on-chain data (carried by `refUID`). `checkoutUID` stays as a schema field (secondary reference — EAS exposes only one `refUID` slot). `GardenerReportInput` signature unchanged.
- **Evidence bundle drops the `validation` entry.** `EvidenceBundle.attestations.validation`, `EvidenceBundleValidation`, and `EvidenceBundleBuilderInput.validation` removed. `"validation"` dropped from `BundleIndexingRole`.
- **Bundle verification surface slimmed.** `verifyBundleValidationApproved` and `verifyBundleCompleteness` removed. `CompletenessCheck` type removed. `VALIDATION_APPROVED` and `COMPLETENESS` values removed from `VerificationCheckCode`. `EvidenceBundleVerification` no longer carries `validationApproved`, `attestationCount`, or `expectedCount`.
- **`validateFinalizeInput` simplified.** `VALIDATION_NOT_APPROVED` and `VALIDATION_REFUID_MISMATCH` issue codes removed. `FinalizeInterventionInput` no longer carries a `validation` field or a `crewSize` field (crew headcount lives on the ScheduledIntervention).
- **`finalizeIntervention` signature simplified.** No validation input, no `offchainCount`/`crewSize` propagation. The on-chain publication carries only the 5-field PublishedIntervention payload plus the `refUID`-slotted area link.
- **New EAS schema UIDs deployed on Optimism Sepolia** (all parent-linkage schemas re-registered):
  - `PublishedIntervention`: `0xdd878a5f30778556539f95ad707687ad882348add80f264aa613cec830a0a9cc`
  - `ScheduledIntervention`: `0x9a9e96bd5646354b07e295daa2cbf55676109dab7891cb0989198b7f0e394250`
  - `Healthcheck`: `0xd62a2b1d70b1745e58ea91910d5d645b5dede538279562383ae4ad30ee188e1b`
  - `GardenerCheckin`: `0x9b356a874444aa34ff0afe4cecc171b328bfec3ff7d4203ff52f395117f4410a`
  - `GardenerCheckout`: `0x49ed17440c2e26896d8f58172be11e68dfb157a15f0b7ea2968c128f47c56922`
  - `GardenerReport`: `0x9f34f8371f385f9cd38b5a3de4e72adc3507dce120f8b97f5c9b67027f1537db`

**Rationale.** Under the validator-is-publisher model, every schema with a single dominant parent now puts that parent in the EAS native `refUID` slot instead of duplicating it as a data field. This is cheaper on-chain (fewer bytes per attestation), gives indexers a single, uniform way to traverse the graph (native `refUID` filtering on EAS GraphQL), and keeps each schema's data tight to what actually varies per attestation. Quality validation collapses into publication: the act of publishing an intervention on-chain is the organization's sign-off, and rejected or unapproved work simply never reaches the chain.

Spec (`docs/eas-schema-spec.md`), SDK source, tests, and README updated. Public input/output types preserve `areaUID` / `interventionUID` / `checkinUID` fields for caller ergonomics — the SDK routes them to the `refUID` slot transparently.
