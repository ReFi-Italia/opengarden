---
"@refi-italia/opengarden": minor
---

Accept a chain name string in `OpenGardenConfig.chain`, resolved via the new `CHAIN_CONFIGS` registry so consumers no longer have to import a `ChainConfig` constant just to hand it back to the client.

- `OpenGardenConfig.chain` now accepts `ChainName | ChainConfig`. Known names (`"celo-mainnet"`, `"celo-alfajores"`, `"optimism-mainnet"`, `"optimism-sepolia"`, `"base-mainnet"`, `"base-sepolia"`) are resolved from the built-in registry; unknown names throw `OpenGardenError(INVALID_INPUT)` with the list of valid options. `ChainConfig` objects are still accepted unchanged for custom or unsupported deployments.
- New exports from both the root entry and the `/helpers` subpath: `CHAIN_CONFIGS` (name → `ChainConfig` map), `getChainConfig(name)`, and the `ChainName` literal union type. Nothing in the helpers path transitively imports the EAS SDK, so Node's native ESM loader can still consume the registry safely.
- Existing object-form usage (`chain: OPTIMISM_MAINNET`) keeps working; this release is strictly additive.
