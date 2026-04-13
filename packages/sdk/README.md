# @refi-italia/opengarden

TypeScript SDK for the OpenGarden Protocol — blockchain-verified urban gardening impact. Wraps the [Ethereum Attestation Service (EAS)](https://attest.org) to manage the full intervention lifecycle — from scheduling work to publishing verified impact records on-chain.

## Supported chains

| Chain | Config constant |
|---|---|
| Celo Mainnet | `CELO_MAINNET` |
| Optimism Mainnet | `OPTIMISM_MAINNET` |
| Base Mainnet | `BASE_MAINNET` |
| Optimism Sepolia | `OPTIMISM_SEPOLIA` |
| Base Sepolia | `BASE_SEPOLIA` |

## Install

```bash
pnpm add @refi-italia/opengarden ethers
```

`ethers` v6 is a peer dependency.

## Quick start

```ts
import { ethers } from 'ethers';
import { createOpenGardenClient } from '@refi-italia/opengarden';

const provider = new ethers.JsonRpcProvider('https://mainnet.optimism.io');
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

// `createOpenGardenClient` lazy-loads `eas-sdk` and wires the EAS +
// SchemaRegistry dependencies automatically. Chain can be a name string
// (`"optimism-mainnet"`) or a full `ChainConfig` object for custom chains.
const client = await createOpenGardenClient({
  signer,
  chain: 'optimism-mainnet',
});

// Schema UIDs ship pre-registered for chains tracked in `chains/schemas.json`,
// so on those chains you can skip `registerAllSchemas` entirely.
await client.registerAllSchemas();

// Register an area
const area = await client.registerArea({
  areaId: 'RM-PIGN-042',
  latitude: 41.8902,
  longitude: 12.4922,
  areaType: AreaType.PublicGreenSpace,
  name: 'Giardino Via Appia 12',
  municipality: 'RM-I',
  metadataHash: null, // or an IPFS CID / storage hash for extended metadata JSON
});

console.log('Area UID:', area.uid);
```

## Full intervention lifecycle

The SDK covers the complete attestation flow defined in the [schema spec](../../docs/eas-schema-spec.md):

```ts
// 1. Register area (on-chain)
const area = await client.registerArea({ ... });

// 2. Schedule intervention (off-chain + timestamped) — recipient = crew lead
const schedule = await client.scheduleIntervention({
  areaUID: area.uid,
  crewLead: crewLeadWallet,
  crewSize: 2,
  ...
});

// 3. Healthcheck before (off-chain + timestamped, linked to the scheduled intervention)
const hcBefore = await client.recordHealthcheck({
  areaUID: area.uid,
  interventionUID: schedule.uid,
  healthScore: 3,
  assessorId: staffUuid, // plain identifier — hashed internally per spec §9.1 (pass `null` for organizational assessments)
  ...
});

// 4. Each crew member runs their own checkin → checkout → report chain.
//    All three attestations per member reference the same schedule.uid (via interventionUID / checkinUID).
const aliceCheckin  = await client.checkin({ interventionUID: schedule.uid, ... }); // signed by Alice
const aliceCheckout = await client.checkout({ checkinUID: aliceCheckin.uid, ... });
const aliceReport   = await client.submitReport({ interventionUID: schedule.uid, checkoutUID: aliceCheckout.uid, ... });

const bobCheckin  = await client.checkin({ interventionUID: schedule.uid, ... }); // signed by Bob
const bobCheckout = await client.checkout({ checkinUID: bobCheckin.uid, ... });
const bobReport   = await client.submitReport({ interventionUID: schedule.uid, checkoutUID: bobCheckout.uid, ... });

// 5. Admin validation (off-chain + timestamped) — one per intervention, anchored on schedule.uid
const validation = await client.validateIntervention({
  scheduleUID: schedule.uid,
  approved: true,
  qualityScore: 8,
  validatorId: staffUuid, // plain identifier — hashed internally (pass `null` to omit individual attribution)
  ...
});

// 6. Healthcheck after
const hcAfter = await client.recordHealthcheck({
  areaUID: area.uid,
  interventionUID: schedule.uid,
  healthScore: 8,
  assessorId: staffUuid,
  ...
});

// 7. Build evidence bundle — crew is an array of { checkin, checkout, report } tuples
const bundle = client.buildEvidenceBundle({
  interventionId: 'INT-2026-0001',
  areaUID: area.uid,
  scheduled: schedule,
  crew: [
    { checkin: aliceCheckin, checkout: aliceCheckout, report: aliceReport },
    { checkin: bobCheckin,   checkout: bobCheckout,   report: bobReport },
  ],
  validation: { ...validation, approved: true, qualityScore: 8 },
  healthcheckBefore: { ...hcBefore, score: 3 },
  healthcheckAfter: { ...hcAfter, score: 8 },
});

// 8. Upload bundle (requires storage adapter)
const bundleHash = await client.uploadEvidenceBundle(bundle);

// 9. Publish intervention (on-chain) — one record per job, recipient = ZERO_ADDRESS
const intervention = await client.publishIntervention({
  areaUID: area.uid,
  interventionId: 'INT-2026-0001',
  evidenceBundleHash: bundleHash,
  // 1 scheduled + 3 per crew member (2) + 1 validation + 2 healthchecks = 10
  offchainCount: 10,
  crewSize: 2,
  ...
});

// 10. Mint milestone (on-chain, soulbound) — per gardener, from their signed report history
await client.mintMilestone({ recipient: crewLeadWallet, milestoneLevel: 1, ... });

// 11. Citizen feedback (off-chain, no timestamp)
await client.submitFeedback({ areaUID: area.uid, rating: 5, ... });
```

## Reading attestations

```ts
// Single attestation by UID
const area = await client.getArea(areaUID);
const intervention = await client.getIntervention(interventionUID);

// Query via EAS GraphQL
const interventions = await client.getAreaInterventions(areaUID);
const milestones = await client.getGardenerMilestones(walletAddress);

// Verify evidence bundle integrity
const result = await client.verifyEvidenceBundle(interventionUID);
// { valid: true, attestationCount: 7, temporalOrderValid: true, timestampsVerified: true }
```

## Storage adapter

Evidence bundle upload/download requires a storage adapter. The SDK doesn't bundle one — bring your own:

```ts
import { createOpenGardenClient } from '@refi-italia/opengarden';
import type { StorageAdapter } from '@refi-italia/opengarden';

const ipfsStorage: StorageAdapter = {
  async upload(data) {
    const cid = await pinToIPFS(data);
    return cidToBytes32(cid);
  },
  async download(hash) {
    return await fetchFromIPFS(bytes32ToCid(hash));
  },
};

const client = await createOpenGardenClient({
  signer,
  chain: 'optimism-mainnet',
  storage: ipfsStorage,
});
```

## Pre-registered schemas

Canonical UIDs for chains listed in `packages/sdk/src/chains/schemas.json` ship with the SDK — `createOpenGardenClient` merges them into the client automatically. To override a UID (custom deployment) or provide UIDs for a chain not in the JSON, pass `schemaUIDs`:

```ts
const client = await createOpenGardenClient({
  signer,
  chain: 'optimism-mainnet',
  schemaUIDs: {
    AreaRegistration: '0xcustom…',
  },
});
```

## API reference

### `createOpenGardenClient(config)` — async helper

Lazy-loads `eas-sdk`, constructs connected `EAS` + `SchemaRegistry` instances, and returns a fully-initialised `OpenGardenClient`. This is the common path.

| Config field | Type | Required | Description |
|---|---|---|---|
| `signer` | `ethers.Signer` | Yes | Wallet signer for transactions |
| `chain` | `ChainName \| ChainConfig` | Yes | Chain name string (e.g. `"optimism-mainnet"`) or full `ChainConfig` |
| `schemaUIDs` | `Partial<SchemaUIDs>` | No | Override canonical UIDs (merged on top of chain defaults) |
| `storage` | `StorageAdapter` | No | Storage adapter for evidence bundles |
| `graphqlUrl` | `string` | No | Override the EAS GraphQL endpoint used for reads |
| `storeUrl` | `string` | No | Override the off-chain attestation store endpoint |

### `new OpenGardenClient(config)` — direct DI

For consumers that already hold `eas-sdk` instances (or want to inject mocks in tests), construct the client directly:

```ts
import { EAS, SchemaRegistry } from '@ethereum-attestation-service/eas-sdk';
import { OpenGardenClient, OPTIMISM_MAINNET } from '@refi-italia/opengarden';

const eas = new EAS(OPTIMISM_MAINNET.easAddress).connect(signer);
const registry = new SchemaRegistry(OPTIMISM_MAINNET.schemaRegistryAddress).connect(signer);
const client = new OpenGardenClient({ signer, chain: OPTIMISM_MAINNET, eas, registry });
```

| Config field | Type | Required | Description |
|---|---|---|---|
| `signer` | `ethers.Signer` | Yes | Wallet signer for transactions |
| `eas` | `EAS` | Yes | Connected EAS instance (DI) |
| `registry` | `SchemaRegistry` | Yes | Connected SchemaRegistry instance (DI) |
| `chain` | `ChainName \| ChainConfig` | Yes | Chain name string or full `ChainConfig` |
| `schemaUIDs` | `Partial<SchemaUIDs>` | No | Override canonical UIDs |
| `storage` | `StorageAdapter` | No | Storage adapter for evidence bundles |
| `graphqlUrl` | `string` | No | Override the EAS GraphQL endpoint used for reads |
| `storeUrl` | `string` | No | Override the off-chain attestation store endpoint |

### Schema registration

| Method | Returns |
|---|---|
| `registerAllSchemas()` | `SchemaRegistrationResult[]` |
| `registerSchema(name)` | `SchemaRegistrationResult` |
| `getSchemaUIDs()` | `Partial<SchemaUIDs>` |

### On-chain writes

| Method | Returns | EAS recipient |
|---|---|---|
| `registerArea(data)` | `OnChainAttestationResult` | `ZERO_ADDRESS` |
| `publishIntervention(data)` | `OnChainAttestationResult` | Gardener address |
| `mintMilestone(data)` | `OnChainAttestationResult` | Gardener address |

### Off-chain writes (timestamped)

Each method signs an off-chain attestation and timestamps its UID on-chain.

| Method | Returns |
|---|---|
| `scheduleIntervention(data)` | `TimestampedOffChainResult` |
| `checkin(data)` | `TimestampedOffChainResult` |
| `checkout(data)` | `TimestampedOffChainResult` |
| `submitReport(data)` | `TimestampedOffChainResult` |
| `validateIntervention(data)` | `TimestampedOffChainResult` |
| `recordHealthcheck(data)` | `TimestampedOffChainResult` |

### Off-chain write (no timestamp)

| Method | Returns |
|---|---|
| `submitFeedback(data)` | `OffChainAttestationResult` |

### Reads

| Method | Returns |
|---|---|
| `getArea(uid)` | `Area` |
| `getIntervention(uid)` | `Intervention` |
| `getAreaInterventions(areaUID)` | `Intervention[]` (via GraphQL) |
| `getGardenerMilestones(address)` | `Milestone[]` (via GraphQL) |

### Evidence bundle

| Method | Returns |
|---|---|
| `buildEvidenceBundle(input)` | `EvidenceBundle` |
| `uploadEvidenceBundle(bundle)` | `string` (hash) |
| `verifyEvidenceBundle(interventionUID)` | `EvidenceBundleVerification` |

## Development

```bash
pnpm install
pnpm check          # type-check
pnpm test           # unit tests
pnpm build          # build with unbuild (CJS + ESM)
```

### E2E tests

Run the full lifecycle against a testnet:

```bash
# 1. Create a test wallet
pnpm create-wallet

# 2. Fund it with testnet ETH (Optimism Sepolia)

# 3. Configure .env
cp .env.example .env
# Fill in OPENGARDEN_TEST_PRIVATE_KEY and OPENGARDEN_TEST_RPC_URL

# 4. Register schemas (once per chain)
pnpm register-schemas

# 5. Run e2e tests
pnpm test:e2e
```

Schema UIDs are loaded from `src/chains/schemas.json` via each chain's `ChainConfig.schemaUIDs`. `pnpm register-schemas` persists freshly-registered UIDs back into that file; subsequent e2e runs skip the registration step automatically for any chain the JSON covers.

## Errors

All SDK errors are `OpenGardenError` instances with a typed `code`:

| Code | When |
|---|---|
| `SCHEMA_NOT_REGISTERED` | Write method called before schema registration |
| `ATTESTATION_NOT_FOUND` | `getArea`/`getIntervention` returns empty |
| `INVALID_INPUT` | Invalid input or unsupported chain for GraphQL |
| `TRANSACTION_FAILED` | On-chain transaction reverted |
| `TIMESTAMP_MISMATCH` | Bundle timestamp doesn't match on-chain |
| `BUNDLE_VERIFICATION_FAILED` | Evidence bundle integrity check failed |
| `STORAGE_NOT_CONFIGURED` | Upload/verify called without storage adapter |
| `SIGNER_ERROR` | Missing or invalid signer |

## License

MIT
