# OpenGarden Protocol

An open attestation protocol for blockchain-verified urban gardening impact, built on [Ethereum Attestation Service (EAS)](https://attest.org).

> **Mission** — Turn invisible groundwork into auditable, on-chain proof — for the organizations that fund it, the institutions that govern it, the gardeners who do it, and the communities that benefit from it.

## What it does

Defines a set of EAS schemas that let any organization track and verify urban gardening work — from scheduling an intervention, through gardener check-in and reporting, to on-chain publication of validated impact records. Gardeners accumulate soulbound milestone credentials as portable proof of their work history.

## Why

The protocol is optimized for four audiences:

- **Corporate sponsors** — every intervention links to its funding source via a hashed commission reference, enabling per-sponsor impact reporting without exposing identities on-chain.
- **Municipalities** — area registrations and verified intervention records provide auditable proof of urban greening outcomes for institutional reporting.
- **Gardeners** — soulbound milestone credentials serve as portable, non-tradeable proof of skill and work history, legible to employers and social services.
- **Communities** — citizen feedback attestations give residents a voice in rating the impact on their neighborhoods, providing engagement metrics for institutional reporting.

## Design principles

- **Commit–settle pattern** — operate off-chain, settle on-chain. Only finalized records (area registrations, validated interventions, milestones) go on-chain.
- **Temporal integrity** — off-chain attestations are timestamped on-chain via `EAS.timestamp()` to prevent backfilling.
- **Attester-based trust** — no resolver contracts. Trust is established at the read layer by verifying attester identity and on-chain timestamps.
- **Open adoption** — schemas are registered without resolvers so any organization can attest with their own wallet.

## Packages

| Package | Description |
|---|---|
| [`@refi-italia/opengarden`](packages/sdk) | TypeScript SDK — single `OpenGardenClient` class covering the full attestation lifecycle |

### Quick start

```bash
pnpm install
pnpm --filter @refi-italia/opengarden build
```

```ts
import { OpenGardenClient, OPTIMISM_MAINNET } from '@refi-italia/opengarden';

const client = new OpenGardenClient({ signer, chain: OPTIMISM_MAINNET });
await client.registerAllSchemas();
await client.registerArea({ areaId: 'RM-PIGN-042', latitude: 41.89, longitude: 12.49, ... });
```

See the [SDK README](packages/sdk/README.md) for the full API and lifecycle walkthrough.

## Supported chains

Celo, Optimism, and Base (mainnets + testnets). See [SDK docs](packages/sdk/README.md#supported-chains) for details.

## Specification

See [eas-schema-spec.md](docs/eas-schema-spec.md) for the full schema definitions, evidence bundle structure, temporal ordering rules, and trust model.
