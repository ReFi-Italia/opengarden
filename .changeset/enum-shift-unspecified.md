---
"@refi-italia/opengarden": minor
---

Shift `AreaType` and `InterventionType` enums to reserve `0` for `Unspecified`.

- `AreaType.PublicGreenSpace` moves from 0 to 1; remaining values increment. New `AreaType.Unspecified = 0`.
- `InterventionType.RoutineMaintenance` moves from 0 to 1; remaining values increment. New `InterventionType.Unspecified = 0`.

Unlocks: legacy data imports, uncategorized areas, and intervention types that don't fit the existing categories, without needing a v2 schema.

**No schema re-registration required.** The schema strings still declare `uint8 areaType` and `uint8 interventionType` — only the meaning of value `0` has changed. However, any already-written attestations with `areaType = 0` or `interventionType = 0` now mean "Unspecified" instead of their previous category. This is semantically breaking for any indexer or dashboard that has cached the old enum interpretation.
