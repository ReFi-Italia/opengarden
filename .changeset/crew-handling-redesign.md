---
"@refi-italia/opengarden": minor
---

Redesign crew handling: one record per job instead of one per gardener, with per-gardener reports inside the evidence bundle.

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
