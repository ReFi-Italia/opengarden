---
"@refi-italia/opengarden": minor
---

Collapse off-chain schemas into polymorphic `Activity`; rename `PublishedIntervention` → `Intervention`; anchor lifecycle Activities via `keccak256(interventionId)` intervention scope hash.

4 schemas total (`AreaRegistration`, `Intervention`, `GardenerMilestone`, `Activity`). `Activity` = `uint8 activityType, bytes32 payloadHash`; payload travels plaintext in the evidence bundle. Crew pairing by signer + scope hash, not refUID chains. Bundle shape flattened to `activities[]` sorted by `onchainTimestamp`.

New verifier checks: `verifyBundlePayloadIntegrity` (protocol), `verifyBundleInterventionScope` + `verifyBundleScheduleUniqueness` (policy). Temporal/crew checks rewritten to group by signer — small-org case (schedule signer also a crew member) now supported.

New primitives: `hashInterventionScope`, `hashActivityPayload`, `canonicalJSON`, typed per-activity builders + type guards, `parseActivityDecodedDataJson` for easscan GraphQL reads.

Protocol status stays Draft, no compat shims. `src/chains/schemas.json` rotated on Optimism Sepolia; other chains MUST re-run `pnpm register-schemas`.
