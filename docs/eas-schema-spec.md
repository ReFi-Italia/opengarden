**OpenGarden Protocol**

# EAS Attestation Schema Design Specification

Blockchain-Verified Urban Gardening Impact System

| | |
|---|---|
| Version | **1.0** |
| Date | **March 2026** |
| Status | **Draft** |
| Chain | **Celo (EAS deployed)** |

---

## 1. Architecture Overview

This document defines the attestation schemas for the OpenGarden blockchain-verified urban gardening system. The architecture uses Ethereum Attestation Service (EAS) as the attestation primitive, with a clear separation between on-chain settlement records and off-chain operational data.

### On-Chain / Off-Chain Split

The system anchors three record types on-chain and keeps all operational lifecycle data off-chain. This minimizes gas costs while preserving full verifiability through content-addressed hashes.

| Schema | Layer | Attester | Purpose |
|---|---|---|---|
| **AreaRegistration** | On-chain | Organization | Geographic anchor |
| **PublishedIntervention** | On-chain | Organization | Verified completion record |
| **GardenerMilestone** | On-chain (SBT) | Organization | Portable credential |
| **ScheduledIntervention** | Off-chain + timestamped | Organization | Task planning |
| **GardenerCheckin** | Off-chain + timestamped | Gardener* | Presence proof |
| **GardenerCheckout** | Off-chain + timestamped | Gardener* | Session closure |
| **GardenerReport** | Off-chain + timestamped | Gardener* | Work evidence |
| **AdminValidation** | Off-chain + timestamped | Organization | Quality sign-off |
| **Healthcheck** | Off-chain + timestamped | Any wallet | Periodic area-condition signal |

_\*Implementation deferred until the release of the Gardeners' app_

> **Design Principle**
>
> Every on-chain attestation is a finalized, validated record. Off-chain attestations accumulate during the work lifecycle and are referenced by content hash in the on-chain publication. This follows a commit–settle pattern: operate off-chain, settle on-chain.

> **Temporal Integrity Principle**
>
> Off-chain attestations are cryptographically signed (EIP-712) but their timestamps are self-reported. To prevent backfilling — fabricating interventions after the fact — every off-chain attestation in the intervention lifecycle is timestamped on-chain via EAS's native `timestamp()` function. This creates an immutable, independently verifiable temporal ordering that proves each step happened when claimed.

---

## 2. On-Chain Schemas

These schemas produce permanent, publicly verifiable records on the EAS contract. They represent finalized states only.

### 2.1 AreaRegistration

Registered once per work area. Serves as the canonical geographic anchor that all interventions reference. Created when the organization begins maintaining a new area.

> **ON-CHAIN** · Revocable: No

| Field | Type | Description |
|---|---|---|
| **areaId** | `string` | Internal unique identifier for the area (e.g. "RM-PIGN-042") |
| **latitude** | `int32` | GPS latitude in microdegrees (lat × 1,000,000). Signed for S hemisphere. |
| **longitude** | `int32` | GPS longitude in microdegrees (lng × 1,000,000). Signed for W hemisphere. |
| **areaType** | `uint8` | 0 = unspecified, 1 = public green space, 2 = private garden, 3 = institutional grounds, 4 = roadside/median |
| **name** | `string` | Human-readable area name (e.g. "Giardino Via Appia 12") |
| **municipality** | `string` | Municipality or district code for institutional mapping |
| **metadataHash** | `bytes32` | IPFS CID hash of extended metadata JSON (boundaries, photos, surface area m²). `ZERO_BYTES32` if no extended metadata |

> **Attestation Metadata**
>
> Recipient: ZERO_ADDRESS (no specific recipient — this is a public record).
> Attester: Organization wallet.
> Revocable: No. An area registration is a permanent geographic fact.
> RefUID: ZERO_BYTES32 (root attestation, no parent reference).

> **Gas Optimization**
>
> Coordinates use int32 microdegrees instead of string to reduce calldata. The metadataHash offloads variable-length data (boundary polygons, high-res photos, surface area calculations) to IPFS while keeping the on-chain record compact. Extended metadata is not needed for on-chain verification — only for display and audit.

### 2.2 PublishedIntervention

Created only after an intervention is fully executed and validated by the organization. This is the canonical **job record** — one per intervention, regardless of crew size. It bundles all off-chain operational attestations (including per-gardener checkins, checkouts, and reports for crew jobs) by referencing their content hashes.

> **ON-CHAIN** · Revocable: No

| Field | Type | Description |
|---|---|---|
| **areaUID** | `bytes32` | EAS UID of the AreaRegistration attestation this intervention belongs to |
| **interventionId** | `string` | Internal intervention identifier (e.g. "INT-2026-0187") |
| **interventionType** | `uint8` | 0 = unspecified, 1 = routine maintenance, 2 = restoration, 3 = emergency, 4 = seasonal, 5 = new planting |
| **executionDate** | `uint64` | Unix timestamp of when work was completed |
| **commissionRef** | `bytes32` | Keccak256 hash of commissioning entity identifier (corporate sponsor ID, municipal contract number, or grant ID). `ZERO_BYTES32` for volunteer / unsponsored work |
| **evidenceBundleHash** | `bytes32` | IPFS CID hash of the evidence bundle JSON containing all off-chain attestation UIDs, their content hashes, and their on-chain timestamps |
| **offchainCount** | `uint8` | Number of off-chain attestations bundled (enables completeness verification). For crew jobs this includes one checkin, one checkout, and one report *per crew member* |
| **crewSize** | `uint8` | Total number of gardeners on this intervention (1 for solo jobs) |

> **Attestation Metadata**
>
> Recipient: ZERO_ADDRESS. A PublishedIntervention is a public job record, not a credential addressed to any individual. Per-gardener credentialing flows through GardenerMilestone SBTs (Section 2.3) whose evidence is the set of validated GardenerReports bundled inside the PublishedIntervention's evidence bundle.
> Attester: Organization wallet.
> Revocable: No. A published intervention is a historical fact.
> RefUID: AreaRegistration UID (creating an explicit parent–child link in the EAS graph).

> **The commissionRef Field**
>
> This is the single most important field for the protocol's top two audiences (corporates and municipalities). It links every verified intervention to its funding source without exposing the funder's identity on-chain. The hash can be resolved off-chain by authorized parties. This enables per-sponsor impact reporting: "Sponsor X funded 23 interventions with average health improvement of 4.2 points."

> **Crew Interventions**
>
> A crew job produces a single PublishedIntervention. Each crew member independently signs their own GardenerCheckin, GardenerCheckout, and GardenerReport attestations — these are cryptographically tied to their wallet via EAS off-chain signatures and all reference the same `interventionUID`. The evidence bundle collects every crew member's signed chain alongside the one-per-job ScheduledIntervention and AdminValidation. No consumer-side deduplication is required, and no field in the PublishedIntervention discriminates individual crew members — `crewSize` records headcount, nothing more.
>
> **To prove an individual gardener contributed to a specific intervention**, a verifier reads the PublishedIntervention, fetches the evidence bundle, and checks for a GardenerReport whose attester is that gardener's wallet. The gardener's aggregated credential (career history, level) is the GardenerMilestone SBT, which is directly addressed to their wallet.

### 2.3 GardenerMilestone (Soulbound)

A non-transferable credential minted when a gardener crosses a meaningful threshold. This is the gardener's portable proof of skill and reliability. Designed to be legible to future employers, housing authorities, and social services.

> **ON-CHAIN** · Revocable: No


| Field | Type | Description |
|---|---|---|
| **milestoneLevel** | `uint8` | Progressive level: 1 = Apprentice (5 validated), 2 = Gardener (15), 3 = Senior (40), 4 = Master (100) |
| **totalInterventions** | `uint16` | Cumulative count of interventions the gardener personally signed a GardenerReport for at time of minting |
| **totalValidated** | `uint16` | Subset of the above whose parent PublishedIntervention carries an approved AdminValidation |
| **avgHealthImprovement** | `uint8` | Average area-health improvement attributable to the gardener's validated interventions, derived off-chain from the area's Healthcheck timeline (pre/post delta around each intervention's executionDate). `0` if no measurable signal |
| **skillTier** | `string` | Human-readable credential label (e.g. "Certified Urban Gardener — Level 3") |
| **achievedAt** | `uint64` | Unix timestamp when milestone was reached |
| **evidenceRoot** | `bytes32` | Merkle root of the PublishedIntervention UIDs the gardener contributed to (one leaf per intervention). The organization computes this at mint time by scanning its evidence bundles for GardenerReports signed by the recipient wallet. `ZERO_BYTES32` for credentials migrated from pre-chain reputation systems |

> **Attestation Metadata**
>
> Recipient: Gardener wallet address.
> Attester: Organization wallet.
> Revocable: No. A credential once earned is permanent.
> RefUID: ZERO_BYTES32 (standalone credential).
> Non-transferable: Inherent in EAS — attestations have no transfer function.

> **Why Soulbound**
>
> The gardener's reputation must not be tradeable. A transferable credential would undermine its meaning as proof of personal work history. EAS attestations are inherently non-transferable — there is no transfer function in the protocol. Combined with `revocable: false`, the credential is permanently bound to the recipient wallet without any additional contract logic. If a gardener loses wallet access, the organization can attest a new milestone to a recovered wallet, referencing the same evidence root.

---

## 3. Off-Chain Schemas

These schemas produce signed, timestamped attestations stored off-chain (IPFS or organization infrastructure). They are never published individually on-chain. Instead, their content hashes are bundled into the PublishedIntervention attestation upon completion.

All off-chain attestations use EAS off-chain signing (EIP-712 typed signatures) for cryptographic integrity without gas costs.

All off-chain attestations in the intervention lifecycle (ScheduledIntervention through AdminValidation) are **timestamped on-chain** via `EAS.timestamp()` immediately after creation. See [Section 4: Temporal Integrity](#4-temporal-integrity) for the protocol rules.

### 3.1 ScheduledIntervention

Created when the organization plans a new intervention. One ScheduledIntervention per job, regardless of crew size. It may never reach on-chain if the intervention is cancelled or rescheduled.

> **OFF-CHAIN** · Revocable: Yes · **Timestamped on-chain: Required**

| Field | Type | Description |
|---|---|---|
| **areaUID** | `bytes32` | EAS UID of the target AreaRegistration |
| **interventionId** | `string` | Internal ID, will carry through to PublishedIntervention if completed |
| **interventionType** | `uint8` | Same enum as PublishedIntervention (0–5) |
| **crewSize** | `uint8` | Total number of gardeners assigned (1 for solo jobs) |
| **scheduledDate** | `uint64` | Planned execution date as Unix timestamp |
| **estimatedMinutes** | `uint16` | Expected duration in minutes (`0` = unspecified) |
| **description** | `string` | Free-text description of required work |
| **commissionRef** | `bytes32` | Hash of commissioning entity (matches PublishedIntervention field). `ZERO_BYTES32` for volunteer / unsponsored work |

> **Attestation Metadata**
>
> Recipient: Crew lead wallet (so the lead receives the assignment notification and is operationally responsible for the crew). `ZERO_ADDRESS` is permitted for unassigned schedules that will be reassigned via revoke-and-re-create.
> Attester: Organization wallet.
> Revocable: Yes. If an intervention is cancelled or rescheduled, the original attestation is revoked and a new one created. This maintains a clean audit trail of planning decisions.
> RefUID: AreaRegistration UID (areaUID field provides the same linkage within the attestation data).

> **Temporal Anchoring**
>
> This is the most critical attestation to timestamp on-chain. The on-chain timestamp of the ScheduledIntervention proves that planning preceded execution. A PublishedIntervention whose `executionDate` predates its schedule's on-chain timestamp is provably backfilled. See [Section 4.2](#42-temporal-ordering-rules).

### 3.2 GardenerCheckin

Created by the gardener (or their device) when arriving at the work site. Establishes presence and start time. **One per crew member per intervention.** Each crew member independently signs their own checkin; all of them reference the same `interventionUID`.

> **OFF-CHAIN** · Revocable: No · **Timestamped on-chain: Required**

| Field | Type | Description |
|---|---|---|
| **interventionUID** | `bytes32` | Off-chain UID of the ScheduledIntervention attestation |
| **latitude** | `int32` | GPS latitude at check-in (microdegrees) |
| **longitude** | `int32` | GPS longitude at check-in (microdegrees) |
| **timestamp** | `uint64` | Device timestamp at moment of check-in |
| **photoHash** | `bytes32` | IPFS CID of arrival photo (visual proof of presence and initial site condition) |

> **Attestation Metadata**
>
> Recipient: ZERO_ADDRESS (self-attestation of presence).
> Attester: Gardener wallet.
> Revocable: No. A check-in is a factual record of arrival.
> RefUID: ScheduledIntervention UID (interventionUID field).

> **Verification**
>
> GPS proximity to the registered area coordinates can be verified programmatically.

### 3.3 GardenerCheckout

Created when the gardener finishes work at the site. Closes the work session. **One per crew member per intervention**, each paired to the same crew member's checkin via `checkinUID`.

> **OFF-CHAIN** · Revocable: No · **Timestamped on-chain: Required**

| Field | Type | Description |
|---|---|---|
| **checkinUID** | `bytes32` | Off-chain UID of the corresponding GardenerCheckin attestation |
| **timestamp** | `uint64` | Device timestamp at checkout |
| **actualMinutes** | `uint16` | Actual time spent on site in minutes |

> **Attestation Metadata**
>
> Recipient: ZERO_ADDRESS.
> Attester: Gardener wallet.
> Revocable: No. A checkout is a factual record of session closure.
> RefUID: GardenerCheckin UID (checkinUID field).

### 3.4 GardenerReport

The gardener's own account of the work performed. This is the primary evidence document and the foundation of the gardener's verifiable work history. **One per crew member per intervention.** For crew jobs, each crew member writes their own report — the set of reports is the cryptographic roster of who actually worked.

> **OFF-CHAIN** · Revocable: No · **Timestamped on-chain: Required**

| Field | Type | Description |
|---|---|---|
| **interventionUID** | `bytes32` | Off-chain UID of the ScheduledIntervention |
| **checkoutUID** | `bytes32` | Off-chain UID of the GardenerCheckout attestation |
| **tasksCompleted** | `string` | Comma-separated list of completed task codes (e.g. "PRUNE,CLEAN,WATER,PLANT") |
| **taskCount** | `uint8` | Number of discrete tasks completed |
| **photosHash** | `bytes32` | IPFS CID of photo bundle (after-work documentation) |
| **notes** | `string` | Free-text field for gardener observations, issues encountered, materials used |

> **Attestation Metadata**
>
> Recipient: ZERO_ADDRESS.
> Attester: Gardener wallet. The report is the gardener's signed testimony, validated (or not) by the organization in the next step.
> Revocable: No. A submitted report is a permanent record.
> RefUID: ScheduledIntervention UID (interventionUID field).

### 3.5 AdminValidation

The organization's quality assessment of the completed work. This is the gate between operational data and on-chain publication. **One AdminValidation per intervention**, regardless of crew size — the validator is judging the job as a whole, not individual crew members. All per-gardener reports, checkins, and checkouts live in the evidence bundle the PublishedIntervention references; the AdminValidation anchors on the ScheduledIntervention because that's the single off-chain root of the intervention. Only interventions that pass validation become PublishedInterventions.

> **OFF-CHAIN** · Revocable: Yes · **Timestamped on-chain: Required**

| Field | Type | Description |
|---|---|---|
| **scheduleUID** | `bytes32` | Off-chain UID of the ScheduledIntervention being validated |
| **approved** | `bool` | Whether the work meets quality standards |
| **qualityScore** | `uint8` | Quality assessment (1–10 scale; `0` = unscored, for binary approve/reject workflows) |
| **feedback** | `string` | Written feedback to the crew (visible via the evidence bundle, not surfaced individually on-chain) |
| **validatorId** | `bytes32` | Hashed identifier of the staff member who performed validation. `ZERO_BYTES32` for organizational validation without individual attribution |

> **Attestation Metadata**
>
> Recipient: ZERO_ADDRESS. Validation is job-level, not addressed to any individual crew member.
> Attester: Organization wallet.
> Revocable: Yes. If validation is issued in error, it can be revoked and reissued. This is the only quality gate in the system and must allow correction.
> RefUID: ScheduledIntervention UID (scheduleUID field).

### 3.6 Healthcheck

A periodic condition assessment of an area. Independent of any specific intervention — it is raw signal about the area's current state at a point in time. Healthchecks accumulate into an area-scoped timeline that consumers aggregate to compute trend, derive pre/post-intervention deltas, or flag areas needing attention.

> **OFF-CHAIN** · Revocable: No · **Timestamped on-chain: Required**

| Field | Type | Description |
|---|---|---|
| **areaUID** | `bytes32` | EAS UID of the AreaRegistration being assessed |
| **healthScore** | `uint8` | Condition score (1–10 scale, 10 is best) |
| **photoHash** | `bytes32` | IPFS CID of condition documentation photo (`ZERO_BYTES32` if none) |
| **notes** | `string` | Free-text observations (empty string if none) |
| **metadata** | `string` | App-specific JSON escape hatch (empty string for none). See below. |

> **metadata field**
>
> A free-form JSON string for app-specific extras that the protocol does not interpret (weather, assessor wallet annotations, seasonal context, etc.). Consumers that don't recognize the shape ignore it. Empty string means no metadata. The field travels inside the attestation, so there is no separate file to host, fetch, or pin.

> **Attestation Metadata**
>
> Recipient: ZERO_ADDRESS.
> Attester: Any wallet — organization, gardener, or citizen. Role is inferred **off-chain** from the issuer wallet: match against the AreaRegistration attester (organization) or the app-maintained gardener roster, otherwise treat as citizen signal.
> Revocable: No. A health assessment is a factual measurement record at a given time.
> RefUID: **AreaRegistration UID** — `areaUID` is also passed as the EAS `refUID` parameter so healthchecks are indexed by area in the EAS graph without burning a schema field. It is duplicated inside the attestation data so readers who only have the decoded payload still know which area it belongs to.

> **Area-scoped, intervention-independent**
>
> Healthchecks reference the area, not a specific intervention. An area's timeline contains both Healthcheck and PublishedIntervention streams — readers merge them by timestamp to reconstruct condition changes around each intervention.

> **Trust & aggregation**
>
> A single Healthcheck is raw signal. Aggregation, weighting by issuer role, and thresholding ("does this area need an intervention?") are **app-layer** decisions — the SDK only surfaces the raw timeline via `getAreaHealthchecks(areaUID)`.

---

## 4. Temporal Integrity

EIP-712 signatures prove **who** signed and **what** was signed, but not **when**. Without temporal anchoring, the entire off-chain evidence chain could be fabricated in a single batch with backdated timestamps.

### 4.1 Mechanism

EAS exposes native timestamping on the core contract:

```solidity
function timestamp(bytes32 data) external returns (uint64);
function multiTimestamp(bytes32[] calldata data) external returns (uint64);
```

These record an off-chain attestation UID alongside the current **block timestamp** in an immutable on-chain mapping. Each UID can only be timestamped once (`AlreadyTimestamped` revert). The block timestamp is set by the Celo validator, not the caller. The attestation data stays off-chain — only the UID is anchored. Cost on Celo: ~$0.0001 per call.

### 4.2 Ordering Rules

Every off-chain attestation in the intervention lifecycle MUST be timestamped on-chain immediately after creation. For a crew of size N, each crew member `i ∈ {1..N}` independently produces `(checkin_i, checkout_i, report_i)`. The on-chain timestamps MUST satisfy:

```
T_schedule < min(T_checkin[*])
for each i:  T_checkin[i] < T_checkout[i] < T_report[i]
max(T_report[*]) < T_validation < T_publication
```

Put plainly: scheduling precedes every crew member's arrival, each crew member checks out after checking in and reports after checking out, and validation happens after every crew member's report is recorded. There is no ordering constraint *between* crew members — Alice can finish her shift before Bob even arrives.

The claimed `executionDate` in PublishedIntervention MUST fall within the bracket:

```
T_schedule ≤ executionDate ≤ T_publication
```

Healthchecks are an independent periodic stream outside the intervention lifecycle. Their on-chain timestamps are the authoritative time anchor for aggregation; no bracket rule ties them to scheduled/checkin/checkout/report/validation timestamps.

A PublishedIntervention whose `executionDate` predates `T_schedule` is provably backfilled.

### 4.3 Timestamping Protocol

Each off-chain attestation is timestamped individually via `EAS.timestamp(uid)`. Steps that are logically simultaneous (e.g., a single gardener's checkout and report) MAY be batched via `multiTimestamp()`. Steps that must demonstrate elapsed time (e.g., checkin and checkout for the same gardener) MUST NOT be batched. All N crew members' checkins across a single crew job MAY be batched together if they genuinely arrive at the same moment, since the relative ordering between crew members is unconstrained.

Total cost per intervention lifecycle: `2 + 3N` timestamps (scheduled + validation + per-crew-member checkin/checkout/report). A solo job is `5` timestamps at **~$0.0005**. A 4-person crew is `14` timestamps at **~$0.0014**. At 1,000 interventions/month with an average crew of 2, this is well under $1/month. Healthchecks are timestamped independently outside the intervention lifecycle.

### 4.4 MVP Minimum

At minimum, **timestamp the ScheduledIntervention on-chain**. Combined with the inherent block timestamp of the on-chain PublishedIntervention, this brackets the intervention: `T_schedule < work < T_publication`. This alone defeats the bulk-backfill attack. The intermediate timestamps (checkin through validation) SHOULD be implemented from launch given the negligible cost.

---

## 5. Evidence Bundle Structure

The evidenceBundleHash field in PublishedIntervention points to a JSON document on IPFS that links all off-chain attestations for a given intervention. This is the bridge between the off-chain operational layer and the on-chain settlement layer.

The `scheduled` and `validation` entries are always single (one per job). The `checkins`, `checkouts`, and `reports` entries are **always arrays** — length 1 for solo jobs, length N for a crew of N. Consumers treat solo and crew jobs uniformly by iterating the arrays; there is no separate code path.

**evidence-bundle.json** (crew of 2 shown)

```json
{
  "interventionId": "INT-2026-0187",
  "areaUID": "0xabc...def",
  "attestations": {
    "scheduled": {
      "uid": "0x123...789",
      "contentHash": "0xfed...321",
      "claimedTimestamp": 1709251200,
      "onchainTimestamp": 1709251215
    },
    "checkins": [
      {
        "uid": "0x456...012",
        "contentHash": "0xcba...654",
        "attester": "0xAlice...",
        "claimedTimestamp": 1709337600,
        "onchainTimestamp": 1709337618
      },
      {
        "uid": "0x457...013",
        "contentHash": "0xcbb...655",
        "attester": "0xBob...",
        "claimedTimestamp": 1709337650,
        "onchainTimestamp": 1709337670
      }
    ],
    "checkouts": [
      {
        "uid": "0x789...345",
        "contentHash": "0xabc...678",
        "attester": "0xAlice...",
        "claimedTimestamp": 1709344800,
        "onchainTimestamp": 1709344812
      },
      {
        "uid": "0x790...346",
        "contentHash": "0xabd...679",
        "attester": "0xBob...",
        "claimedTimestamp": 1709344900,
        "onchainTimestamp": 1709344920
      }
    ],
    "reports": [
      {
        "uid": "0xdef...901",
        "contentHash": "0x456...789",
        "attester": "0xAlice...",
        "claimedTimestamp": 1709345100,
        "onchainTimestamp": 1709345120
      },
      {
        "uid": "0xdf0...902",
        "contentHash": "0x457...790",
        "attester": "0xBob...",
        "claimedTimestamp": 1709345200,
        "onchainTimestamp": 1709345220
      }
    ],
    "validation": {
      "uid": "0x234...567",
      "contentHash": "0x987...123",
      "approved": true,
      "qualityScore": 8,
      "claimedTimestamp": 1709424000,
      "onchainTimestamp": 1709424025
    }
  },
  "photos": {
    "checkinPhotos": ["ipfs://Qm.../alice-arrival.jpg", "ipfs://Qm.../bob-arrival.jpg"],
    "reportPhotos": "ipfs://Qm.../work-evidence/",
    "afterPhotos": "ipfs://Qm.../completion/"
  },
  "bundleVersion": "0.1.0"
}
```

> **Bundle Fields**
>
> - `claimedTimestamp`: The self-reported timestamp from the off-chain attestation data (device time, application time). This is what the attester claims.
> - `onchainTimestamp`: The block timestamp from `EAS.timestamp()`. This is the authoritative, independently verifiable time anchor.
> - `attester` (per-gardener entries only): The wallet that signed the attestation. This is the canonical gardener identity — it matches the EAS off-chain signature and is how a verifier proves a specific gardener contributed to the intervention.
>
> The `onchainTimestamp` fields are technically redundant — they can be verified by reading the EAS contract's timestamp mapping directly. Including them in the bundle enables offline verification without a chain query, with the expectation that auditors performing due diligence will spot-check against the chain.

> **Bundle Version**
>
> The bundle format is versioned with semver. The current version is `0.1.0`. Consumers MUST reject bundles whose `bundleVersion` they don't understand. Pre-1.0 versions are unstable — breaking changes may land in a 0.x.y bump.

> **Verification Flow**
>
> Anyone with the PublishedIntervention UID can:
> (1) Read the evidenceBundleHash from the on-chain attestation.
> (2) Fetch the JSON from IPFS.
> (3) Verify each off-chain attestation signature independently — `attester` on each array entry MUST match the EIP-712 signer.
> (4) Confirm the bundle is complete by checking `offchainCount` matches the number of attestations in the bundle: `1 (scheduled) + checkins.length + checkouts.length + reports.length + 1 (validation)`. For a well-formed bundle, `checkins.length == checkouts.length == reports.length == PublishedIntervention.crewSize`.
> (5) **Verify temporal integrity:** For each attestation in the bundle, query `EAS.getTimestamp(uid)` on-chain and confirm the on-chain timestamps match the bundle's `onchainTimestamp` values and satisfy the ordering rules in Section 4.2 (including the per-crew-member `T_checkin[i] < T_checkout[i] < T_report[i]` check).
> (6) **To prove an individual gardener's participation**, find the report in `reports` whose `attester` matches the gardener's wallet; verify its EAS signature.
>
> This provides full end-to-end verifiability — both content integrity and temporal integrity — without putting operational data on-chain.

---

## 6. Attestation Reference Graph

EAS attestations can reference each other via the refUID field, creating a directed graph. The following describes the reference relationships in this system.

| From | | To | Relationship |
|---|---|---|---|
| PublishedIntervention | → | AreaRegistration | refUID (EAS native) |
| PublishedIntervention | → | Evidence Bundle | evidenceBundleHash |
| ScheduledIntervention | → | AreaRegistration | areaUID field |
| GardenerCheckin | → | ScheduledIntervention | interventionUID field |
| GardenerCheckout | → | GardenerCheckin | checkinUID field |
| GardenerReport | → | ScheduledIntervention | interventionUID field |
| GardenerReport | → | GardenerCheckout | checkoutUID field |
| AdminValidation | → | ScheduledIntervention | scheduleUID field |
| Healthcheck | → | AreaRegistration | `areaUID` field + EAS refUID parameter (area is indexed in the EAS graph and also present in the decoded payload) |
| GardenerMilestone | → | (standalone) | evidenceRoot field |

> **Graph Traversal**
>
> Starting from any PublishedIntervention, an auditor can traverse the full evidence chain:
> On-chain attestation → evidence bundle on IPFS → individual off-chain attestations → photos and documents → on-chain timestamps for each step.
>
> Starting from any AreaRegistration, a dashboard can aggregate all interventions and healthchecks for that location, then merge them by timestamp to render a condition timeline.

---

## 7. Trust Model

All schemas are registered without a resolver contract. Trust is established at the **read layer** — by verifying attester address and on-chain timestamps — not at the write layer. Schema = vocabulary. Attester = authority. Timestamp = when.

### 7.1 Attester-Based Trust

| Attester | Trust level | Schemas |
|---|---|---|
| **Organization wallet** | Authoritative | AreaRegistration, PublishedIntervention, GardenerMilestone, ScheduledIntervention, AdminValidation |
| **Registered gardener wallet** | Verified participant | GardenerCheckin, GardenerCheckout, GardenerReport |
| **Any wallet** (role inferred off-chain) | Variable — organizations authoritative, gardeners verified, citizens untrusted | Healthcheck |

Each organization adopting the OpenGarden Protocol publishes its attester address on its website and in the schema metadata on IPFS. On-chain attestations from unknown wallets are ignored by any consumer that filters by attester. Off-chain attestations use EIP-712 signatures verified against the known attester address (organization wallet, gardener registry, or any wallet for Healthcheck). For Healthcheck, the issuer's role — and therefore the weight a reader gives the score — is derived off-chain by matching the attester wallet against the AreaRegistration attester (organization) or the app-maintained gardener roster, otherwise treating it as a citizen observation.

### 7.2 Two-Dimensional Trust

Attester identity verifies **who**. On-chain timestamps (Section 4) verify **when**. A trustworthy record requires both — a trusted attester with no timestamp has unverifiable timing; a timestamped record from an unknown attester has no authority.

### 7.3 Open Protocol

By not binding schemas to a resolver, the same definitions can be adopted by other organizations. A municipal program in another city can attest to the same schemas with their own wallet. Cross-organization dashboards aggregate impact by trusting a set of known attesters.

---

## 8. Schema Registration Reference

The following are the exact schema strings to register on the EAS SchemaRegistry contract. Each schema is registered once and receives a permanent UID. All schemas are registered with `resolver: ZERO_ADDRESS` (no resolver contract).

**AreaRegistration** (revocable: false)
```
string areaId, int32 latitude, int32 longitude, uint8 areaType, string name, string municipality, bytes32 metadataHash
```

**PublishedIntervention** (revocable: false)
```
bytes32 areaUID, string interventionId, uint8 interventionType, uint64 executionDate, bytes32 commissionRef, bytes32 evidenceBundleHash, uint8 offchainCount, uint8 crewSize
```

**GardenerMilestone** (revocable: false)
```
uint8 milestoneLevel, uint16 totalInterventions, uint16 totalValidated, uint8 avgHealthImprovement, string skillTier, uint64 achievedAt, bytes32 evidenceRoot
```

**ScheduledIntervention** (revocable: true)
```
bytes32 areaUID, string interventionId, uint8 interventionType, uint64 scheduledDate, uint16 estimatedMinutes, string description, bytes32 commissionRef, uint8 crewSize
```

**GardenerCheckin** (revocable: false)
```
bytes32 interventionUID, int32 latitude, int32 longitude, uint64 timestamp, bytes32 photoHash
```

**GardenerCheckout** (revocable: false)
```
bytes32 checkinUID, uint64 timestamp, uint16 actualMinutes
```

**GardenerReport** (revocable: false)
```
bytes32 interventionUID, bytes32 checkoutUID, string tasksCompleted, uint8 taskCount, bytes32 photosHash, string notes
```

**AdminValidation** (revocable: true)
```
bytes32 scheduleUID, bool approved, uint8 qualityScore, string feedback, bytes32 validatorId
```

**Healthcheck** (revocable: false)
```
bytes32 areaUID, uint8 healthScore, bytes32 photoHash, string notes, string metadata
```
> `areaUID` is also passed as the EAS `refUID` parameter so healthchecks are indexed by area in the EAS graph. It is duplicated inside the attestation data so readers who only have the decoded payload still know which area it belongs to.

---

## 9. SDK Encoding Conventions

Several `bytes32` fields in the schemas above are opaque hashes whose derivation is not enforced at the protocol layer — any value fits on-chain. For auditors to reproduce and verify these hashes, the SDK fixes a single canonical derivation per field. Divergent conventions break cross-organization verification. These conventions are normative for any implementation that claims compatibility with the `@refi-italia/opengarden` SDK.

### 9.1 Hashed Identifiers

Fields carrying a hashed reference to an internal identifier (UUID, staff ID, contract number) MUST be derived as:

```
bytes32 = keccak256(utf8Bytes(internalId))
```

The input is treated as a raw UTF-8 string with no normalization, trimming, casing change, or prefix. The caller is responsible for using the same string representation across every attestation that references the same entity.

Applies to:

| Schema | Field | Input |
|---|---|---|
| PublishedIntervention | `commissionRef` | Commissioning entity identifier (sponsor ID, municipal contract number, grant ID) |
| ScheduledIntervention | `commissionRef` | Same as PublishedIntervention (must match for the same intervention) |
| AdminValidation | `validatorId` | Internal staff identifier of the validating admin |

SDK helper: `hashIdentifier(id: string): string`

### 9.2 Photo and Media Bundles

Fields carrying a hash of one or more media references (`photoHash`, `photosHash`, `metadataHash`) MUST be derived as follows.

**Single item.** When a field references exactly one file (e.g. `GardenerCheckin.photoHash` — one arrival photo), the bytes32 is whatever content-addressed hash the organization's storage adapter returns for that file. The SDK does not constrain the algorithm — it only requires that the value be reproducible by fetching the file and rehashing it with the documented algorithm.

**Multiple items.** When a field references N > 1 files (e.g. `GardenerReport.photosHash` — after-work photo bundle), the bytes32 MUST be the keccak256 of a canonical manifest:

```
manifest = {"v":1,"items":[<item>, <item>, ...]}
bytes32  = keccak256(utf8Bytes(JSON.stringify(manifest)))
```

Canonicalization rules:

1. `v` is the manifest version, currently `1`. Future versions MUST bump this and MUST be treated as a distinct manifest shape.
2. `items` is the list of content-addressed references (IPFS CIDs, storage adapter hashes, or URLs) **sorted in JavaScript string-comparison order** before serialization. Callers pass items in any order; the SDK sorts.
3. `JSON.stringify` is used with default settings — no custom spacing, no key reordering beyond what the object literal expresses. The manifest object has exactly two keys in the order `v`, `items`.
4. The manifest itself SHOULD be uploaded to the organization's storage (alongside the photos) so auditors can fetch it and reproduce the hash without guessing the item set.

SDK helper: `hashPhotoBundle(items: string[]): string`

Applies to any media-bundle field that references multiple items. Fields that always reference a single item (`GardenerCheckin.photoHash`, `Healthcheck.photoHash`) use the single-item rule above.

### 9.3 Coordinate Encoding

GPS coordinates in EAS schemas are signed `int32` microdegrees (`decimal × 1,000,000`, truncated). This is a fixed-point representation chosen to keep calldata small and to eliminate floating-point ambiguity. The SDK exposes `toMicrodegrees` / `fromMicrodegrees` helpers and applies the conversion internally when encoding coordinate fields.

### 9.4 Timestamps

Off-chain attestation `timestamp` fields are Unix seconds (`uint64`), matching the EAS EIP-712 `time` field convention. These are **self-reported** timestamps from the signing device. The authoritative time anchor for any attestation is the on-chain timestamp established via `EAS.timestamp(uid)` — see Section 4. Consumers MUST NOT trust a self-reported `timestamp` field in isolation.
