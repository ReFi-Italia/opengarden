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
| **AreaRegistration** | On-chain | OpenGarden | Geographic anchor |
| **PublishedIntervention** | On-chain | OpenGarden | Verified completion record |
| **GardenerMilestone** | On-chain (SBT) | OpenGarden | Portable credential |
| **ScheduledIntervention** | Off-chain + timestamped | OpenGarden | Task planning |
| **GardenerCheckin** | Off-chain + timestamped | Gardener* | Presence proof |
| **GardenerCheckout** | Off-chain + timestamped | Gardener* | Session closure |
| **GardenerReport** | Off-chain + timestamped | Gardener* | Work evidence |
| **AdminValidation** | Off-chain + timestamped | OpenGarden | Quality sign-off |
| **CitizenFeedback** | Off-chain | Citizen* | Community signal |
| **Healthcheck** | Off-chain + timestamped | OpenGarden | Condition measurement |

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

Registered once per work area. Serves as the canonical geographic anchor that all interventions reference. Created when OpenGarden begins maintaining a new area.

> **ON-CHAIN** · Revocable: No

| Field | Type | Description |
|---|---|---|
| **areaId** | `string` | Internal unique identifier for the area (e.g. "RM-PIGN-042") |
| **latitude** | `int32` | GPS latitude in microdegrees (lat × 1,000,000). Signed for S hemisphere. |
| **longitude** | `int32` | GPS longitude in microdegrees (lng × 1,000,000). Signed for W hemisphere. |
| **areaType** | `uint8` | 0 = public green space, 1 = private garden, 2 = institutional grounds, 3 = roadside/median |
| **name** | `string` | Human-readable area name (e.g. "Giardino Via Appia 12") |
| **municipality** | `string` | Municipality or district code for institutional mapping |
| **metadataHash** | `bytes32` | IPFS CID hash of extended metadata JSON (boundaries, photos, surface area m²) |

> **Attestation Metadata**
>
> Recipient: ZERO_ADDRESS (no specific recipient — this is a public record).
> Attester: OpenGarden wallet.
> Revocable: No. An area registration is a permanent geographic fact.
> RefUID: ZERO_BYTES32 (root attestation, no parent reference).

> **Gas Optimization**
>
> Coordinates use int32 microdegrees instead of string to reduce calldata. The metadataHash offloads variable-length data (boundary polygons, high-res photos, surface area calculations) to IPFS while keeping the on-chain record compact. Extended metadata is not needed for on-chain verification — only for display and audit.

### 2.2 PublishedIntervention

Created only after an intervention is fully executed and validated by OpenGarden. This is the canonical impact record. It bundles all off-chain operational attestations by referencing their content hashes.

> **ON-CHAIN** · Revocable: No

| Field | Type | Description |
|---|---|---|
| **areaUID** | `bytes32` | EAS UID of the AreaRegistration attestation this intervention belongs to |
| **interventionId** | `string` | Internal intervention identifier (e.g. "INT-2026-0187") |
| **gardener**\* | `address` | Wallet address of the lead gardener who performed the work |
| **interventionType** | `uint8` | 0 = routine maintenance, 1 = restoration, 2 = emergency, 3 = seasonal, 4 = new planting |
| **executionDate** | `uint64` | Unix timestamp of when work was completed |
| **healthBefore** | `uint8` | Area health score before intervention (1–10 scale) |
| **healthAfter** | `uint8` | Area health score after intervention (1–10 scale) |
| **commissionRef** | `bytes32` | Keccak256 hash of commissioning entity identifier (corporate sponsor ID, municipal contract number, or grant ID) |
| **evidenceBundleHash** | `bytes32` | IPFS CID hash of the evidence bundle JSON containing all off-chain attestation UIDs, their content hashes, and their on-chain timestamps |
| **offchainCount** | `uint8` | Number of off-chain attestations bundled (enables completeness verification) |
| **crewSize** | `uint8` | Total number of gardeners on this intervention (1 for solo jobs) |
| **isLead** | `bool` | Whether this gardener is the crew lead (used for impact deduplication) |

_\*OpenGarden address until gardeners app release_


> **Attestation Metadata**
>
> Recipient: Gardener wallet address
> Attester: OpenGarden wallet.
> Revocable: No. A published intervention is a historical fact.
> RefUID: AreaRegistration UID (creating an explicit parent–child link in the EAS graph).

> **The commissionRef Field**
>
> This is the single most important field for the OpenGarden top two audiences (corporates and municipalities). It links every verified intervention to its funding source without exposing the funder's identity on-chain. The hash can be resolved off-chain by authorized parties. This enables per-sponsor impact reporting: "Sponsor X funded 23 interventions with average health improvement of 4.2 points."

> **Crew Interventions**
>
> When multiple gardeners work the same job, OpenGarden creates one PublishedIntervention per gardener, all sharing the same `interventionId` and `evidenceBundleHash`. Each gardener is the EAS `recipient` of their own attestation. Consumers deduplicate for impact reporting by grouping on `interventionId` and counting only the record where `isLead = true`.

### 2.3 GardenerMilestone (Soulbound)

A non-transferable credential minted when a gardener crosses a meaningful threshold. This is the gardener's portable proof of skill and reliability. Designed to be legible to future employers, housing authorities, and social services.

> **ON-CHAIN** · Revocable: No


| Field | Type | Description |
|---|---|---|
| **milestoneLevel** | `uint8` | Progressive level: 1 = Apprentice (5 validated), 2 = Gardener (15), 3 = Senior (40), 4 = Master (100) |
| **totalInterventions** | `uint16` | Cumulative count of interventions completed at time of minting |
| **totalValidated** | `uint16` | Count of interventions that passed OpenGarden validation |
| **avgHealthImprovement** | `uint8` | Average health score delta across all interventions (0–10) |
| **skillTier** | `string` | Human-readable credential label (e.g. "Certified Urban Gardener — Level 3") |
| **achievedAt** | `uint64` | Unix timestamp when milestone was reached |
| **evidenceRoot** | `bytes32` | Merkle root of all PublishedIntervention UIDs that contributed to this milestone |

> **Attestation Metadata**
>
> Recipient: Gardener wallet address.
> Attester: OpenGarden wallet.
> Revocable: No. A credential once earned is permanent.
> RefUID: ZERO_BYTES32 (standalone credential).
> Non-transferable: Inherent in EAS — attestations have no transfer function.

> **Why Soulbound**
>
> The gardener's reputation must not be tradeable. A transferable credential would undermine its meaning as proof of personal work history. EAS attestations are inherently non-transferable — there is no transfer function in the protocol. Combined with `revocable: false`, the credential is permanently bound to the recipient wallet without any additional contract logic. If a gardener loses wallet access, OpenGarden can attest a new milestone to a recovered wallet, referencing the same evidence root.

---

## 3. Off-Chain Schemas

These schemas produce signed, timestamped attestations stored off-chain (IPFS or OpenGarden infrastructure). They are never published individually on-chain. Instead, their content hashes are bundled into the PublishedIntervention attestation upon completion.

All off-chain attestations use EAS off-chain signing (EIP-712 typed signatures) for cryptographic integrity without gas costs.

All off-chain attestations in the intervention lifecycle (ScheduledIntervention through AdminValidation) are **timestamped on-chain** via `EAS.timestamp()` immediately after creation. See [Section 4: Temporal Integrity](#4-temporal-integrity) for the protocol rules.

### 3.1 ScheduledIntervention

Created when OpenGarden plans a new intervention. This is the task assignment. It may never reach on-chain if the intervention is cancelled or rescheduled.

> **OFF-CHAIN** · Revocable: Yes · **Timestamped on-chain: Required**

| Field | Type | Description |
|---|---|---|
| **areaUID** | `bytes32` | EAS UID of the target AreaRegistration |
| **interventionId** | `string` | Internal ID, will carry through to PublishedIntervention if completed |
| **interventionType** | `uint8` | Same enum as PublishedIntervention (0–4) |
| **assignedGardener** | `address` | Wallet of the crew lead (may change before execution) |
| **crewSize** | `uint8` | Total number of gardeners assigned (1 for solo jobs) |
| **scheduledDate** | `uint64` | Planned execution date as Unix timestamp |
| **estimatedMinutes** | `uint16` | Expected duration in minutes |
| **description** | `string` | Free-text description of required work |
| **commissionRef** | `bytes32` | Hash of commissioning entity (matches PublishedIntervention field) |

> **Attestation Metadata**
>
> Recipient: Assigned gardener wallet.
> Attester: OpenGarden wallet.
> Revocable: Yes. If an intervention is cancelled or rescheduled, the original attestation is revoked and a new one created. This maintains a clean audit trail of planning decisions.
> RefUID: AreaRegistration UID (areaUID field provides the same linkage within the attestation data).

> **Temporal Anchoring**
>
> This is the most critical attestation to timestamp on-chain. The on-chain timestamp of the ScheduledIntervention proves that planning preceded execution. A PublishedIntervention whose `executionDate` predates its schedule's on-chain timestamp is provably backfilled. See [Section 4.2](#42-temporal-ordering-rules).

### 3.2 GardenerCheckin

Created by the gardener (or their device) when arriving at the work site. Establishes presence and start time.

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

Created when the gardener finishes work at the site. Closes the work session.

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

The gardener's own account of the work performed. This is the primary evidence document and the foundation of the gardener's verifiable work history.

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
> Attester: Gardener wallet. The report is the gardener's signed testimony, validated (or not) by OpenGarden in the next step.
> Revocable: No. A submitted report is a permanent record.
> RefUID: ScheduledIntervention UID (interventionUID field).

### 3.5 AdminValidation

OpenGarden's quality assessment of the completed work. This is the gate between operational data and on-chain publication. Only interventions that pass validation become PublishedInterventions.

> **OFF-CHAIN** · Revocable: Yes · **Timestamped on-chain: Required**

| Field | Type | Description |
|---|---|---|
| **reportUID** | `bytes32` | Off-chain UID of the GardenerReport being validated |
| **approved** | `bool` | Whether the work meets quality standards |
| **qualityScore** | `uint8` | Quality assessment (1–10 scale) |
| **feedback** | `string` | Written feedback to gardener (visible to gardener, not published on-chain) |
| **validatorId** | `bytes32` | Hashed identifier of the staff member who performed validation |

> **Attestation Metadata**
>
> Recipient: Gardener wallet.
> Attester: OpenGarden wallet.
> Revocable: Yes. If validation is issued in error, it can be revoked and reissued. This is the only quality gate in the system and must allow correction.
> RefUID: GardenerReport UID (reportUID field).

### 3.6 CitizenFeedback

Optional community-level signal. Citizens can confirm visible improvement in their area. This is a weak signal compared to professional OpenGarden validation, but valuable for civic engagement metrics and institutional reporting.

> **OFF-CHAIN** · Revocable: No · Timestamped on-chain: No (not part of the intervention lifecycle)

| Field | Type | Description |
|---|---|---|
| **areaUID** | `bytes32` | EAS UID of the AreaRegistration (citizen rates the area, not a specific intervention) |
| **rating** | `uint8` | Citizen satisfaction (1–5 scale, simple enough for casual engagement) |
| **comment** | `string` | Optional free-text comment |
| **photoHash** | `bytes32` | Optional IPFS CID of citizen-submitted photo (ZERO_BYTES32 if none) |

> **Attestation Metadata**
>
> Recipient: ZERO_ADDRESS (rates the area, not a specific intervention).
> Attester: Citizen wallet (any wallet — open participation).
> Revocable: No.
> RefUID: AreaRegistration UID (areaUID field).

> **Trust Level**
>
> Unweighted in the formal validation flow. Exists primarily as an engagement metric and a secondary data point for institutional reporting ("87% of citizens in maintained areas report improvement").

### 3.7 Healthcheck

A periodic condition assessment of an area, performed independently of any specific intervention. Used for trend monitoring and baseline measurement. The healthBefore and healthAfter scores in PublishedIntervention are drawn from Healthcheck attestations.

> **OFF-CHAIN** · Revocable: No · **Timestamped on-chain: Required**


| Field | Type | Description |
|---|---|---|
| **areaUID** | `bytes32` | EAS UID of the AreaRegistration being assessed |
| **healthScore** | `uint8` | Condition score (1–10 scale) |
| **photoHash** | `bytes32` | IPFS CID of condition documentation photos |
| **assessorNotes** | `string` | Professional assessment notes |
| **interventionNeeded** | `bool` | Whether the assessor recommends scheduling an intervention |

> **Attestation Metadata**
>
> Recipient: ZERO_ADDRESS.
> Attester: OpenGarden wallet.
> Revocable: No. A health assessment is a factual measurement record.
> RefUID: AreaRegistration UID (areaUID field).

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

Every off-chain attestation in the intervention lifecycle MUST be timestamped on-chain immediately after creation. The on-chain timestamps MUST satisfy:

```
T_schedule < T_checkin < T_checkout < T_report < T_validation < T_publication
```

The claimed `executionDate` in PublishedIntervention MUST fall within the bracket:

```
T_schedule ≤ executionDate ≤ T_publication
```

For linked Healthcheck attestations: `T_healthcheckBefore < T_checkin` and `T_healthcheckAfter > T_checkout`.

A PublishedIntervention whose `executionDate` predates `T_schedule` is provably backfilled.

### 4.3 Timestamping Protocol

Each off-chain attestation is timestamped individually via `EAS.timestamp(uid)`. Steps that are logically simultaneous (e.g., checkout and report) MAY be batched via `multiTimestamp()`. Steps that must demonstrate elapsed time (e.g., checkin and checkout) MUST NOT be batched.

Total cost per intervention lifecycle: **~$0.0005** (5 timestamps). At 1,000 interventions/month, this is ~$0.50/month.

### 4.4 MVP Minimum

At minimum, **timestamp the ScheduledIntervention on-chain**. Combined with the inherent block timestamp of the on-chain PublishedIntervention, this brackets the intervention: `T_schedule < work < T_publication`. This alone defeats the bulk-backfill attack. The intermediate timestamps (checkin through validation) SHOULD be implemented from launch given the negligible cost.

---

## 5. Evidence Bundle Structure

The evidenceBundleHash field in PublishedIntervention points to a JSON document on IPFS that links all off-chain attestations for a given intervention. This is the bridge between the off-chain operational layer and the on-chain settlement layer.

**evidence-bundle.json**

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
    "checkin": {
      "uid": "0x456...012",
      "contentHash": "0xcba...654",
      "claimedTimestamp": 1709337600,
      "onchainTimestamp": 1709337618
    },
    "checkout": {
      "uid": "0x789...345",
      "contentHash": "0xabc...678",
      "claimedTimestamp": 1709344800,
      "onchainTimestamp": 1709344812
    },
    "report": {
      "uid": "0xdef...901",
      "contentHash": "0x456...789",
      "claimedTimestamp": 1709345100,
      "onchainTimestamp": 1709345120
    },
    "validation": {
      "uid": "0x234...567",
      "contentHash": "0x987...123",
      "approved": true,
      "qualityScore": 8,
      "claimedTimestamp": 1709424000,
      "onchainTimestamp": 1709424025
    },
    "healthcheckBefore": {
      "uid": "0x567...890",
      "score": 3,
      "onchainTimestamp": 1709200000
    },
    "healthcheckAfter": {
      "uid": "0x890...123",
      "score": 8,
      "onchainTimestamp": 1709500000
    }
  },
  "photos": {
    "checkinPhoto": "ipfs://Qm.../arrival.jpg",
    "reportPhotos": "ipfs://Qm.../work-evidence/",
    "afterPhotos": "ipfs://Qm.../completion/"
  },
  "bundleVersion": "1.0"
}
```

> **Bundle Fields**
>
> - `claimedTimestamp`: The self-reported timestamp from the off-chain attestation data (device time, application time). This is what the attester claims.
> - `onchainTimestamp`: The block timestamp from `EAS.timestamp()`. This is the authoritative, independently verifiable time anchor.
>
> The `onchainTimestamp` fields are technically redundant — they can be verified by reading the EAS contract's timestamp mapping directly. Including them in the bundle enables offline verification without a chain query, with the expectation that auditors performing due diligence will spot-check against the chain.

> **Verification Flow**
>
> Anyone with the PublishedIntervention UID can:
> (1) Read the evidenceBundleHash from the on-chain attestation.
> (2) Fetch the JSON from IPFS.
> (3) Verify each off-chain attestation signature independently.
> (4) Confirm the bundle is complete by checking offchainCount matches the number of attestations in the bundle.
> (5) **Verify temporal integrity:** For each attestation in the bundle, query `EAS.getTimestamp(uid)` on-chain and confirm the on-chain timestamps match the bundle's `onchainTimestamp` values and satisfy the ordering rules in Section 4.2.
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
| AdminValidation | → | GardenerReport | reportUID field |
| CitizenFeedback | → | AreaRegistration | areaUID field |
| Healthcheck | → | AreaRegistration | areaUID field |
| GardenerMilestone | → | (standalone) | evidenceRoot field |

> **Graph Traversal**
>
> Starting from any PublishedIntervention, an auditor can traverse the full evidence chain:
> On-chain attestation → evidence bundle on IPFS → individual off-chain attestations → photos and documents → on-chain timestamps for each step.
>
> Starting from any AreaRegistration, a dashboard can aggregate all interventions, healthchecks, and citizen feedback for that location.

---

## 7. Trust Model

All schemas are registered without a resolver contract. Trust is established at the **read layer** — by verifying attester address and on-chain timestamps — not at the write layer. Schema = vocabulary. Attester = authority. Timestamp = when.

### 7.1 Attester-Based Trust

| Attester | Trust level | Schemas |
|---|---|---|
| **OpenGarden wallet** | Authoritative | AreaRegistration, PublishedIntervention, GardenerMilestone, ScheduledIntervention, AdminValidation, Healthcheck |
| **Registered gardener wallet** | Verified participant | GardenerCheckin, GardenerCheckout, GardenerReport |
| **Any wallet** | Untrusted / community signal | CitizenFeedback |

OpenGarden publishes its attester address on its website and in the schema metadata on IPFS. On-chain attestations from unknown wallets are ignored by any consumer that filters by attester. Off-chain attestations use EIP-712 signatures verified against the known attester address (OpenGarden wallet, gardener registry, or open for citizens).

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
bytes32 areaUID, string interventionId, address gardener, uint8 interventionType, uint64 executionDate, uint8 healthBefore, uint8 healthAfter, bytes32 commissionRef, bytes32 evidenceBundleHash, uint8 offchainCount, uint8 crewSize, bool isLead
```

**GardenerMilestone** (revocable: false)
```
uint8 milestoneLevel, uint16 totalInterventions, uint16 totalValidated, uint8 avgHealthImprovement, string skillTier, uint64 achievedAt, bytes32 evidenceRoot
```

**ScheduledIntervention** (revocable: true)
```
bytes32 areaUID, string interventionId, uint8 interventionType, address assignedGardener, uint64 scheduledDate, uint16 estimatedMinutes, string description, bytes32 commissionRef, uint8 crewSize
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
bytes32 reportUID, bool approved, uint8 qualityScore, string feedback, bytes32 validatorId
```

**CitizenFeedback** (revocable: false)
```
bytes32 areaUID, uint8 rating, string comment, bytes32 photoHash
```

**Healthcheck** (revocable: false)
```
bytes32 areaUID, uint8 healthScore, bytes32 photoHash, string assessorNotes, bool interventionNeeded
```
