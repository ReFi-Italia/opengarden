# @refi-italia/opengarden

TypeScript SDK for the OpenGarden Protocol. Wraps [EAS](https://attest.org) to manage the intervention lifecycle — scheduling work, signing crew attestations, bundling evidence, publishing on-chain records, and minting gardener milestones.

For protocol design, schema shapes, temporal-integrity rules, trust model, and verification semantics (protocol tier vs verifier-policy tier), see the [**EAS Schema Spec**](../../docs/eas-schema-spec.md). This README covers how to drive the SDK — it does not duplicate protocol documentation.

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

## Area registration (one-time per area)

Every intervention references an `AreaRegistration` attestation as its geographic anchor. Areas are registered **once per area**, not per intervention — a single `areaUID` is shared by every scheduled, executed, and published intervention on that site.

```ts
const area = await client.registerArea({
  areaId: 'RM-PIGN-042',
  latitude: 41.8902,
  longitude: 12.4922,
  areaType: AreaType.PublicGreenSpace,
  name: 'Giardino Via Appia 12',
  municipality: 'RM-I',
  metadataHash: null,
});

// Persist area.uid application-side. All subsequent interventions and
// healthchecks for this site reuse the same UID.
```

Run this once when onboarding a new site. Areas are `revocable: false` on-chain — the registration is a permanent geographic fact.

## Intervention lifecycle — SDK mapping

Spec [§3–§4](../../docs/eas-schema-spec.md#3-off-chain-schemas) defines the attestation flow and temporal rules. The SDK exposes one method per protocol step. All methods below reference an existing `areaUID` from a prior `registerArea` call.

```ts
// Schedule intervention (off-chain + timestamped)
const schedule = await client.scheduleIntervention({
  areaUID,
  crewLead: crewLeadWallet,
  crewSize: 2,
  ...
});

// Per crew member: checkin → checkout → report. Each signed by the member's wallet.
const aliceCheckin  = await client.checkin({ interventionUID: schedule.uid, ... });
const aliceCheckout = await client.checkout({ checkinUID: aliceCheckin.uid, ... });
const aliceReport   = await client.submitReport({ interventionUID: schedule.uid, checkoutUID: aliceCheckout.uid, ... });
// … same three calls for every other crew member.

// Build evidence bundle — crew is an array of { checkin, checkout, report } tuples
const bundle = client.buildEvidenceBundle({
  interventionId: 'INT-2026-0001',
  areaUID,
  scheduled: schedule,
  crew: [
    { checkin: aliceCheckin, checkout: aliceCheckout, report: aliceReport },
    { checkin: bobCheckin,   checkout: bobCheckout,   report: bobReport },
  ],
});

// Upload bundle (requires storage adapter)
const bundleHash = await client.uploadEvidenceBundle(bundle);

// Publish intervention on-chain. Publication IS the organization's quality
// sign-off — see spec §1 and §2.2. Internal QA fields stay DB-side.
const intervention = await client.publishIntervention({
  areaUID,
  interventionId: 'INT-2026-0001',
  evidenceBundleHash: bundleHash,
  ...
});

// Mint gardener milestone (on-chain, soulbound) — once the gardener's report
// history crosses a threshold. Orthogonal to any single intervention.
await client.mintMilestone({ recipient: crewLeadWallet, milestoneLevel: 1, ... });
```

`areaUID` and other parent references are routed to the EAS-native `refUID` slot internally — the SDK's input/output types always accept and return them under their logical name (e.g. `Intervention.areaUID`). See spec [§2–§3 attestation metadata notes](../../docs/eas-schema-spec.md#2-on-chain-schemas) and [§6 reference graph](../../docs/eas-schema-spec.md#6-attestation-reference-graph).

`finalizeIntervention(input)` bundles the build-bundle, upload, and publish steps into a single call with preflight input validation.

## Healthchecks (independent of interventions)

Healthchecks are a periodic area-condition signal. They reference an `areaUID` but **are not tied to any intervention** — readers merge the healthcheck timeline with the intervention timeline by timestamp to reconstruct area state.

```ts
const hc = await client.recordHealthcheck({
  areaUID,
  healthScore: 8,
  photoHash: ZERO_BYTES32,
  notes: 'Hedge trimmed, beds mulched.',
  metadata: '',
});
```

Any wallet may issue a Healthcheck. The attester's role (organization / gardener / citizen) is resolved by the reader at aggregation time — see spec [§3.6](../../docs/eas-schema-spec.md#36-healthcheck) and [§7.4](../../docs/eas-schema-spec.md#74-example-policy--healthcheck-weighting) for weighting policies.

## Reading attestations

```ts
// Single attestation by UID
const area = await client.getArea(areaUID);
const intervention = await client.getIntervention(interventionUID);

// Query via EAS GraphQL
const interventions = await client.getAreaInterventions(areaUID);
const healthchecks = await client.getAreaHealthchecks(areaUID);
const milestones = await client.getGardenerMilestones(walletAddress);

// Verify evidence bundle
const result = await client.verifyEvidenceBundle(interventionUID);
// { valid, temporalOrderValid, timestampsVerified, executionDateBracketed, checks }
```

### Verification tiers

Spec [§5 verification flow](../../docs/eas-schema-spec.md#5-evidence-bundle-structure) splits verification into a **protocol tier** (non-negotiable: hash, signatures, timestamps, bundle version) and a **policy tier** (verifier's call: attester-role filtering, crew-size cross-check, distinctness, temporal strictness, etc.).

#### Policies as data

`finalizeIntervention` (write-side gate) and `verifyEvidenceBundle` (read-side composite) accept a `policy` option naming which checks they enforce. Rationale and trust model in [spec §7](../../docs/eas-schema-spec.md#7-trust-model).

```ts
import {
  STRICT_FINALIZE_POLICY,       // default — every issue blocks publish
  MINIMAL_FINALIZE_POLICY,      // only structural issues block
  LENIENT_FINALIZE_POLICY,      // nothing blocks
  finalizePolicy,               // ({ blocking: FinalizeInputIssueCode[] })

  STRICT_VERIFY_POLICY,         // default — every sub-check must pass
  PROTOCOL_ONLY_VERIFY_POLICY,  // only protocol-tier checks required
  verifyPolicy,                 // ({ required: VerificationCheckCode[] })
} from '@refi-italia/opengarden';

await client.finalizeIntervention(input, { policy: LENIENT_FINALIZE_POLICY });

const verdict = await client.verifyEvidenceBundle(uid, {
  policy: PROTOCOL_ONLY_VERIFY_POLICY,
});
// verdict.checks[] always contains every sub-check; `policy` only controls
// which ones roll up into `verdict.valid`.
```

Omit `policy` to get the strict default (back-compat with prior behavior).

#### Composing individual helpers

`verifyEvidenceBundle(uid)` currently runs the protocol tier plus a default strict policy (temporal order, execution-date bracket). For custom policies, compose individual helpers:

| Helper | Tier | Purpose |
|---|---|---|
| `verifyBundleVersion(bundle)` | Protocol | Reject unknown bundle versions |
| `verifyBundleSignatures(bundle, eas)` | Protocol | Recover EIP-712 signer per entry; confirm bundle's `attester` matches |
| `verifyBundleOnChainTimestamps(bundle, fetchTs)` | Protocol | Bundle timestamps match `EAS.getTimestamp` |
| `verifyBundleRefUIDs(bundle)` | Policy | Signed messages' `refUID` point at expected parents |
| `verifyBundleTemporalOrder(bundle)` | Policy | Strict `T_scheduled < T_checkin < T_checkout < T_report` |
| `verifyBundleExecutionDateBracket(bundle, intervention)` | Policy | `executionDate` sits between scheduled and publication |
| `verifyBundleCrewSize(bundle, scheduled)` | Policy | Bundle crew arrays match `ScheduledIntervention.crewSize` |
| `verifyBundleCrewConsistency(bundle)` | Policy | Each member's checkin/checkout/report share one attester |
| `verifyBundleCrewDistinctness(bundle)` | Policy | Every crew member's attester wallet is distinct |

See spec [§7.3–§7.4](../../docs/eas-schema-spec.md#73-example-policy--conservative-organizational-auditor) for sample policy compositions — e.g. conservative auditor (strict crew-size + distinctness + temporal) vs permissive dashboard (protocol tier only).

Example — composing a conservative auditor policy:

```ts
import {
  verifyBundleVersion,
  verifyBundleSignatures,
  verifyBundleOnChainTimestamps,
  verifyBundleRefUIDs,
  verifyBundleTemporalOrder,
  verifyBundleCrewSize,
  verifyBundleCrewConsistency,
  verifyBundleCrewDistinctness,
} from '@refi-italia/opengarden';

// Assume `bundle`, `scheduled`, `eas`, and `fetchTs` are already resolved.
const checks = [
  verifyBundleVersion(bundle),
  await verifyBundleSignatures(bundle, eas),
  await verifyBundleOnChainTimestamps(bundle, fetchTs),
  verifyBundleRefUIDs(bundle),
  verifyBundleTemporalOrder(bundle),
  verifyBundleCrewSize(bundle, scheduled),
  verifyBundleCrewConsistency(bundle),
  verifyBundleCrewDistinctness(bundle),
];
const valid = checks.every((c) => c.valid);
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

Schema strings (the source of truth for UID derivation) are defined in [spec §8](../../docs/eas-schema-spec.md#8-schema-registration-reference).

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
| `publishIntervention(data)` | `OnChainAttestationResult` | `ZERO_ADDRESS` |
| `mintMilestone(data)` | `OnChainAttestationResult` | Gardener address |

### Off-chain writes (timestamped)

Each method signs an off-chain attestation and timestamps its UID on-chain.

| Method | Returns |
|---|---|
| `scheduleIntervention(data)` | `TimestampedOffChainResult` |
| `checkin(data)` | `TimestampedOffChainResult` |
| `checkout(data)` | `TimestampedOffChainResult` |
| `submitReport(data)` | `TimestampedOffChainResult` |
| `recordHealthcheck(data)` | `TimestampedOffChainResult` |

### Reads

| Method | Returns |
|---|---|
| `getArea(uid)` | `Area` |
| `getIntervention(uid)` | `Intervention` |
| `getAreaInterventions(areaUID)` | `Intervention[]` (via GraphQL) |
| `getAreaHealthchecks(areaUID)` | `Healthcheck[]` (via GraphQL) |
| `getGardenerMilestones(address)` | `Milestone[]` (via GraphQL) |

### Evidence bundle

| Method | Returns |
|---|---|
| `buildEvidenceBundle(input)` | `EvidenceBundle` |
| `uploadEvidenceBundle(bundle)` | `string` (hash) |
| `finalizeIntervention(input)` | `FinalizeInterventionResult` — build + upload + publish in one call, with preflight |
| `verifyEvidenceBundle(interventionUID)` | `EvidenceBundleVerification` |

Composable verification helpers (for custom policies): `verifyBundleVersion`, `verifyBundleSignatures`, `verifyBundleOnChainTimestamps`, `verifyBundleRefUIDs`, `verifyBundleTemporalOrder`, `verifyBundleExecutionDateBracket`, `verifyBundleCrewSize`, `verifyBundleCrewConsistency`, `verifyBundleCrewDistinctness`. See [Verification tiers](#verification-tiers) above.

Policy presets + builders: `STRICT_FINALIZE_POLICY`, `MINIMAL_FINALIZE_POLICY`, `LENIENT_FINALIZE_POLICY`, `finalizePolicy`, `STRICT_VERIFY_POLICY`, `PROTOCOL_ONLY_VERIFY_POLICY`, `verifyPolicy`.

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
