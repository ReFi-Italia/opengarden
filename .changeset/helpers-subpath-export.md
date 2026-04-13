---
"@refi-italia/opengarden": minor
---

Expose a pure-helpers subpath at `@refi-italia/opengarden/helpers` for consumers that don't need the chain client.

- New `./helpers` entry (`packages/sdk/src/exports/helpers.ts`) re-exports `serializeSponsorRef`, `SponsorRef`, `hashIdentifier`, `hashPhotoBundle`, `toMicrodegrees`, `fromMicrodegrees`, `toUnixSeconds`, the chain config constants (`CELO_*`, `OPTIMISM_*`, `BASE_*`, `ZERO_BYTES32`, `ZERO_ADDRESS`, `EVIDENCE_BUNDLE_VERSION`, `SCHEMA_NAME_UID`), the `AreaType` / `InterventionType` / `MilestoneLevel` enums, and the `SchemaName` / `ChainConfig` / `SchemaUIDs` / `StorageAdapter` types. Nothing in this entry transitively imports `@ethereum-attestation-service/eas-sdk`, so consumers running under Node's native ESM loader (Payload CLI, Vitest, scripts, and any tool that doesn't bundle) can use the helpers without hitting the upstream EAS SDK's missing-extension ESM bug.
- The default `.` entry still re-exports `OpenGardenClient` and the full surface — existing root imports keep working unchanged. This release is strictly additive.
- The Rollup build now uses `preserveModules` so each source file emits a separate dist artifact, and `sideEffects: false` is set in `package.json`. Together they let bundler-based consumers (Next.js, Vite, esbuild) tree-shake unused modules even when importing from the root entry.
