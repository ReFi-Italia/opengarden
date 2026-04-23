# @refi-italia/opengarden

TypeScript SDK for the OpenGarden Protocol. Wraps [EAS](https://attest.org) to manage the intervention lifecycle — scheduling work, signing crew activities, bundling evidence, publishing on-chain records, and minting gardener milestones.

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

## Quick start — full lifecycle

The canonical path. `finalizeIntervention` orchestrates preflight → build bundle → upload → index → publish in one call. Unless you need mid-flight control, use it.

```ts
import { ethers } from 'ethers';
import {
  createOpenGardenClient,
  AreaType,
  InterventionType,
} from '@refi-italia/opengarden';

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const client = await createOpenGardenClient({
  signer,
  chain: 'optimism-sepolia',
  storage: ipfsStorage, // see "Storage adapter" section below
});

// 1. One-time: register the area.
const area = await client.registerArea({
  areaId: 'RM-PIGN-042',
  latitude: 41.8902,
  longitude: 12.4922,
  areaType: AreaType.PublicGreenSpace,
  name: 'Giardino Via Appia 12',
  municipality: 'RM-I',
  boundary: null,
  metadata: '',
});

// 2. Schedule + execute (each activity timestamped on-chain).
const interventionId = 'INT-2026-0001';

const schedule = await client.scheduleIntervention({
  interventionId,
  areaUID: area.uid,
  interventionType: InterventionType.RoutineMaintenance,
  crewLead: signer.address,
  crewSize: 1,
  scheduledDate: new Date(),
  plannedDuration: 60,
  tasksPlanned: ['PRUNE', 'CLEAN'],
  description: 'Trim hedges, mulch beds.',
  commissionId: null,
});

const checkin  = await client.checkin({  interventionId, latitude: 41.89, longitude: 12.49 });
const checkout = await client.checkout({ interventionId, latitude: 41.89, longitude: 12.49 });
const report   = await client.submitReport({ interventionId, tasksCompleted: ['PRUNE', 'CLEAN'], reportedEffort: 55, mediaCID: '', notes: '' });

// 3. Finalize — one call: preflight + bundle + upload + index + publish.
const result = await client.finalizeIntervention({
  interventionId,
  areaUID: area.uid,
  schedule,
  crewActivities: [checkin, checkout, report],
  interventionType: InterventionType.RoutineMaintenance,
  executionDate: new Date(),
  commissionId: null,
});

console.log('Intervention UID:', result.publication.uid);
console.log('Bundle hash:     ', result.evidenceBundleHash);
console.log('Indexed:         ', `${result.indexedCount}/${result.indexingResults.length}`);
```

That's the entire write-side flow. Read-side: `client.verifyEvidenceBundle(result.publication.uid)`.

## Concepts

A 30-second mental model before diving into sections below.

- **Activity** — the single off-chain schema that carries every lifecycle event (`schedule`, `checkin`, `checkout`, `report`, `healthcheck`). Each Activity is EIP-712 signed and has its UID timestamped on-chain via `EAS.timestamp()`. See spec [§3](../../docs/eas-schema-spec.md#3-off-chain-schema).
- **Intervention scope hash** — `keccak256(utf8Bytes(interventionId))`. Every lifecycle Activity sets `refUID = interventionScopeHash`, so a single EAS query returns the whole chain. Writers only need the `interventionId` string — no need to pass around the schedule Activity's UID. See spec [§9.7](../../docs/eas-schema-spec.md#97-intervention-scope-hash).
- **Evidence bundle** — a flat JSON array of Activities (schedule + crew) with their full signed envelopes and plaintext payloads. Uploaded to storage, hashed, referenced from the on-chain `Intervention`. Healthchecks are area-scoped and are NOT bundled. See spec [§5](../../docs/eas-schema-spec.md#5-evidence-bundle-structure).
- **Crew pairing by signer** — a crew member's `(checkin, checkout, report)` triple is identified by matching `signer` within the intervention scope, not by a refUID chain. A crew signer's own wallet is the link.

## Area registration

Every intervention references an `AreaRegistration` as its geographic anchor. Areas are registered **once per area** — a single `areaUID` is reused by every scheduled / executed / published intervention and every healthcheck on that site.

```ts
const area = await client.registerArea({
  areaId: 'RM-PIGN-042',
  latitude: 41.8902,
  longitude: 12.4922,
  areaType: AreaType.PublicGreenSpace,
  name: 'Giardino Via Appia 12',
  municipality: 'RM-I',
  boundary: null,         // or a GeoJSON-shaped object; SDK keccaks the canonical JSON (spec §9.8) and commits the hash on-chain
  metadata: '',           // or a small inline JSON string (spec §9.6; 512-byte budget)
});
```

Areas are `revocable: false`.

## Intervention lifecycle

Spec [§3–§4](../../docs/eas-schema-spec.md#3-off-chain-schema) defines the single polymorphic Activity schema and the temporal ordering rules. Five lifecycle methods — one per Activity type — each signs off-chain + timestamps on-chain.

| Method | Activity type | What it signs |
|---|---|---|
| `scheduleIntervention(input)` | `schedule` | The job plan. Recipient = crew lead. |
| `checkin(input)` | `checkin` | Gardener arrival. Time anchor + optional GPS. |
| `checkout(input)` | `checkout` | Session closure. Time anchor + optional GPS. |
| `submitReport(input)` | `report` | Tasks + effort + media + notes. |
| `recordHealthcheck(input)` | `healthcheck` | Periodic area-condition signal. Area-scoped, not bundled. |

Every lifecycle method except `recordHealthcheck` takes an `interventionId: string`. Under the hood, `refUID` is set to `keccak256(interventionId)` — the scope hash — so crew devices don't need the schedule Activity's UID to sign their own checkins.

Each crew member signs their own checkin/checkout/report from their own wallet. For a crew job, call the three gardener methods once per member, then pass all activities as a flat list into `finalizeIntervention`:

```ts
// Alice's chain (signed with Alice's wallet)
const aCheckin  = await aliceClient.checkin({  interventionId, latitude, longitude });
const aCheckout = await aliceClient.checkout({ interventionId, latitude, longitude });
const aReport   = await aliceClient.submitReport({ interventionId, tasksCompleted: ['PRUNE'], reportedEffort: 55, mediaCID: aMedia, notes: '' });

// Bob's chain (signed with Bob's wallet)
const bCheckin  = await bobClient.checkin({  interventionId, latitude, longitude });
const bCheckout = await bobClient.checkout({ interventionId, latitude, longitude });
const bReport   = await bobClient.submitReport({ interventionId, tasksCompleted: ['CLEAN'], reportedEffort: 60, mediaCID: bMedia, notes: '' });

// Organization finalizes
await orgClient.finalizeIntervention({
  interventionId,
  areaUID,
  schedule,
  crewActivities: [aCheckin, aCheckout, aReport, bCheckin, bCheckout, bReport],
  interventionType: InterventionType.RoutineMaintenance,
  executionDate: new Date(),
  commissionId: null,
});
```

Pairing (which checkout is Alice's, which is Bob's) is resolved by signer wallet — no UID chain to wire up.

### Providing `time` explicitly

`checkin`, `checkout`, `submitReport`, `recordHealthcheck`, and `scheduleIntervention` all accept an optional `time?: Date | bigint` field. The SDK writes it into the EIP-712 envelope's `message.time`.

- **Sign at the moment of the event** → omit `time`. Wall-clock default.
- **Sign server-side on later upload** → pass the device-recorded moment explicitly. Otherwise the envelope claims the upload moment, not the actual event.

## Healthchecks (independent of interventions)

Healthcheck Activities are a periodic area-condition signal. They reference an `areaUID` but **are not tied to any intervention** — readers merge the healthcheck timeline with the intervention timeline by timestamp to reconstruct area state. Healthchecks are area-scoped (`refUID = AreaRegistration UID`) and are NOT bundled into intervention evidence bundles.

```ts
const hc = await client.recordHealthcheck({
  areaUID,
  healthScore: 8,
  mediaCID: 'ipfs://Qm.../condition.jpg',
  notes: 'Hedge trimmed, beds mulched.',
  metadata: { v: 1, weather: 'sunny' },
});
```

Any wallet may issue a healthcheck Activity. The signer's role (organization / gardener / citizen) is resolved by the reader at aggregation time — see spec [§3.2.5](../../docs/eas-schema-spec.md#325-healthcheck-payload) and [§7.4](../../docs/eas-schema-spec.md#74-example-policy--healthcheck-weighting) for weighting policies.

## Reading

```ts
// Single attestation by UID
const area = await client.getArea(areaUID);
const intervention = await client.getIntervention(interventionUID);

// Query via EAS GraphQL
const interventions = await client.getAreaInterventions(areaUID);
const milestones = await client.getGardenerMilestones(walletAddress);

// Activity-layer reads — returns activity headers (UID + decoded activityType/payloadHash).
// Plaintext payloads live in evidence bundles (for published interventions) or
// the publishing organization's attestation store (for in-flight activities).
const activities = await client.getInterventionActivities(interventionId);
const healthchecks = await client.getAreaHealthchecks(areaUID);

// Verify an evidence bundle end-to-end
const result = await client.verifyEvidenceBundle(interventionUID);
// {
//   valid,
//   bundleVersionValid, signaturesValid, payloadIntegrityValid, timestampsVerified,
//   interventionScopeValid, temporalOrderValid, executionDateBracketed,
//   checks
// }
```

> **Note on `getInterventionActivities` visibility.** Activities only appear in easscan's GraphQL `attestations` table once submitted to its off-chain store. `finalizeIntervention` does this automatically via `indexBundleAttestations`; if you compose manually (see [Advanced](#advanced-manual-composition) below) and skip indexing, the scope-hash query returns empty even though the Activities are signed and timestamped. The bundle hash remains verifiable either way.

### Verification tiers

Spec [§5 verification flow](../../docs/eas-schema-spec.md#5-evidence-bundle-structure) splits verification into a **protocol tier** (non-negotiable: bundle version, signatures, payload integrity, on-chain timestamps) and a **policy tier** (verifier's call: intervention scope, temporal ordering, execution-date bracket, crew-size cross-check, distinctness, consistency).

`finalizeIntervention` (write-side gate) and `verifyEvidenceBundle` (read-side composite) both accept a `policy` option that names which checks they enforce. Checks the policy doesn't require still run and appear in `checks[]`, but don't count toward `valid`.

```ts
import {
  STRICT_FINALIZE_POLICY,       // default — every known issue blocks publish
  MINIMAL_FINALIZE_POLICY,      // only structural issues block
  LENIENT_FINALIZE_POLICY,      // nothing blocks
  finalizePolicy,               // ({ blocking: FinalizeInputIssueCode[] })

  STRICT_VERIFY_POLICY,         // default — every core sub-check must pass
  PROTOCOL_ONLY_VERIFY_POLICY,  // only protocol-tier checks required
  verifyPolicy,                 // ({ required: VerificationCheckCode[] })
} from '@refi-italia/opengarden';

await client.finalizeIntervention(input, { policy: LENIENT_FINALIZE_POLICY });

const verdict = await client.verifyEvidenceBundle(uid, {
  policy: PROTOCOL_ONLY_VERIFY_POLICY,
});
```

Omit `policy` to get the strict default.

### Composable verification helpers

`verifyEvidenceBundle` runs a default strict policy. For custom verification flows (e.g. a conservative auditor applying crew-distinctness and schedule-uniqueness), compose individual helpers:

| Helper | Tier | Purpose |
|---|---|---|
| `verifyBundleVersion(bundle)` | Protocol | Reject unknown bundle versions |
| `verifyBundleSignatures(bundle, eas)` | Protocol | Recover EIP-712 signer per activity; confirm bundle-level `signer` matches embedded signer |
| `verifyBundlePayloadIntegrity(bundle)` | Protocol | Each activity's `payload` canonicalizes (§9.8) to the signed `payloadHash`; `activityType` matches `type` |
| `verifyBundleOnChainTimestamps(bundle, fetchTs)` | Protocol | Bundle timestamps match `EAS.getTimestamp` |
| `verifyBundleInterventionScope(bundle, intervention)` | Policy | Every lifecycle activity's `refUID` equals `keccak256(intervention.interventionId)` |
| `verifyBundleTemporalOrder(bundle)` | Policy | Per-signer `T_schedule < T_checkin < T_checkout < T_report` |
| `verifyBundleExecutionDateBracket(bundle, intervention)` | Policy | `executionDate` sits between schedule and publication |
| `verifyBundleCrewSize(bundle)` | Policy | Count of `checkin` activities matches `schedule.payload.crewSize` |
| `verifyBundleCrewConsistency(bundle)` | Policy | Each crew signer has exactly one checkin + checkout + report |
| `verifyBundleCrewDistinctness(bundle)` | Policy | Every crew signer wallet is distinct |
| `verifyBundleScheduleUniqueness(bundle)` | Policy | Exactly one `schedule` activity in the bundle |

See spec [§7.3–§7.4](../../docs/eas-schema-spec.md#73-example-policy--conservative-organizational-auditor) for example policy compositions.

Example — conservative-auditor policy:

```ts
import {
  verifyBundleVersion,
  verifyBundleSignatures,
  verifyBundlePayloadIntegrity,
  verifyBundleOnChainTimestamps,
  verifyBundleInterventionScope,
  verifyBundleTemporalOrder,
  verifyBundleCrewSize,
  verifyBundleCrewConsistency,
  verifyBundleCrewDistinctness,
  verifyBundleScheduleUniqueness,
} from '@refi-italia/opengarden';

const checks = [
  verifyBundleVersion(bundle),
  await verifyBundleSignatures(bundle, eas),
  verifyBundlePayloadIntegrity(bundle),
  await verifyBundleOnChainTimestamps(bundle, (uid) => eas.getTimestamp(uid)),
  verifyBundleInterventionScope(bundle, intervention),
  verifyBundleTemporalOrder(bundle),
  verifyBundleCrewSize(bundle),
  verifyBundleCrewConsistency(bundle),
  verifyBundleCrewDistinctness(bundle),
  verifyBundleScheduleUniqueness(bundle),
];
const valid = checks.every((c) => c.valid);
```

## Advanced: manual composition

`finalizeIntervention` is a thin orchestrator over four composable primitives. Use them directly only if you need custom error handling between steps, you're writing tests, or you maintain your own indexer.

```ts
// 1. Preflight (pure, no side effects)
import { validateFinalizeInput } from '@refi-italia/opengarden';
const issues = validateFinalizeInput(input);
if (issues.length > 0) throw new Error('preflight failed');

// 2. Build evidence bundle (pure)
const bundle = client.buildEvidenceBundle({
  interventionId,
  areaUID,
  schedule,
  crewActivities: [checkin, checkout, report],
});

// 3. Upload to storage (returns bundle hash)
const evidenceBundleHash = await client.uploadEvidenceBundle(bundle);

// 4. Submit to easscan off-chain store (makes activities queryable via GraphQL)
const indexingResults = await client.indexBundleAttestations({
  interventionId, areaUID, schedule, crewActivities,
});

// 5. Publish on-chain
const publication = await client.publishIntervention({
  areaUID, interventionId,
  interventionType: InterventionType.RoutineMaintenance,
  executionDate: new Date(),
  commissionId: null,
  evidenceBundleHash,
});
```

Skipping step (4) is a common gotcha — the bundle is still verifiable (the evidence bundle hash is the authoritative commitment), but `getInterventionActivities` / third-party easscan queries will return empty until the activities are submitted to the off-chain store. Prefer `finalizeIntervention` unless you have a specific reason not to.

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

Schema strings (the source of truth for UID derivation) are defined in [spec §8](../../docs/eas-schema-spec.md#8-schema-registration-reference). The protocol defines four schemas: `AreaRegistration`, `Intervention`, `GardenerMilestone`, `Activity`.

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

### Off-chain Activity writes (timestamped)

Each method builds a typed Activity payload, signs an EAS offchain envelope, and timestamps its UID on-chain. All lifecycle methods set `refUID = keccak256(input.interventionId)` internally; `recordHealthcheck` uses `areaUID` as refUID since healthchecks are area-scoped.

| Method | Returns | Activity type |
|---|---|---|
| `scheduleIntervention(input)` | `TimestampedOffChainResult` | `schedule` |
| `checkin(input)` | `TimestampedOffChainResult` | `checkin` |
| `checkout(input)` | `TimestampedOffChainResult` | `checkout` |
| `submitReport(input)` | `TimestampedOffChainResult` | `report` |
| `recordHealthcheck(input)` | `TimestampedOffChainResult` | `healthcheck` |

### Reads

| Method | Returns |
|---|---|
| `getArea(uid)` | `Area` |
| `getIntervention(uid)` | `Intervention` |
| `getAreaInterventions(areaUID)` | `Intervention[]` (via GraphQL) |
| `getGardenerMilestones(address)` | `Milestone[]` (via GraphQL) |
| `getInterventionActivities(interventionId)` | Activity headers (UID, `activityType`, `payloadHash`, signer, `refUID`, time, revoked). Payload plaintext lives in the evidence bundle. |
| `getAreaHealthchecks(areaUID)` | Healthcheck Activity headers for an area. |

### Evidence bundle

| Method | Returns |
|---|---|
| `finalizeIntervention(input)` | `FinalizeInterventionResult` — **preflight + build + upload + index + publish in one call**. Use this unless you need manual control. |
| `buildEvidenceBundle(input)` | `EvidenceBundle` (pure builder) |
| `uploadEvidenceBundle(bundle)` | `string` (bundle hash) |
| `indexBundleAttestations(input)` | `BundleIndexingResult[]` (submits activities to easscan off-chain store) |
| `verifyEvidenceBundle(interventionUID)` | `EvidenceBundleVerification` |

### Media uploads

| Method | Returns |
|---|---|
| `uploadMedia(data)` | `string` CID for a single blob (`Uint8Array` or `string`). Thin passthrough over `storage.upload`. Use for `healthcheck.mediaCID` or a single-file `report.mediaCID`. |
| `uploadMediaBundle(items)` | `string` CID of a canonical manifest (spec §9.2) referencing N files. Accepts a mix of `Uint8Array` (uploads as-is) and `string` (treated as an already-uploaded CID). Manifest items are sorted for determinism. Use for `report.mediaCID` when a report needs to attest multiple files. |

Both methods require a `StorageAdapter` in the client config. The storage model is otherwise unchanged — the SDK still only uploads the evidence bundle itself inside `finalizeIntervention`; media uploads are a caller-driven helper for the ergonomics case where the app wants to upload during report assembly rather than running its own adapter dance.

Composable verification helpers: `verifyBundleVersion`, `verifyBundleSignatures`, `verifyBundlePayloadIntegrity`, `verifyBundleOnChainTimestamps`, `verifyBundleInterventionScope`, `verifyBundleTemporalOrder`, `verifyBundleExecutionDateBracket`, `verifyBundleCrewSize`, `verifyBundleCrewConsistency`, `verifyBundleCrewDistinctness`, `verifyBundleScheduleUniqueness`. See [Composable verification helpers](#composable-verification-helpers) above.

Policy presets + builders: `STRICT_FINALIZE_POLICY`, `MINIMAL_FINALIZE_POLICY`, `LENIENT_FINALIZE_POLICY`, `finalizePolicy`, `STRICT_VERIFY_POLICY`, `PROTOCOL_ONLY_VERIFY_POLICY`, `verifyPolicy`.

Hashing primitives: `hashInterventionScope(interventionId)`, `hashActivityPayload(payload)`, `hashIdentifier(id)`, `hashBoundary(blob)`, `hashMediaManifest(items)`, `canonicalJSON(value)`.

Type guards for decoded activities: `isScheduleActivity`, `isCheckinActivity`, `isCheckoutActivity`, `isReportActivity`, `isHealthcheckActivity`.

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
| `ATTESTATION_NOT_FOUND` | `getArea` / `getIntervention` returns empty |
| `INVALID_INPUT` | Invalid input, unsupported chain for GraphQL, or preflight blocking issue in `finalizeIntervention` |
| `BUNDLE_VERIFICATION_FAILED` | Evidence bundle integrity check failed (e.g. unsupported `bundleVersion`) |
| `STORAGE_NOT_CONFIGURED` | `uploadEvidenceBundle` / `verifyEvidenceBundle` called without a storage adapter |
| `SIGNER_ERROR` | Missing or invalid signer, or transaction receipt unavailable |

## License

MIT
