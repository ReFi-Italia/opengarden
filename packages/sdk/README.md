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
import { OpenGardenClient, OPTIMISM_MAINNET, ZERO_BYTES32 } from '@refi-italia/opengarden';

const provider = new ethers.JsonRpcProvider('https://mainnet.optimism.io');
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const client = new OpenGardenClient({
  signer,
  chain: OPTIMISM_MAINNET,
});

// Register schemas (once per chain)
await client.registerAllSchemas();

// Register an area
const area = await client.registerArea({
  areaId: 'RM-PIGN-042',
  latitude: 41.8902,
  longitude: 12.4922,
  areaType: 0, // PublicGreenSpace
  name: 'Giardino Via Appia 12',
  municipality: 'RM-I',
  metadataHash: ZERO_BYTES32,
});

console.log('Area UID:', area.uid);
```

## Full intervention lifecycle

The SDK covers the complete attestation flow defined in the [schema spec](../../docs/eas-schema-spec.md):

```ts
// 1. Register area (on-chain)
const area = await client.registerArea({ ... });

// 2. Schedule intervention (off-chain + timestamped) — created first so healthchecks can link to it
const schedule = await client.scheduleIntervention({ areaUID: area.uid, ... });

// 3. Healthcheck before (off-chain + timestamped, linked to the scheduled intervention)
const hcBefore = await client.recordHealthcheck({
  areaUID: area.uid,
  interventionUID: schedule.uid,
  healthScore: 3,
  assessorId: hashIdentifier(staffUuid),
  ...
});

// 4. Gardener checkin (off-chain + timestamped)
const checkin = await client.checkin({ interventionUID: schedule.uid, ... });

// 5. Gardener checkout (off-chain + timestamped)
const checkout = await client.checkout({ checkinUID: checkin.uid, ... });

// 6. Gardener report (off-chain + timestamped)
const report = await client.submitReport({ interventionUID: schedule.uid, checkoutUID: checkout.uid, ... });

// 7. Admin validation (off-chain + timestamped)
const validation = await client.validateIntervention({ reportUID: report.uid, approved: true, ... });

// 8. Healthcheck after (off-chain + timestamped, linked to the scheduled intervention)
const hcAfter = await client.recordHealthcheck({
  areaUID: area.uid,
  interventionUID: schedule.uid,
  healthScore: 8,
  assessorId: hashIdentifier(staffUuid),
  ...
});

// 9. Build evidence bundle
const bundle = client.buildEvidenceBundle({
  interventionId: 'INT-2026-0001',
  areaUID: area.uid,
  scheduled: schedule,
  checkin,
  checkout,
  report,
  validation: { ...validation, approved: true, qualityScore: 8 },
  healthcheckBefore: { uid: hcBefore.uid, score: 3, onchainTimestamp: hcBefore.onchainTimestamp },
  healthcheckAfter: { uid: hcAfter.uid, score: 8, onchainTimestamp: hcAfter.onchainTimestamp },
});

// 10. Upload bundle (requires storage adapter)
const bundleHash = await client.uploadEvidenceBundle(bundle);

// 11. Publish intervention (on-chain)
const intervention = await client.publishIntervention({
  areaUID: area.uid,
  interventionId: 'INT-2026-0001',
  gardener: walletAddress,
  evidenceBundleHash: bundleHash,
  offchainCount: 7,
  ...
});

// 12. Mint milestone (on-chain, soulbound)
await client.mintMilestone({ recipient: walletAddress, milestoneLevel: 1, ... });

// 13. Citizen feedback (off-chain, no timestamp)
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
import { OpenGardenClient, OPTIMISM_MAINNET } from '@refi-italia/opengarden';
import type { StorageAdapter } from '@refi-italia/opengarden';

const ipfsStorage: StorageAdapter = {
  async upload(data) {
    // Pin to IPFS, return CID as bytes32 hash
    const cid = await pinToIPFS(data);
    return cidToBytes32(cid);
  },
  async download(hash) {
    // Fetch from IPFS by hash
    return await fetchFromIPFS(bytes32ToCid(hash));
  },
};

const client = new OpenGardenClient({
  signer,
  chain: OPTIMISM_MAINNET,
  storage: ipfsStorage,
});
```

## Pre-registered schemas

If schemas are already registered on-chain, pass their UIDs to skip registration:

```ts
const client = new OpenGardenClient({
  signer,
  chain: OPTIMISM_MAINNET,
  schemaUIDs: {
    AreaRegistration: '0x948b...',
    PublishedIntervention: '0x4208...',
    // ...all 10 schemas
  },
});
```

## API reference

### Constructor

```ts
new OpenGardenClient(config: OpenGardenConfig)
```

| Config field | Type | Required | Description |
|---|---|---|---|
| `signer` | `ethers.Signer` | Yes | Wallet signer for transactions |
| `chain` | `ChainConfig` | Yes | Chain configuration (use exported constants) |
| `schemaUIDs` | `Partial<SchemaUIDs>` | No | Pre-registered schema UIDs |
| `storage` | `StorageAdapter` | No | Storage adapter for evidence bundles |

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

Set `OPENGARDEN_SCHEMA_UIDS` in `.env` to reuse already-deployed schemas and skip the registration step in tests.

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
