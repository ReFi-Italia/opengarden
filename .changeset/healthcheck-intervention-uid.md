---
"@refi-italia/opengarden": minor
---

Add `interventionUID` field to the Healthcheck attestation, making the link between a healthcheck and its ScheduledIntervention explicit and on-chain auditable instead of relying on temporal proximity.

- `HealthcheckInput` now requires `interventionUID: string` (use `ZERO_BYTES32` for standalone monitoring)
- `Healthcheck` schema string changed — existing on-chain UIDs are stale and must be re-registered

Spec, encoder, types, and tests updated accordingly.
