---
"@refi-italia/opengarden": minor
---

Route parent linkages through EAS native `refUID` slot. Fold quality sign-off into publication.

- Remove `AdminValidation` schema and `validateIntervention()` method. Publishing on-chain is the quality sign-off; QA fields stay off-chain.
- Shrink `PublishedIntervention` to 5 fields: drop `areaUID` (→ `refUID`), `offchainCount`, `crewSize`.
- Drop `areaUID` from `ScheduledIntervention` / `Healthcheck` on-chain data; routed to `refUID`.
- Drop `interventionUID` from `GardenerCheckin` / `GardenerReport` and `checkinUID` from `GardenerCheckout`; routed to `refUID`.
- Drop `validation` entry from evidence bundle. Remove `verifyBundleValidationApproved`, `verifyBundleCompleteness`, and related verification fields.
- Public input/output types keep their parent-UID fields for caller ergonomics; SDK routes internally.
- New schema UIDs deployed on Optimism Sepolia (see `packages/sdk/src/chains/schemas.json`).
