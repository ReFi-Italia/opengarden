---
"@refi-italia/opengarden": minor
---

Refactor Activity payload naming and semantics — presence anchors vs evidence documents.

The asymmetry between `checkin` (GPS + photo), `checkout` (self-reported duration, no photo), and `report` (tasks + photos + notes) conflated presence-proof with operational evidence. The revised shape separates the two: checkin/checkout are pure time anchors (with optional GPS for proximity policy), report carries all evidence plus per-gardener effort.

**Schedule**

- `estimatedMinutes` → `plannedDuration` (wall-clock of the intervention including planned breaks; crew-level, not per-gardener)
- `tasksPlanned: string[]` added. Verifier policy compares this against the union of `report.tasksCompleted` across crew.

**Checkin**

- `photoCID` removed. A photo at checkin proves nothing about capture time (CIDs are timeless — attacker uploads yesterday's photo, references it today). Presence is anchored by the signed envelope + on-chain timestamp + optional GPS.
- `latitude` and `longitude` are now optional. Omit when area-boundary membership is sufficient (small gardens); include when proximity signal matters (large parks, municipal districts). Both must be present together or both absent.

**Checkout**

- `actualMinutes` removed. Wall-clock duration is already derivable from `T_checkout - T_checkin` on-chain timestamps (or from `message.time` deltas when signing lags the event). A redundant self-reported duration added no cryptographic signal.
- Optional `latitude` / `longitude` added, symmetric with checkin. Captures "where the crew left from" for roaming-crew scenarios.

**Report**

- `reportedEffort: number` added. Per-gardener active work time in minutes, excluding breaks. Drives person-minute impact aggregation for sponsor metrics. Distinct from wall-clock duration because breaks aren't work — `sum(report[*].reportedEffort)` is the authoritative effort signal for an intervention.
- `photosCID` removed (replaced by `mediaHash` — see the Storage-Agnostic Commitments changeset).

**Healthcheck**

- `photoCID` removed (replaced by `mediaHash` — see the Storage-Agnostic Commitments changeset).

**Validation**

- Validators enforce a both-or-neither rule for checkin/checkout `latitude`/`longitude` so a single coordinate can't leak through. `plannedDuration` + `reportedEffort` are uint16-bounded; `tasksPlanned` + `tasksCompleted` must be arrays.

All existing public input types change shape — this is a minor-version break for pre-1.0 consumers. Existing signed activities on chain still decode via the Activity schema (ABI is unchanged: `uint8 activityType, bytes32 payloadHash`), but their payload JSON uses the old field names.
