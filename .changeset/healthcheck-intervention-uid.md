---
"@refi-italia/opengarden": minor
---

Allow `null` for `HealthcheckInput.interventionUID` (standalone monitoring); enforce area as EAS refUID.

- `HealthcheckInput.interventionUID` is now `string | null`. `null` encodes as `ZERO_BYTES32` per spec §3.7 ("standalone monitoring"). Previously callers had to pass `ZERO_BYTES32` explicitly.
- Encoder handles `null → ZERO_BYTES32`.
- `recordHealthcheck(areaUID, data)` already passed `areaUID` as EAS `refUID` per spec; tests now verify this for both linked and standalone cases.
