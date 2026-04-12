---
"@refi-italia/opengarden": minor
---

Add read methods for off-chain attestations: schedules, healthchecks, citizen feedback.

- `getScheduledInterventions({ areaUID?, crewLead? })` queries the EAS indexer for `ScheduledIntervention` attestations filtered by area, crew lead, or both (at least one filter is required). Powers "schedules for this area" admin views and "my assignments" screens on the gardener app.
- `getAreaHealthchecks(areaUID)` returns every `Healthcheck` attestation referencing the area, newest first.
- `getAreaCitizenFeedback(areaUID)` returns every `CitizenFeedback` attestation referencing the area, newest first.
- New decoded output types are exported from the SDK root: `ScheduledIntervention`, `Healthcheck`, `CitizenFeedback`. Matching decoders `decodeScheduledIntervention`, `decodeHealthcheck`, and `decodeCitizenFeedback` ship alongside the existing ones.
