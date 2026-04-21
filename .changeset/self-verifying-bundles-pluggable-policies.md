---
"@refi-italia/opengarden": minor
---

Self-verifying evidence bundles + pluggable verification/finalize policies.

- Bundles embed the full EIP-712 signed attestation per entry (`signedAttestation`). Readers verify signatures and refUID wiring locally — no off-chain store fetch required. `contentHash` field dropped (redundant with `uid`).
- New helpers: `verifyBundleSignatures` (protocol tier), `verifyBundleRefUIDs`, `verifyBundleCrewSize`, `verifyBundleCrewConsistency`, `verifyBundleCrewDistinctness` (policy tier).
- `finalizeIntervention(input, { policy? })` + `verifyEvidenceBundle(uid, { policy? })` accept pluggable policy objects. Presets (`STRICT_FINALIZE_POLICY`, `MINIMAL_FINALIZE_POLICY`, `LENIENT_FINALIZE_POLICY`, `STRICT_VERIFY_POLICY`, `PROTOCOL_ONLY_VERIFY_POLICY`) plus builders (`finalizePolicy`, `verifyPolicy`). Default is strict (back-compat).
- `EvidenceBundleVerification` gains `signaturesValid` + `refUIDsValid` fields.
- Bundle JSON: `signedAttestation.message.time` / `expirationTime` / `nonce` are decimal strings. SDK exposes `bundleJsonReplacer` + `restoreBundleBigInts`.
- SDK injects `signer` field on every signed attestation at sign time so bundles carry the authoritative signer without requiring recovery at read time.
- Spec `docs/eas-schema-spec.md` updated: §5 reorganized around fat bundle + split protocol/policy verification tiers, §7.1 policy-as-data paragraph, §9.5 bundle JSON serialization rules.
