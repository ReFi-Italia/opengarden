---
"@refi-italia/opengarden": minor
---

Protocol redesign — collapse off-chain schemas into polymorphic Activity, route parent linkages through EAS `refUID`, and unify schema conventions.

**Schema shape**

- 4 on-chain schemas total: `AreaRegistration`, `Intervention` (renamed from `PublishedIntervention`), `GardenerMilestone`, `Activity` (`uint8 activityType, bytes32 payloadHash` — payload travels plaintext in evidence bundle).
- `AdminValidation` schema removed; quality sign-off folds into publication. QA fields stay off-chain.
- Per-gardener `GardenerCheckin` / `GardenerCheckout` / `GardenerReport` schemas removed (collapsed into polymorphic Activity).
- `CitizenFeedback` removed (citizen signal now flows through Healthcheck — see Healthcheck reshape changeset).

**refUID linkage** — parent UIDs route through EAS native `refUID` instead of being encoded in schema data:

- `Intervention` shrinks to 5 fields (drops `areaUID`, `offchainCount`, `crewSize`, `gardener`, `isLead`). `recipient` = `ZERO_ADDRESS` (public job record, not credential).
- `ScheduledIntervention` drops `areaUID`, `assignedGardener` (crew lead via EAS `recipient`).
- `Activity` payloads (checkin/checkout/report) reference parent intervention via scope hash `keccak256(interventionId)` and `refUID`.
- Public input/output types keep parent-UID fields for caller ergonomics; SDK routes internally.

**Activity payload semantics** — presence anchors vs evidence documents:

- Checkin = pure time anchor + optional GPS (proximity policy). `photoCID` removed (CID is timeless — proves nothing about capture time). `latitude`/`longitude` optional, both-or-neither.
- Checkout = pure time anchor + optional GPS, symmetric with checkin. `actualMinutes` removed (derivable from `T_checkout - T_checkin` on-chain).
- Report = all evidence (`tasksCompleted`, photos, notes) plus per-gardener `reportedEffort` (active work time excluding breaks; drives person-minute metrics).
- Schedule: `estimatedMinutes` → `plannedDuration` (crew-level wall-clock); new `tasksPlanned: string[]`. Verifier policy compares this against the union of `report.tasksCompleted` across crew.

**Crew handling**

- One record per job (not per crew member). Each crew member independently signs their own checkin/checkout/report chain, all referencing the same `interventionUID`. Crew pairing by signer + scope hash, not refUID chains.
- Bundle shape flattened to `activities[]` sorted by `onchainTimestamp`.

**AreaRegistration**

- Final shape: `string areaId, int32 latitude, int32 longitude, uint8 areaType, string name, string municipality, bytes32 boundariesHash, string metadata`.
- `metadataHash` renamed to purpose-named `boundariesHash` (content-addressable hash of boundary payload — polygon GeoJSON, photo bundle, etc.; `ZERO_BYTES32` for orgs without boundary data).
- New inline `metadata` string field for app-specific extras (small JSON escape hatch — surface area, access hours, institutional labels).

**Conventions (spec §9)**

- §9.6 — `string metadata` for inline JSON ≤512 bytes; `bytes32 *Hash` for large/binary, MUST use purpose-named field (`photoHash`, `photosHash`, `evidenceBundleHash`, `boundariesHash`). Generic `metadataHash` banned.
- `AreaType` and `InterventionType` enums shift: `0` reserved for `Unspecified`, all values increment by one. Schema strings unchanged (still `uint8 areaType` / `uint8 interventionType`) — only the meaning of value `0` has changed.
- Drop redundant timestamp fields: `GardenerCheckin.timestamp`, `GardenerCheckout.timestamp` (`message.time` is authoritative), `GardenerMilestone.skillTier` (restated `milestoneLevel` enum).

**SponsorRef**

- New `SponsorRef` discriminated union (`corporate` / `municipal` / `grant` / `volunteer`) for `commissionId` inputs.
- `serializeSponsorRef(ref)` produces canonical JSON hashed into `commissionRef`. Volunteer → `null` → `ZERO_BYTES32`.
- JSON field order is load-bearing — auditors reproducing historical `commissionRef` MUST use the serialization in effect at attestation time.

**Verification primitives**

- New protocol checks: `verifyBundlePayloadIntegrity`. Policy checks: `verifyBundleInterventionScope`, `verifyBundleScheduleUniqueness`. Crew/temporal checks rewritten to group by signer (small-org case where schedule signer is also crew member now supported).
- New helpers: `hashInterventionScope`, `hashActivityPayload`, `canonicalJSON`, typed per-activity builders + type guards, `parseActivityDecodedDataJson` (easscan GraphQL reads).
- Removed: `verifyBundleValidationApproved`, `verifyBundleCompleteness`.

**Gardener credentialing** (spec §2.3): `GardenerMilestone.totalInterventions` counts interventions the gardener personally signed a GardenerReport for; `evidenceRoot` is a merkle of the `Intervention` UIDs they contributed to. Organization computes this at mint time by scanning evidence bundles for reports signed by the recipient wallet.

**Terminology**: spec uses "Organization wallet" / "the organization" for the attesting entity (protocol is adopted by many organizations).

All chains MUST re-run `pnpm register-schemas`. Stale UIDs in `chains/schemas.json` cleared. Protocol status stays Draft, no compat shims.
