---
"@refi-italia/opengarden": minor
---

Ship canonical schema UIDs as part of each `ChainConfig`, so consumers targeting published chains no longer have to register schemas themselves or thread a `schemaUIDs` object into `OpenGardenConfig`.

- New governance ledger at `packages/sdk/src/chains/schemas.json` records the 10 schema UIDs per chain that has completed both registration and naming. Populated today for `optimism-sepolia`.
- `ChainConfig` gains an optional `schemaUIDs?: Partial<SchemaUIDs>` field. The chain constants (`CELO_MAINNET`, `OPTIMISM_SEPOLIA`, …) carry their JSON entries when available, so instantiating `new OpenGardenClient({ chain: "optimism-sepolia" })` yields a client with all 10 schema UIDs pre-loaded — no config needed.
- `OpenGardenClient` merges `{ ...chain.schemaUIDs, ...config.schemaUIDs }` in its constructor, so an explicit `config.schemaUIDs` still overrides the chain defaults field-by-field. Custom deployments keep working.
- `scripts/register-schemas.ts` now writes the registered UIDs back into `schemas.json` after a successful round, so the workflow is register → commit JSON → ship SDK.
- `scripts/name-schemas.ts` now reads the UIDs for the target chain from `schemas.json` instead of from an environment variable.
- The `OPENGARDEN_SCHEMA_UIDS` env var is removed from the SDK: `.env.example`, the e2e test suite, and the README no longer reference it. E2e tests inherit the canonical UIDs through the chain constant and skip on-chain registration automatically for any chain listed in `schemas.json`.
