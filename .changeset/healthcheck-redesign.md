---
"@refi-italia/opengarden": minor
---

Healthcheck reshape — independent, area-scoped, multi-issuer signal. CitizenFeedback removed (superseded).

**Final schema**: `bytes32 areaUID, uint8 healthScore, bytes32 photoHash, string notes, string metadata`.

- No direct intervention linkage (`interventionUID` removed). Pre/post deltas derived off-chain by merging the area's Healthcheck timeline with intervention execution dates.
- No `assessorId` field. Issuer role (organization / gardener / citizen) inferred off-chain from attester wallet.
- `metadata` is free-form app-specific JSON escape hatch (per §9.6 convention).
- `areaUID` carried both in schema data and as the EAS `refUID` parameter.
- `recordHealthcheck(data: HealthcheckInput)` — `areaUID` is a field on input; refUID set internally.

**Removed**

- `CitizenFeedback` schema, `submitFeedback`, `getAreaCitizenFeedback`, validators, encoders/decoders, types. Citizen-issued area signal now flows through Healthcheck (rating 0–5 → healthScore 1–10 at the app layer).
- `PublishedIntervention.healthBefore` / `healthAfter` (pre/post derived off-chain).
- Evidence bundle `healthcheck` entry, `EvidenceBundleHealthcheck`, `EvidenceBundleBuilderInput.healthcheck`. `offchainCount` for finalize is `2 + 3 * crewSize` (no healthcheck bump).
- `verifyBundleHealthcheckBracket`, `VerificationCheckCode.HEALTHCHECK_BRACKET`, `EvidenceBundleVerification.healthcheckOrderValid`, `FinalizeInputIssueCode.HEALTHCHECK_REFUID_MISMATCH`.
- `OffChainAttestationResult` export (only used by deleted `submitFeedback`).

**New helpers** (kept from earlier revisions)

- `hashIdentifier(id)` — canonical bytes32 hash (`keccak256(utf8Bytes(id))`) for hashed-identifier fields (`commissionRef`, `validatorId`).
- `hashPhotoBundle(items)` — collapses N media references into single bytes32 via canonical `{v:1, items:[sorted]}` JSON manifest. Lets multi-photo fields be derived reproducibly across implementations.

**Rationale**: Healthcheck was overloaded — doubled as intervention-linked before/after measurement and standalone periodic monitor. CitizenFeedback duplicated the civic-signal half at weaker trust level. Collapsing into a single periodic, area-scoped stream lets readers merge interventions and healthchecks on a shared timeline; infers issuer role from the wallet (no on-chain `assessorId`); keeps aggregation logic in the app layer.

Stale `Healthcheck`, `CitizenFeedback`, `PublishedIntervention` UIDs cleared from `chains/schemas.json`. Re-register on every chain.
