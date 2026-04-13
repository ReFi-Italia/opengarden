---
"@refi-italia/opengarden": minor
---

Make the SDK root entry safe to import under Node's strict ESM loader by switching `OpenGardenClient` to a dependency-injection constructor and adding a lazy-loading async helper. Retires the `/helpers` subpath export.

**Breaking API changes**

- `OpenGardenConfig` now requires `eas: EAS` and `registry: SchemaRegistry` dependencies (previously constructed internally from the chain config). Consumers have two migration paths:
  - Use the new `createOpenGardenClient` async helper — it lazy-loads `eas-sdk` and wires both deps automatically.
  - Construct `OpenGardenClient` directly (DI), providing `new EAS(chain.easAddress).connect(signer)` and `new SchemaRegistry(chain.schemaRegistryAddress).connect(signer)` yourself.
- The `@refi-italia/opengarden/helpers` subpath export is removed. Everything that was exported from `/helpers` is now available on the root entry — migration is a one-line import rewrite (drop the `/helpers` suffix).

**What this unlocks**

- `import { OpenGardenClient, createOpenGardenClient, ... } from "@refi-italia/opengarden"` at the top level of a module no longer triggers any runtime import of `@ethereum-attestation-service/eas-sdk`. Payload CLI, Vitest, and any other tool that uses Node's native ESM loader can now load the SDK root entry without hitting the upstream package's missing-extension ESM specifiers.
- `client.ts` uses `import type` for `EAS` / `SchemaRegistry`, so the class module compiles to JS with zero runtime `eas-sdk` references.
- `schemas/encoders.ts` moved its `SchemaEncoder` usage behind a module-level lazy cache via new `initEncoders()` + `newSchemaEncoder()` helpers. `createOpenGardenClient` awaits `initEncoders()` before returning, so the common path is transparent; tests calling encoders / decoders directly without going through the helper must run `initEncoders()` in setup (the SDK ships a `tests/setup.ts` wiring this for its own vitest run via `setupFiles`).

**New exports on the root entry**

- `createOpenGardenClient(config)` — async helper that lazy-loads `eas-sdk`, constructs EAS + SchemaRegistry from the resolved chain, and returns a ready-to-use `OpenGardenClient`. Accepts `Omit<OpenGardenConfig, "eas" | "registry">`.
- `CreateOpenGardenClientConfig` — type alias for the helper's config.
- `initEncoders()` — async, idempotent preload of the `SchemaEncoder` class for the encoder cache.
