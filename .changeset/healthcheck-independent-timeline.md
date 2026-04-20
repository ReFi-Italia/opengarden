---
"@refi-italia/opengarden": minor
---

Rework Healthcheck into independent, area-scoped, multi-issuer signal. Deprecate CitizenFeedback (superseded).

**Breaking changes:**

- **Healthcheck schema** reshaped to `bytes32 areaUID, uint8 healthScore, bytes32 photoHash, string notes, string metadata`:
  - `interventionUID`, `assessorId` removed — no direct intervention linkage; issuer role inferred off-chain from the attester wallet (organization / gardener / citizen).
  - `metadataHash` (+ the canonicalized off-chain metadata JSON) replaced by a plain `metadata` string field — a free-form app-specific JSON escape hatch that travels inside the attestation.
  - `assessorNotes`/app-specific `interventionNeeded` moved into `notes` / `metadata` (or dropped — aggregation and "needs intervention?" decisions are now app-layer).
  - `areaUID` is carried **both** in the schema data and as the EAS `refUID` parameter.
- **`recordHealthcheck` signature** changed from `(areaUID: string, data)` to `(data: HealthcheckInput)` — `areaUID` is a field on the input; refUID is set internally.
- **CitizenFeedback removed** entirely: schema definition, `CitizenFeedbackInput`, `CitizenFeedback` type, `encodeCitizenFeedback` / `decodeCitizenFeedback`, `submitFeedback`, `getAreaCitizenFeedback`, validators, tests. Citizen-issued area signal now flows through Healthcheck (rating 0–5 → healthScore 1–10 at the app layer).
- **PublishedIntervention** no longer carries `healthBefore` / `healthAfter`. Pre/post deltas are derived off-chain by merging the area's Healthcheck timeline with intervention execution dates.
- **Evidence bundle cleanup**: `healthcheck`, `EvidenceBundleHealthcheck`, and `EvidenceBundleBuilderInput.healthcheck` removed. `offchainCount` for finalize is `2 + 3 * crewSize` (no healthcheck bump).
- **Verification**: `verifyBundleHealthcheckBracket`, `VerificationCheckCode.HEALTHCHECK_BRACKET`, and `EvidenceBundleVerification.healthcheckOrderValid` removed. `FinalizeInputIssueCode.HEALTHCHECK_REFUID_MISMATCH` removed.
- **Chain-embedded schema UIDs** for `CitizenFeedback`, `Healthcheck`, and `PublishedIntervention` cleared from `chains/schemas.json` — the three schemas changed and must be re-registered on every chain.
- **`OffChainAttestationResult`** export removed (was only used by the deleted `submitFeedback`).

**Rationale:** Healthcheck was overloaded — it doubled as an intervention-linked before/after measurement and a standalone periodic monitor, and CitizenFeedback duplicated the civic-signal half of it at a weaker trust level. Collapsing into a single periodic, area-scoped stream lets readers merge interventions and healthchecks on a shared timeline, infers issuer role from the wallet (no on-chain `assessorId`), and keeps aggregation logic in the app layer where it belongs.
