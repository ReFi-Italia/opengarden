---
"@refi-italia/opengarden": minor
---

Drop redundant fields from off-chain/on-chain schemas:

- `GardenerCheckin.timestamp` and `GardenerCheckout.timestamp` removed. The EIP-712 envelope's `message.time` is the authoritative signer claim of "when"; `EAS.timestamp(uid)` is the authoritative on-chain anchor. The schema field only restated `message.time`, creating ambiguity about which timestamp was authoritative.
- `GardenerMilestone.skillTier` removed. The string restated `milestoneLevel` (enum: 1=Apprentice, 2=Gardener, 3=Senior, 4=Master) and wasted calldata. Compute the label off-chain at display time.

Public input types drop `timestamp` / `skillTier`. Schema strings and UIDs change — on-chain: `GardenerCheckin`, `GardenerCheckout`, `GardenerMilestone` must be re-registered (stale UIDs dropped from `packages/sdk/src/chains/schemas.json`; run `pnpm register-schemas` to repopulate).
