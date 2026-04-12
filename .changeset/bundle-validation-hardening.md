---
"@refi-italia/opengarden": patch
---

Harden evidence bundle validation and trim one unused type.

- `buildEvidenceBundle` now throws `INVALID_INPUT` if a crew member's checkin/checkout/report attestation has no `signer` or `message.attester`. Previously the attester field in the bundle silently defaulted to an empty string.
- `verifyEvidenceBundle` now rejects bundles whose `bundleVersion` is not `"2.0"` with `BUNDLE_VERIFICATION_FAILED`. Pre-2.0 bundles (pre-crew-handling redesign) would have failed later with a confusing error about undefined array access.
- The previously-exported `CrewMemberAttestations` type is removed. `EvidenceBundleBuilderInput.crew` is now an inline array type with the same shape — no functional change for consumers passing object literals.
