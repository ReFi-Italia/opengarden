---
"@refi-italia/opengarden": minor
---

SDK ergonomics — typed inputs, off-chain reads, lazy DI constructor, chain registry, time overrides.

**Input ergonomics**

- Input types use `AreaType` / `InterventionType` / `MilestoneLevel` enums instead of raw `number` (in `AreaRegistrationInput`, `PublishedInterventionInput`, `ScheduledInterventionInput`, `GardenerMilestoneInput`). Decoded outputs (`Area`, `Intervention`, `Milestone`) typed to the same enums.
- `commissionRef` renamed to `commissionId` on `PublishedInterventionInput` and `ScheduledInterventionInput`. `commissionId`, `validatorId`, `assessorId` accept a plain identifier (or `null` for the `ZERO_BYTES32` sentinel) and are hashed internally per spec §9.1. Callers that previously pre-hashed via `hashIdentifier` should drop the wrapper. Callers that passed a literal `ZERO_BYTES32` for volunteer/unsponsored work should pass `null` instead. The decoded on-chain field name (`commissionRef`) is unchanged. `AreaRegistrationInput.metadataHash` also accepts `null`.
- Timestamp inputs (`executionDate`, `scheduledDate`, `achievedAt`, checkin/checkout `time`) accept `Date | bigint`. New `toUnixSeconds(value)` helper exported. `number` is intentionally not accepted (avoids the seconds-vs-milliseconds ambiguity at call sites).
- Encoders validate inputs at the boundary, throwing `OpenGardenError(INVALID_INPUT)` with the offending field name instead of letting bad values reach the EAS schema encoder. Checks cover spec ranges for `healthBefore`/`healthAfter`/`qualityScore` (0..10), `healthScore` (1..10), `rating` (0..5), `uint8`/`uint16` overflow for count fields, `crewSize`, `offchainCount`, `taskCount`, `estimatedMinutes`, `actualMinutes`, `totalInterventions`, `totalValidated`, latitude/longitude degree ranges, and runtime defense against unsafe enum casts.

**Time override on checkin/checkout**

- `GardenerCheckinInput` and `GardenerCheckoutInput` accept an optional `time: Date | bigint` field. When set, the value is written into the EIP-712 envelope's `message.time` (the signer's claim of *when* the event happened). Omit to keep the previous behavior of using the current wall-clock at sign time.
- Motivation: when signing happens server-side on upload (not on the gardener's device at the moment of checkin/checkout), the previous default collapsed the claim moment into the upload moment. Passing the device-recorded timestamp preserves claim fidelity without restating the time in the schema data.

**Off-chain read methods**

- `getScheduledInterventions({ areaUID?, crewLead? })` queries the EAS indexer for `ScheduledIntervention` attestations filtered by area, crew lead, or both (at least one filter required). Powers "schedules for this area" admin views and "my assignments" gardener-app screens.
- `getAreaHealthchecks(areaUID)` returns every `Healthcheck` attestation referencing the area, newest first.
- New decoded output types exported from the SDK root: `ScheduledIntervention`, `Healthcheck`. Matching decoders `decodeScheduledIntervention`, `decodeHealthcheck` ship alongside the existing ones.

**Lazy DI constructor**

- `OpenGardenConfig` now requires `eas: EAS` and `registry: SchemaRegistry` dependencies (previously constructed internally). Two migration paths:
  - `createOpenGardenClient(config)` — async helper that lazy-loads `eas-sdk`, constructs EAS + SchemaRegistry from the resolved chain, and returns a ready-to-use `OpenGardenClient`. Accepts `Omit<OpenGardenConfig, "eas" | "registry">`.
  - Construct `OpenGardenClient` directly with `new EAS(chain.easAddress).connect(signer)` and `new SchemaRegistry(chain.schemaRegistryAddress).connect(signer)`.
- `client.ts` uses `import type` for `EAS` / `SchemaRegistry` — the class module compiles to JS with zero runtime `eas-sdk` references.
- `schemas/encoders.ts` uses a module-level lazy cache via new `initEncoders()` + `newSchemaEncoder()` helpers. `createOpenGardenClient` awaits `initEncoders()` before returning. Tests calling encoders/decoders directly without going through the helper must run `initEncoders()` in setup (the SDK ships `tests/setup.ts` wiring this for its own vitest run via `setupFiles`).
- `import { OpenGardenClient, createOpenGardenClient, ... } from "@refi-italia/opengarden"` at the top level no longer triggers any runtime import of `@ethereum-attestation-service/eas-sdk`. Payload CLI, Vitest, and any tool using Node's native ESM loader can now load the SDK root entry without hitting the upstream package's missing-extension ESM specifiers.
- The `@refi-italia/opengarden/helpers` subpath export is removed. Everything that was exported from `/helpers` is now available on the root entry — migration is a one-line import rewrite (drop the `/helpers` suffix).
- `initEncoders()` exported — async, idempotent preload of the `SchemaEncoder` class for the encoder cache.
- Rollup build uses `preserveModules` so each source file emits a separate dist artifact, and `sideEffects: false` is set in `package.json`. Together they let bundler-based consumers (Next.js, Vite, esbuild) tree-shake unused modules even when importing from the root entry.

**Chain config registry**

- `OpenGardenConfig.chain` accepts `ChainName | ChainConfig`. Known names (`"celo-mainnet"`, `"celo-alfajores"`, `"optimism-mainnet"`, `"optimism-sepolia"`, `"base-mainnet"`, `"base-sepolia"`) are resolved from the built-in `CHAIN_CONFIGS` registry; unknown names throw `OpenGardenError(INVALID_INPUT)` with the list of valid options. `ChainConfig` objects still accepted unchanged for custom or unsupported deployments.
- New exports: `CHAIN_CONFIGS` (name → `ChainConfig` map), `getChainConfig(name)`, `ChainName` literal union type.
- Existing object-form usage (`chain: OPTIMISM_MAINNET`) keeps working; this is strictly additive.

**Canonical schema UIDs ship with chain config**

- New governance ledger at `packages/sdk/src/chains/schemas.json` records the 10 schema UIDs per chain that has completed both registration and naming. Populated today for `optimism-sepolia`.
- `ChainConfig` gains an optional `schemaUIDs?: Partial<SchemaUIDs>` field. The chain constants (`CELO_MAINNET`, `OPTIMISM_SEPOLIA`, …) carry their JSON entries when available, so instantiating `new OpenGardenClient({ chain: "optimism-sepolia" })` yields a client with all 10 schema UIDs pre-loaded — no config needed.
- `OpenGardenClient` merges `{ ...chain.schemaUIDs, ...config.schemaUIDs }` in its constructor, so an explicit `config.schemaUIDs` still overrides the chain defaults field-by-field. Custom deployments keep working.
- `scripts/register-schemas.ts` now writes the registered UIDs back into `schemas.json` after a successful round, so the workflow is register → commit JSON → ship SDK.
- `scripts/name-schemas.ts` now reads the UIDs for the target chain from `schemas.json` instead of from an environment variable.
- The `OPENGARDEN_SCHEMA_UIDS` env var is removed from the SDK: `.env.example`, the e2e test suite, and the README no longer reference it. E2e tests inherit the canonical UIDs through the chain constant and skip on-chain registration automatically for any chain listed in `schemas.json`.
