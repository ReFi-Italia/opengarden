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
| **Intervention** | On-chain | Organization | Verified completion record |
| **GardenerMilestone** | On-chain (SBT) | Organization | Portable credential |
| **Activity** | Off-chain + timestamped | Organization / Gardener\* / Any wallet | Polymorphic lifecycle record — one of `schedule`, `checkin`, `checkout`, `report`, `healthcheck` |

_\*Gardener-signed activities (checkin, checkout, report) are deferred until the release of the Gardeners' app; organizations sign them in the interim._

> **Design Principle**
>
> Every on-chain attestation is a finalized record. Off-chain attestations accumulate during the work lifecycle and are referenced by content hash in the on-chain publication. This follows a commit–settle pattern: operate off-chain, settle on-chain. Publishing an intervention on-chain is the organization's quality sign-off — the same wallet signs the work done and signs off on its quality in a single act. Internal QA fields (approved flag, quality score, reviewer feedback) live in the organization's database, outside the verifiable envelope.

> **Self-Attestation Protocol**
>
> OpenGarden is a **self-attestation protocol**, not a cryptographic proof-of-truth system. The protocol's cryptographic guarantees bind three things together: **who** signed (EIP-712 signature), **what** they signed (signed bytes), and **when** it was recorded on chain (EAS `timestamp` + block timestamp). The protocol makes NO claim about whether attested facts are true, sufficient, or well-formed by any given consumer's standards. Those are **verifier-side decisions** applied at the read layer — see [Section 7: Trust Model](#7-trust-model).
>
> The protocol's job is to expose enough granular, signed, timestamped data that verifiers can implement any trust policy they need on top. Two consumers reading the same on-chain data may reach different conclusions about the same intervention, and both readings can be valid under the protocol.

> **Temporal Integrity Principle**
>
> Off-chain attestations are cryptographically signed (EIP-712) but their timestamps are self-reported. To prevent backfilling — fabricating interventions after the fact — every off-chain attestation in the intervention lifecycle is timestamped on-chain via EAS's native `timestamp()` function. This creates an immutable, independently verifiable temporal ordering that proves each step happened when claimed.

> **Storage-Agnostic Commitments**
>
> The protocol commits to **bytes**, not storage locations. Every off-chain payload that the chain commits to — evidence bundle JSON, boundary blobs, media files, media manifests — is referenced by a `keccak256` of its canonical byte sequence, never by a storage-layer identifier (IPFS CID, S3 key, URL).
>
> Where those bytes actually live is the publisher's concern. The publisher MAY use IPFS, S3, their own database, or any combination — and MAY change their storage choice over time without breaking any on-chain commitment. Verifiers fetch bytes from a publisher-exposed endpoint (URL, IPFS gateway, API) and recompute the `keccak256` to verify integrity.
>
> This keeps the protocol's cryptographic surface minimal (one hash primitive), decouples on-chain records from any particular storage network, and reflects the self-attestation principle: a publisher who takes their bytes offline simply loses verifiability, which verifier policy already handles via attester-trust weighting (Section 7).

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
| **boundariesHash** | `bytes32` | keccak256 of the canonical boundary blob (polygon GeoJSON plus any inline attributes the publisher chooses to cover) held in the organization's app database. The blob stays off-chain; the chain commits to the hash only. Verifiers fetch the blob from the app's exposed endpoint and recompute the hash to audit. `ZERO_BYTES32` if the organization has no boundary data for this area |
| **metadata** | `string` | Small inline JSON escape hatch for app-specific extras (surface area m², access hours, institutional labels). SHOULD remain under the 512-byte budget defined in [§9.6](#96-inline-metadata-vs-hashed-payloads). Empty string if none |

> **Attestation Metadata**
>
> Recipient: ZERO_ADDRESS (no specific recipient — this is a public record).
> Attester: Organization wallet.
> Revocable: No. An area registration is a permanent geographic fact.
> RefUID: ZERO_BYTES32 (root attestation, no parent reference).

> **Gas Optimization**
>
> Coordinates use int32 microdegrees instead of string to reduce calldata. The boundary blob (polygon GeoJSON and similar structured data) is held in the organization's app database and committed on-chain via `boundariesHash` — the chain stores only the keccak256 of the blob. Small structured extras ride inline via `metadata` so readers don't need an extra fetch for a handful of bytes. The split follows the convention formalized in [§9.6](#96-inline-metadata-vs-hashed-payloads).

### 2.2 Intervention

Created when an intervention is fully executed and the organization signs off on it. This is the canonical **job record** — one per intervention, regardless of crew size. It bundles all off-chain lifecycle activities (schedule, per-gardener checkins, checkouts, and reports) by referencing their content hashes via the evidence bundle.

> **ON-CHAIN** · Revocable: No

| Field | Type | Description |
|---|---|---|
| **interventionId** | `string` | Internal intervention identifier (e.g. "INT-2026-0187"). Also the input to the intervention scope hash (§9.7) that anchors every lifecycle activity |
| **interventionType** | `uint8` | 0 = unspecified, 1 = routine maintenance, 2 = restoration, 3 = emergency, 4 = seasonal, 5 = new planting |
| **executionDate** | `uint64` | Unix timestamp of when work was completed |
| **evidenceBundleHash** | `bytes32` | keccak256 of the canonical evidence bundle bytes (§5). The bundle collects every lifecycle Activity's UID, signed envelope, and on-chain timestamp. Storage is publisher-owned — verifiers fetch the bundle bytes from a publisher-exposed endpoint and recompute the hash to audit |
| **commissionRef** | `bytes32` | Keccak256 hash of commissioning entity identifier (corporate sponsor ID, municipal contract number, or grant ID). `ZERO_BYTES32` for volunteer / unsponsored work |

> **Attestation Metadata**
>
> Recipient: ZERO_ADDRESS. An Intervention is a public job record, not a credential addressed to any individual. Per-gardener credentialing flows through GardenerMilestone SBTs (Section 2.3) whose evidence is the set of report Activities bundled inside the Intervention's evidence bundle.
> Attester: Organization wallet. The attester is simultaneously the reviewer — publication is the quality sign-off.
> Revocable: No. A published intervention is a historical fact.
> RefUID: AreaRegistration UID. Area linkage is carried by the EAS-native `refUID` slot — indexers filter by area natively and the schema data stays minimal.

> **The commissionRef Field**
>
> This is the single most important field for the protocol's top two audiences (corporates and municipalities). It links every verified intervention to its funding source without exposing the funder's identity on-chain. The hash can be resolved off-chain by authorized parties. This enables per-sponsor impact reporting: "Sponsor X funded 23 interventions with average health improvement of 4.2 points."

> **Internal QA fields**
>
> The organization's internal quality assessment (approved flag, quality score, reviewer feedback, reviewer identity) lives in the organization's database, not in the attestation. The act of publishing an intervention on-chain attests approval. Rejected or unapproved work never reaches the chain.

> **Crew Interventions**
>
> A crew job produces a single Intervention. Each crew member independently signs their own checkin, checkout, and report Activities — these are cryptographically tied to the crew member's wallet via EAS off-chain signatures. Every lifecycle Activity (schedule plus all crew-member activities) carries the same `refUID = keccak256(interventionId)` (see §9.7), so a single EAS GraphQL query returns the full activity set. Crew headcount is carried on the schedule Activity's payload.
>
> **To prove an individual gardener contributed to a specific intervention**, a verifier reads the Intervention, fetches the evidence bundle, and checks for a `report` Activity whose signer is that gardener's wallet. The gardener's aggregated credential (career history, level) is the GardenerMilestone SBT, which is directly addressed to their wallet.

### 2.3 GardenerMilestone (Soulbound)

A non-transferable credential minted when a gardener crosses a meaningful threshold. This is the gardener's portable proof of skill and reliability. Designed to be legible to future employers, housing authorities, and social services.

> **ON-CHAIN** · Revocable: No


| Field | Type | Description |
|---|---|---|
| **milestoneLevel** | `uint8` | Progressive level keyed off `totalValidated`: 1 = Apprentice (5 validated), 2 = Gardener (15), 3 = Senior (40), 4 = Master (100) |
| **totalInterventions** | `uint16` | Cumulative count of `report` Activities signed by this gardener, sourced from the organization's operational store. Covers every completed crew-member chain the gardener participated in |
| **totalValidated** | `uint16` | Subset of `totalInterventions` whose parent job reached an Intervention on-chain. Computed by counting the gardener's `report` Activities that appear inside any Intervention's evidence bundle. The gap `totalInterventions - totalValidated` represents work that stayed off-chain |
| **avgHealthImprovement** | `uint8` | Average area-health improvement attributable to the gardener's validated interventions, derived off-chain from the area's `healthcheck` Activity timeline (pre/post delta around each intervention's executionDate). `0` if no measurable signal |
| **achievedAt** | `uint64` | Unix timestamp when milestone was reached |
| **evidenceRoot** | `bytes32` | Merkle root of the Intervention UIDs the gardener contributed to (one leaf per intervention — matches `totalValidated`, not `totalInterventions`). The organization computes this at mint time by scanning its evidence bundles for `report` Activities signed by the recipient wallet. `ZERO_BYTES32` when no bundle evidence is recorded on-chain |

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

## 3. Off-Chain Schema

All operational lifecycle data shares a single polymorphic schema: **Activity**. Activities are signed off-chain with EAS EIP-712 typed signatures, then **timestamped on-chain** via `EAS.timestamp()` immediately after creation. They are never published individually on-chain. Instead, their signed envelopes are collected into the evidence bundle referenced by the Intervention's `evidenceBundleHash`.

See [Section 4: Temporal Integrity](#4-temporal-integrity) for ordering rules that apply to every lifecycle Activity.

### 3.1 Activity

An Activity is a typed, signed, timestamped statement that **something happened** — planning a job, arriving on site, leaving, reporting work, or rating area condition. One schema covers every lifecycle event; the `activityType` field and an opaque payload JSON carry the per-type semantics.

> **OFF-CHAIN** · Revocable: Yes · **Timestamped on-chain: Required**

| Field | Type | Description |
|---|---|---|
| **activityType** | `uint8` | Activity discriminator. See [§3.1.1](#311-activitytype-reservation) for the reservation table |
| **payloadHash** | `bytes32` | Keccak256 of the canonical JSON payload (§9.8). The payload itself travels alongside the signed envelope in the evidence bundle — `payloadHash` is the only cryptographic anchor for the payload's content |

#### 3.1.1 activityType reservation

The `activityType` byte is partitioned into three ranges so third-party extensions can add new types without colliding with the protocol's core vocabulary:

| Range | Meaning | Verifier behavior on unknown values |
|---|---|---|
| `0` | Unspecified / reserved | MUST reject — not a valid signed activity |
| `1–5` | Core protocol types (`schedule`, `checkin`, `checkout`, `report`, `healthcheck`) | MUST understand all five |
| `6–127` | Reserved for future protocol versions | MUST reject until this document allocates the value |
| `128–255` | Application-specific types | MUST ignore (not reject) — unknown application types do not invalidate a bundle, but readers also do not count them as protocol-recognized activities |

The current core assignments are:

| Value | Name |
|---|---|
| `1` | `schedule` |
| `2` | `checkin` |
| `3` | `checkout` |
| `4` | `report` |
| `5` | `healthcheck` |

Applications that need additional activity types (pre-inspection, material delivery, safety audit, etc.) SHOULD allocate a value in the `128–255` range and document it in their own application layer. The protocol does not maintain a central registry — signer identity is the disambiguator when two applications coincidentally use the same application-range value.

> **Why a single schema**
>
> Activities carry the same three protocol guarantees regardless of type — who signed, what they signed, when they were anchored. Collapsing the five lifecycle events into one schema means new Activity types can be introduced (pre-inspection, material delivery, safety audit, …) by adding a payload shape in the SDK layer and reserving a new `activityType` value. No on-chain schema redeploy is required.

> **Payload envelope, not payload field**
>
> The opaque `payloadHash` keeps the on-chain-timestamped signed bytes compact (33 bytes) while preserving full cryptographic integrity over the payload's content. Readers fetch the payload from the evidence bundle (or the organization's attestation store for in-flight activities) and confirm `keccak256(canonicalJSON(payload)) === payloadHash` — see [§5.4](#54-verification-flow) protocol-level check (5). Divergent canonicalization breaks this check, so the hashing rule is normative (§9.8).

> **Attestation Metadata (per type)**
>
> | type | Attester | Recipient | RefUID | Revoked in practice |
> |---|---|---|---|---|
> | `schedule` | Organization wallet | Crew lead wallet (or `ZERO_ADDRESS` if unassigned) | `keccak256(interventionId)` — see §9.7 | Yes — cancel/reschedule flow |
> | `checkin` | Gardener wallet | ZERO_ADDRESS | `keccak256(interventionId)` | No |
> | `checkout` | Gardener wallet | ZERO_ADDRESS | `keccak256(interventionId)` | No |
> | `report` | Gardener wallet | ZERO_ADDRESS | `keccak256(interventionId)` | No |
> | `healthcheck` | Any wallet (org / gardener / citizen) | ZERO_ADDRESS | AreaRegistration UID | No |
>
> The Activity schema itself is registered `revocable: true` because `schedule` Activities need revocation for the cancel/reschedule flow. `checkin`, `checkout`, `report`, and `healthcheck` are never revoked in practice — a verifier policy MAY reject bundles containing revoked entries of those types.

> **Intervention scope hash**
>
> Every lifecycle Activity (schedule, checkin, checkout, report) carries `refUID = keccak256(interventionId)`. The `keccak256` over the interventionId string — not over a prior attestation's UID — is computable from the human-readable interventionId alone, so crew devices don't need the schedule Activity's UID to sign their own checkins. Defined in [§9.7](#97-intervention-scope-hash). A single EAS GraphQL query on that refUID returns every lifecycle Activity for the intervention.
>
> `healthcheck` Activities are intervention-independent and use the AreaRegistration UID directly as their refUID.

### 3.2 Activity Payloads

Each Activity type defines its own payload shape. Payloads are application-layer JSON — the protocol does not interpret them beyond the `payloadHash` integrity check. The SDK provides typed encoders/decoders per type so callers don't hand-assemble payloads.

Unknown keys in a payload MUST be ignored by verifiers (extensibility). Reserved keys (those the protocol defines below) MUST carry the specified shape.

#### 3.2.1 `schedule` payload

Emitted when the organization plans a new intervention. One per job, regardless of crew size. The schedule Activity's on-chain timestamp is the earliest temporal anchor for the intervention lifecycle.

```json
{
  "interventionId": "INT-2026-0187",
  "areaUID": "0xabc…def",
  "interventionType": 1,
  "scheduledDate": 1709251200,
  "plannedDuration": 180,
  "tasksPlanned": ["PRUNE", "CLEAN", "WATER", "PLANT"],
  "description": "Trim hedges, mulch beds, clear leaves on north side.",
  "commissionRef": "0x0000…0000",
  "crewSize": 2
}
```

| Key | Type | Description |
|---|---|---|
| `interventionId` | string | Internal ID — MUST match the `interventionId` on the eventual Intervention attestation. Also the input to the refUID hash (§9.7) |
| `areaUID` | string (bytes32 hex) | AreaRegistration UID — carries the area linkage at the payload layer since the refUID slot holds the intervention scope hash |
| `interventionType` | number (uint8) | Same enum as Intervention (0–5) |
| `scheduledDate` | number (Unix seconds) | Planned execution date |
| `plannedDuration` | number (uint16 minutes) | Wall-clock duration of the intervention including planned breaks (crew-level, not per-gardener). `0` = unspecified |
| `tasksPlanned` | string[] | Planned task codes (e.g. `"PRUNE"`, `"CLEAN"`, `"WATER"`, `"PLANT"`). Intervention-level — the crew as a whole is expected to cover this set. Verifier policy compares this against the union of `report.tasksCompleted` across crew. Empty array if none |
| `description` | string | Free-text supplement to `tasksPlanned` |
| `commissionRef` | string (bytes32 hex) | Hash of commissioning entity (`hashIdentifier` from §9.1). `ZERO_BYTES32` = volunteer / unsponsored |
| `crewSize` | number (uint8) | Total gardeners assigned. `1` for solo jobs |

#### 3.2.2 `checkin` payload

Signed by the gardener (or their device) when arriving at the work site. Pure presence anchor — the cryptographic content is the signed envelope itself (who + when + refUID), optionally refined by GPS coordinates. **One per crew member per intervention.**

```json
{
  "latitude": 41890200,
  "longitude": 12492200
}
```

| Key | Type | Description |
|---|---|---|
| `latitude` | number (int32 microdegrees) | GPS latitude at check-in. Optional — omit when the publisher considers area-boundary membership sufficient (small gardens) |
| `longitude` | number (int32 microdegrees) | GPS longitude at check-in. Optional — same rule as `latitude`. Both MUST be omitted together or both present |

> **Time**: carried by the EIP-712 envelope's `message.time` field, anchored on-chain via `EAS.timestamp(uid)`. No separate payload field restates it. Callers signing at the moment of check-in may let the signing library default `message.time` to wall-clock; callers signing server-side on later upload MUST pass the device-recorded moment as the envelope `time`.
>
> **No photo field**: presence is proven by the signed envelope (signer + timestamp + refUID) plus optional GPS. Visual evidence of work belongs on `report` (after-work bundle) and `healthcheck` (condition at a point in time) — those are the evidence layers. Checkin is a time anchor, not an evidence document.
>
> **Verification**: when GPS is present, proximity to the registered area coordinates (or containment within `boundariesHash`-committed polygon) can be verified programmatically as verifier policy.

#### 3.2.3 `checkout` payload

Signed by the gardener when finishing work. Closes the work session — pure time anchor, symmetric with `checkin`. **One per crew member per intervention.** Paired to the same crew member's `checkin` via shared `refUID` (intervention scope hash) plus matching signer.

```json
{
  "latitude": 41890200,
  "longitude": 12492200
}
```

| Key | Type | Description |
|---|---|---|
| `latitude` | number (int32 microdegrees) | GPS latitude at check-out. Optional — same rules as `checkin` |
| `longitude` | number (int32 microdegrees) | GPS longitude at check-out. Optional — both MUST be omitted together or both present |

> **Time**: same rules as `checkin` — EIP-712 envelope `time`, anchored on-chain.
>
> **Wall-clock duration**: derivable as `T_onchain[checkout] - T_onchain[checkin]` for the same signer (or more precisely as `message.time[checkout] - message.time[checkin]` when signing-time may lag event-time). No self-reported duration field on `checkout` — active-work effort (excluding breaks) is reported on `report.reportedEffort`.
>
> **Pairing**: a verifier pairs this checkout to the same signer's checkin within the same interventionId scope. No explicit `checkinUID` field — the (signer, intervention scope, type) triple is the pairing key.

#### 3.2.4 `report` payload

The gardener's signed account of the work performed. Primary evidence document and foundation of the gardener's verifiable work history. **One per crew member per intervention.** For crew jobs, each crew member writes their own report — the set of reports is the cryptographic roster of who actually worked.

```json
{
  "tasksCompleted": ["PRUNE", "CLEAN", "WATER"],
  "reportedEffort": 120,
  "mediaHash": "0x3c5a…",
  "notes": "Bed 3 has drainage issue, flagged for follow-up."
}
```

| Key | Type | Description |
|---|---|---|
| `tasksCompleted` | string[] | Per-gardener completed task codes — a subset (or all) of `schedule.tasksPlanned`. Each crew member reports what they personally worked on. Empty array if none |
| `reportedEffort` | number (uint16 minutes) | Per-gardener active work time, excluding breaks. Self-reported. Distinct from wall-clock duration derivable from `checkin`/`checkout` timestamps — captures effort for impact metrics (person-minutes delivered). `0` if unreported |
| `mediaHash` | string (bytes32 hex) | keccak256 of the after-work evidence bytes — a single file's raw bytes, or the canonical media manifest JSON bytes (§9.2). `ZERO_BYTES32` if none |
| `notes` | string | Free-text field for observations, issues, materials used. Empty string if none |

> **Plan/execute coverage**: a verifier may check `union(report[*].tasksCompleted)` against `schedule.tasksPlanned` — loose coverage (subset), strict coverage (equal), or coverage + extras allowed are all verifier policy.
>
> **Impact aggregation**: `sum(report[*].reportedEffort)` is the person-minutes delivered for this intervention. Aggregate across interventions for sponsor impact reports.
>
> **Effort sanity**: `report.reportedEffort` MUST NOT exceed the wall-clock bracket `T_onchain[report] - T_onchain[checkin]` for the same signer. A verifier may enforce this check strictly or leniently.
>
> **Pairing**: a verifier pairs this report to the same signer's checkout within the same interventionId scope. No explicit `checkoutUID` field.

#### 3.2.5 `healthcheck` payload

A periodic condition assessment of an area. Independent of any specific intervention — raw signal about the area's state at a point in time. Healthchecks accumulate into an area-scoped timeline that consumers aggregate to compute trend, derive pre/post-intervention deltas, or flag areas needing attention.

```json
{
  "healthScore": 8,
  "mediaHash": "0x8f1a…",
  "notes": "Hedge trimmed, beds mulched.",
  "metadata": { "v": 1, "weather": "sunny" }
}
```

| Key | Type | Description |
|---|---|---|
| `healthScore` | number (uint8) | Condition score (1–10 scale, 10 is best) |
| `mediaHash` | string (bytes32 hex) | keccak256 of the condition-documentation bytes — a single file or canonical media manifest (§9.2). `ZERO_BYTES32` if none |
| `notes` | string | Free-text observations. Empty string if none |
| `metadata` | object | App-specific extras (weather, assessor annotations, seasonal context). Omitted or `null` for none. SHOULD carry a `v` key for shape versioning; unknown shapes MUST be ignored |

> **Area-scoped, intervention-independent**: healthcheck Activities use AreaRegistration UID as their refUID. An area's timeline contains both healthcheck Activities and Interventions — readers merge them by on-chain timestamp to reconstruct condition changes around each intervention.
>
> **Attester**: any wallet — organization, gardener, or citizen. Role is inferred **off-chain** from the signer wallet: match against the AreaRegistration attester (organization) or the app-maintained gardener roster, otherwise treat as citizen signal.
>
> **Trust & aggregation**: a single healthcheck is raw signal. Aggregation, weighting by issuer role, and thresholding ("does this area need an intervention?") are **verifier policy** decisions — see [§7.4](#74-example-policy--healthcheck-weighting).

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

Every lifecycle Activity MUST be timestamped on-chain immediately after creation. For a crew of size N, each crew member `i ∈ {1..N}` independently produces `(checkin_i, checkout_i, report_i)`. The on-chain timestamps MUST satisfy:

```
T_schedule < min(T_checkin[*])
for each i:  T_checkin[i] < T_checkout[i] < T_report[i]
max(T_report[*]) < T_publication
```

Put plainly: scheduling precedes every crew member's arrival, each crew member checks out after checking in and reports after checking out, and publication happens after every crew member's report is recorded. There is no ordering constraint *between* crew members — Alice can finish her shift before Bob even arrives.

The claimed `executionDate` in Intervention MUST fall within the bracket:

```
T_schedule ≤ executionDate ≤ T_publication
```

`healthcheck` Activities are an independent periodic stream outside the intervention lifecycle. Their on-chain timestamps are the authoritative time anchor for aggregation; no bracket rule ties them to schedule/checkin/checkout/report timestamps.

An Intervention whose `executionDate` predates `T_schedule` is provably backfilled.

### 4.3 Timestamping Protocol

Each Activity is timestamped individually via `EAS.timestamp(uid)`. Steps that are logically simultaneous (e.g., a single gardener's checkout and report) MAY be batched via `multiTimestamp()`. Steps that must demonstrate elapsed time (e.g., checkin and checkout for the same gardener) MUST NOT be batched. All N crew members' checkins across a single crew job MAY be batched together if they genuinely arrive at the same moment, since the relative ordering between crew members is unconstrained.

Total cost per intervention lifecycle: `1 + 3N` timestamps (schedule + per-crew-member checkin/checkout/report). A solo job is `4` timestamps at **~$0.0004**. A 4-person crew is `13` timestamps at **~$0.0013**. At 1,000 interventions/month with an average crew of 2, this is well under $1/month. `healthcheck` Activities are timestamped independently outside the intervention lifecycle.

### 4.4 MVP Minimum

At minimum, **timestamp the schedule Activity on-chain**. Combined with the inherent block timestamp of the on-chain Intervention, this brackets the intervention: `T_schedule < work < T_publication`. This alone defeats the bulk-backfill attack. The intermediate timestamps (per-crew-member checkin/checkout/report) SHOULD be implemented from launch given the negligible cost.

---

## 5. Evidence Bundle Structure

The `evidenceBundleHash` field on Intervention is the keccak256 of a canonical JSON document that collects every lifecycle Activity for the intervention. The document bytes themselves are held by the publisher and fetched from a publisher-exposed endpoint (see the [Storage-Agnostic Commitments](#1-architecture-overview) principle). This is the bridge between the off-chain operational layer and the on-chain settlement layer.

The bundle is a **flat array of Activities** sorted by `onchainTimestamp`. Solo and crew jobs use the same shape — verifiers filter by `type` and group by signer to reconstruct per-gardener chains.

### 5.1 Self-Verifying Bundles

Each bundle entry embeds the **full EIP-712 signed attestation** (`uid`, `message`, `signature`, `signer`) verbatim, plus the plaintext payload that hashes to the `payloadHash` committed in the signed data. A reader holding the bundle file can therefore:

- Recover the signer from every signature locally (no network).
- Confirm every payload's content against its signed `payloadHash` locally.
- Verify each entry's stated `onchainTimestamp` against the chain with a single `EAS.getTimestamp(uid)` call per entry.

The bundle is the verifiable unit. No separate fetch from an off-chain attestation store (e.g. easscan) is required for signature, payload, or parent-linkage checks.

### 5.2 Bundle JSON

**evidence-bundle.json** (crew of 2 shown, some fields truncated with `…`)

```json
{
  "interventionId": "INT-2026-0187",
  "areaUID": "0xabc…def",
  "activities": [
    {
      "type": "schedule",
      "uid": "0x123…789",
      "signer": "0xOrg…",
      "claimedTimestamp": 1709251200,
      "onchainTimestamp": 1709251215,
      "payload": {
        "interventionId": "INT-2026-0187",
        "areaUID": "0xabc…def",
        "interventionType": 1,
        "scheduledDate": 1709251200,
        "plannedDuration": 180,
        "tasksPlanned": ["PRUNE", "CLEAN", "WATER", "PLANT"],
        "description": "Trim hedges, mulch beds, clear leaves on north side.",
        "commissionRef": "0x0000…0000",
        "crewSize": 2
      },
      "signedAttestation": {
        "version": 1,
        "uid": "0x123…789",
        "signer": "0xOrg…",
        "message": {
          "schema": "0xActivitySchemaUID",
          "recipient": "0xCrewLead…",
          "time": "1709251200",
          "expirationTime": "0",
          "revocable": true,
          "refUID": "0xInterventionScopeHash…",
          "data": "0x…encoded(uint8,bytes32)…"
        },
        "signature": { "r": "0x…", "s": "0x…", "v": 27 }
      }
    },
    {
      "type": "checkin",
      "uid": "0x456…012",
      "signer": "0xAlice…",
      "claimedTimestamp": 1709337600,
      "onchainTimestamp": 1709337618,
      "payload": {
        "latitude": 41890200,
        "longitude": 12492200
      },
      "signedAttestation": { "…": "…" }
    },
    { "type": "checkin",  "uid": "0x457…013", "signer": "0xBob…",   "payload": { "…": "…" }, "signedAttestation": { "…": "…" }, "claimedTimestamp": 1709337650, "onchainTimestamp": 1709337670 },
    { "type": "checkout", "uid": "0x789…345", "signer": "0xAlice…", "payload": { "latitude": 41890180, "longitude": 12492210 }, "signedAttestation": { "…": "…" }, "claimedTimestamp": 1709344800, "onchainTimestamp": 1709344812 },
    { "type": "checkout", "uid": "0x790…346", "signer": "0xBob…",   "payload": { "latitude": 41890190, "longitude": 12492205 }, "signedAttestation": { "…": "…" }, "claimedTimestamp": 1709344900, "onchainTimestamp": 1709344920 },
    { "type": "report",   "uid": "0xdef…901", "signer": "0xAlice…", "payload": { "…": "…" }, "signedAttestation": { "…": "…" }, "claimedTimestamp": 1709345100, "onchainTimestamp": 1709345120 },
    { "type": "report",   "uid": "0xdf0…902", "signer": "0xBob…",   "payload": { "…": "…" }, "signedAttestation": { "…": "…" }, "claimedTimestamp": 1709345200, "onchainTimestamp": 1709345220 }
  ],
  "bundleVersion": "0.1.0"
}
```

> **Bundle Fields**
>
> - `type`: Activity discriminator — one of `schedule`, `checkin`, `checkout`, `report`. (`healthcheck` Activities are area-scoped and do NOT appear in intervention bundles.) MUST match the `activityType` decoded from `signedAttestation.message.data`.
> - `signer`: Address of the wallet that signed the Activity. MUST match the signer recovered from `signedAttestation.signature`; the signature check (§5.4 protocol-level step (4)) enforces this.
> - `claimedTimestamp`: Self-reported Unix seconds sourced from the EIP-712 envelope's `signedAttestation.message.time` — what the attester claims as the moment of the event. Device time or application time, set when signing.
> - `onchainTimestamp`: Block timestamp from `EAS.timestamp(uid)`. Authoritative, independently verifiable time anchor.
> - `payload`: Plaintext per-type payload object (§3.2). MUST hash via §9.8 canonicalization to the `payloadHash` decoded from `signedAttestation.message.data`.
> - `signedAttestation`: The full EIP-712 signed attestation, verbatim. Structure is the object EAS-compatible libraries return from their offchain signing primitive — `{version, uid, signer, message{schema, recipient, time, expirationTime, revocable, refUID, data, …}, signature{r, s, v}}`. A complete bundle MUST include the top-level `signer` inside this object so readers can cross-check without re-running signature recovery just to learn identity.
>
> Activities MUST be sorted ascending by `onchainTimestamp`. Ordering ties MAY exist (same-block timestamps) and do NOT violate the schema — they are handled by the verifier's temporal-strictness policy (§5.4).
>
> The `onchainTimestamp` fields are technically redundant — readers can rebuild them by querying `EAS.getTimestamp(uid)`. Including them in the bundle enables offline inspection and makes drift between bundle and chain trivially detectable.

> **Payload vs payloadHash**
>
> The protocol's cryptographic anchor for payload content is the `payloadHash` decoded from the signed ABI data — that value is signed, the payload object itself is not. A reader confirms integrity by canonicalizing the bundle's `payload` (§9.8) and comparing the resulting keccak256 to the decoded `payloadHash`. Implementations MUST use the §9.8 rules; divergent canonicalization produces hash mismatches and invalidates the bundle.

### 5.3 JSON Serialization — BigInt fields

The `signedAttestation.message.time`, `signedAttestation.message.expirationTime`, and (when present) `signedAttestation.message.nonce` fields are conceptually `uint256` and are serialized as **decimal-digit strings** (e.g. `"1709251200"`, not `1709251200`). Rationale:

- JSON has no native bigint.
- Emitting them as numbers loses precision once they exceed `Number.MAX_SAFE_INTEGER` (2⁵³ − 1).
- Stringification is reversible and unambiguous.

Verifiers re-running EIP-712 typed-data hashing MUST parse these back to integers before recomputing the digest; otherwise the recomputed hash will not match the signature.

Integer fields outside `signedAttestation.message` (`claimedTimestamp`, `onchainTimestamp`, payload-level numbers like `plannedDuration`, `reportedEffort`, `healthScore`, `crewSize`) are serialized as JSON numbers because they always fit in a 53-bit mantissa for any plausible Unix timestamp or Activity payload value.

> **Bundle Version**
>
> The bundle format is versioned with semver. The current version is `0.1.0`. Consumers MUST reject bundles whose `bundleVersion` they don't understand. Pre-1.0 versions are unstable — breaking changes may land in a 0.x.y bump.

### 5.4 Verification Flow

Verification splits into two tiers. The first tier is **protocol-level** — the guarantees the protocol itself makes, which every consumer relies on. The second tier is **policy-level** — checks a specific verifier may choose to apply depending on their trust requirements (see [Section 7: Trust Model](#7-trust-model) for the philosophy).

**Protocol-level (non-negotiable — skip any of these and you no longer have a valid OpenGarden attestation):**

(1) Read the `evidenceBundleHash` from the on-chain Intervention attestation.
(2) Fetch the bundle bytes from the publisher's exposed endpoint and confirm `keccak256(bundleBytes)` equals the on-chain `evidenceBundleHash`.
(3) Verify the `bundleVersion` is understood (reject unknown versions).
(4) For each bundle entry: recover the EIP-712 signer from `signedAttestation.signature` and `signedAttestation.message`; confirm it matches both `signedAttestation.signer` and the top-level `signer`. This is a **local** operation — the bundle carries the full signed payload, so no network query is required. Remember to parse string-encoded bigint fields (§5.3) back to integers before recomputing the typed-data digest.
(5) For each bundle entry: canonicalize `payload` per §9.8 and confirm `keccak256(canonicalJSON(payload))` matches the `payloadHash` decoded from `signedAttestation.message.data`. Also confirm the decoded `activityType` matches the bundle entry's `type`.
(6) For each bundle entry: query `EAS.getTimestamp(uid)` on chain and confirm it matches the `onchainTimestamp` recorded in the bundle.

**Policy-level (verifier's call — pick the subset that matches your trust model):**

- **Attester-role filtering.** Resolve the signer of each bundle entry against your roster of known organizations, gardener wallets, etc. Reject, weight, or flag based on role — see §7.3 and §7.4 for example policies.
- **Schedule uniqueness.** Exactly one entry with `type === "schedule"` appears in the bundle. (Multiple schedule Activities may exist on chain — e.g. after a reschedule — but the bundle commits to the authoritative one.)
- **Intervention scope consistency.** Every entry's `signedAttestation.message.refUID` equals `keccak256(intervention.interventionId)` (see §9.7). Decide whether a mis-scoped entry invalidates the bundle.
- **Crew completeness.** Count entries with `type === "checkin"` and compare against the schedule entry's `payload.crewSize`. Decide whether a missing crew member invalidates the intervention.
- **Crew consistency.** Filter entries whose `type` is one of `checkin`, `checkout`, `report`, then group by `signer`. Each group is expected to contain exactly one entry of each of the three types. Decide whether incomplete groups invalidate the evidence. (Filtering by type — not by "not the schedule signer" — is important: a small organization may have the same wallet sign the schedule AND participate as a crew member; that wallet's crew chain is still valid crew evidence.)
- **Crew distinctness.** Confirm every crew signer is distinct from every other. Decide whether multiple activity chains from the same wallet collapse into one crew member.
- **Schedule area linkage.** Confirm `bundle.activities[schedule].payload.areaUID` equals the Intervention's on-chain `refUID` (Area). A mismatch means the bundle schedule belongs to a different area than the on-chain record claims.
- **Temporal ordering strictness.** Confirm the ordering rules from §4.2 hold on the on-chain timestamps, per-signer. Decide whether same-block timestamps (`<=` vs `<`) are acceptable.

**Individual gardener participation.** To prove a specific gardener contributed to an intervention, find the entry with `type === "report"` whose signer matches the gardener's wallet and verify its EIP-712 signature (step (4)). This is the canonical proof for milestone claims and CV-style gardener credentials.

> The protocol-level tier gives you full content and temporal integrity without putting operational data on-chain. The policy-level tier is where consumers differentiate — same data, different trust envelopes.

---

## 6. Attestation Reference Graph

EAS attestations can reference each other via the `refUID` field, creating a directed graph. Lifecycle Activities additionally anchor to the **intervention scope hash** (`keccak256(interventionId)` — see §9.7), a deterministic bytes32 value that is not itself an attestation UID but serves as the shared anchor for every Activity belonging to a given intervention.

| From | | To | Relationship |
|---|---|---|---|
| Intervention | → | AreaRegistration | `refUID` (EAS native) |
| Intervention | → | Evidence Bundle | `evidenceBundleHash` (data field) |
| Activity (type=`schedule`) | → | Intervention Scope (§9.7) | `refUID` (EAS native, = `keccak256(interventionId)`) |
| Activity (type=`checkin`) | → | Intervention Scope (§9.7) | `refUID` (EAS native, = `keccak256(interventionId)`) |
| Activity (type=`checkout`) | → | Intervention Scope (§9.7) | `refUID` (EAS native, = `keccak256(interventionId)`) |
| Activity (type=`report`) | → | Intervention Scope (§9.7) | `refUID` (EAS native, = `keccak256(interventionId)`) |
| Activity (type=`healthcheck`) | → | AreaRegistration | `refUID` (EAS native) |
| GardenerMilestone | → | (standalone) | `evidenceRoot` field (Merkle root of Intervention UIDs) |

> **Why the scope hash, not a schedule Activity UID?**
>
> `keccak256(interventionId)` is computable from the human-readable intervention identifier alone. Every crew device can derive the same refUID for their checkin without knowing the schedule Activity's UID. Rescheduling (revoke + re-issue schedule) does not break child Activities — they all still point at the same scope. A single EAS GraphQL query `where refUID = keccak256(interventionId)` returns every lifecycle Activity for the intervention in one round-trip.
>
> The on-chain Intervention carries `interventionId` as a readable string; any reader can compute the scope hash and query the activity set. Per-crew-member chains (checkin → checkout → report) are reconstructed by grouping the returned activities by `signer`.

> **Graph Traversal**
>
> Starting from any Intervention, an auditor can traverse the full evidence chain:
> On-chain attestation → evidence bundle bytes (fetched from publisher) → every lifecycle Activity's signed envelope + payload + on-chain timestamp.
>
> Starting from any AreaRegistration, a dashboard can aggregate all Interventions (via `refUID`) and `healthcheck` Activities (via `refUID`) for that location, then merge them by on-chain timestamp to render a condition timeline.
>
> Starting from an `interventionId` string, a reader computes the scope hash and queries EAS for all Activities sharing that refUID — useful for dashboards that track schedules before publication.

---

## 7. Trust Model

All schemas are registered without a resolver contract. Trust is established at the **read layer**, not at the write layer. Schema = vocabulary. Attester = identity claim. Timestamp = when. What a given reader does with those three primitives is a **verifier-side policy decision**.

### 7.1 Protocol Guarantees vs Verifier Policy

The protocol guarantees three things and three things only:

| Protocol guarantee | Mechanism |
|---|---|
| Who signed an attestation | EIP-712 signature recovery yields the signer wallet |
| What they signed | The signed bytes are deterministic and content-addressable |
| When the attestation was recorded on chain | Block timestamp from `EAS.timestamp(uid)` is set by the chain validator, not the attester |

Everything else is **verifier policy**. Examples of decisions the protocol does NOT make for you:

- Whether the attester's wallet should be trusted (organization / gardener / citizen / unknown)
- Whether the count of `checkin` Activities in the bundle must equal the schedule Activity's `payload.crewSize`
- Whether an Intervention with only the crew lead's Activities (and no additional crew-member chains) is acceptable evidence that the job happened
- Whether all signers in a bundle must be distinct wallets
- Whether a `healthcheck` Activity signed by a citizen wallet counts equally with one signed by the organization
- Whether temporal ordering must be strict (`<`) or may be same-block (`<=`)

Two consumers reading the same on-chain data can legitimately reach different conclusions about the same intervention. Both readings are consistent with the protocol.

Implementations typically expose policies as **composable data** — named presets (e.g. "strict", "protocol-only", "lenient") plus a builder that takes an explicit list of required or blocking check codes. Consumers swap policies at the call site without re-compiling the check stack. The specific preset names and builder shape are implementation concerns — the protocol only defines the checks themselves.

### 7.2 Attester Identity — The Primary Trust Primitive

The signer wallet on every attestation is the **entry point** for any trust policy. Policies are built by resolving the signer wallet to some application-layer identity (role, reputation score, registry membership) and applying weighting or filtering rules.

Each organization adopting the OpenGarden Protocol publishes its wallet address through whatever channels its ecosystem trusts — website, signed operator registry, coordinated directory. Readers who want to scope queries to a specific organization filter on-chain attestations by that attester address. Off-chain Activities carry their signer in the EIP-712 envelope; it is also surfaced at the bundle-entry level (§5.2) so policies can inspect it without re-running signature recovery.

### 7.3 Example Policy — Conservative Organizational Auditor

> **This is one example policy, not the protocol's policy.**

A conservative auditor reviewing an Intervention for a sponsor's impact report might require:

| Check | Rationale |
|---|---|
| On-chain attester ∈ known-organization registry | Filter out attestations from unrelated wallets |
| Bundle bytes fetched from publisher, `keccak256(bytes)` equals `evidenceBundleHash` | Bundle integrity |
| Every Activity's `payload` canonicalizes to the signed `payloadHash` | Payload integrity |
| Every lifecycle Activity's `refUID === keccak256(intervention.interventionId)` | Scope integrity — no stitched-from-other-intervention activities |
| Count of `checkin` Activities == `schedule.payload.crewSize` | Every assigned gardener actually attested |
| All crew signers are distinct wallets | No single person producing multiple "crew member" chains |
| Each crew member's `(checkin, checkout, report)` share the same signer | Bundle wasn't stitched from unrelated signers |
| Temporal ordering strict (`T_checkin < T_checkout < T_report`) per crew signer | No backfilling |
| On-chain timestamps in bundle match `EAS.getTimestamp(uid)` | No timestamp tampering in bundle JSON |

A permissive dashboard rendering volunteer cleanup days might only require:

| Check | Rationale |
|---|---|
| Bundle bytes fetched from publisher, `keccak256(bytes)` equals `evidenceBundleHash` | Minimum integrity |
| At least one `report` Activity in the bundle | Someone attested work happened |

Both are valid policies. The protocol exposes the primitives; the verifier picks the subset that matches their risk appetite.

### 7.4 Example Policy — Healthcheck Weighting

`healthcheck` Activities can be signed by any wallet. A reader aggregating them into an area condition timeline must decide how to weight each observation. Example policies:

- **Organization-only**: filter to `healthcheck` Activities whose signer matches the AreaRegistration attester. Ignore all others. Simplest, matches traditional closed-system QA.
- **Weighted by role**: resolve each signer against an app-layer roster. Organization = 1.0, registered gardener = 0.7, unregistered citizen = 0.3. Weighted moving average across the timeline.
- **Divergence signal**: treat mismatch between organization score and citizen scores on the same area as an alert ("organization claims 9/10, citizens average 4/10 — investigate").

All three aggregate the same on-chain data; none is the protocol's call.

### 7.5 Two-Dimensional Trust

Attester identity verifies **who**. On-chain timestamps (Section 4) verify **when**. Most policies compose both — a trusted attester with no timestamp has unverifiable timing; a timestamped record from an unknown attester has no authority a conservative policy would accept.

### 7.6 Open Protocol

By not binding schemas to a resolver, the same definitions can be adopted by other organizations. A municipal program in another city can attest to the same schemas with their own wallet. Cross-organization dashboards aggregate impact by trusting a set of known attesters — each operator's wallet address is the unit of trust.

---

## 8. Schema Registration Reference

The following are the exact schema strings to register on the EAS SchemaRegistry contract. Each schema is registered once and receives a permanent UID. All schemas are registered with `resolver: ZERO_ADDRESS` (no resolver contract).

**AreaRegistration** (revocable: false)
```
string areaId, int32 latitude, int32 longitude, uint8 areaType, string name, string municipality, bytes32 boundariesHash, string metadata
```

**Intervention** (revocable: false)
```
string interventionId, uint8 interventionType, uint64 executionDate, bytes32 evidenceBundleHash, bytes32 commissionRef
```

**GardenerMilestone** (revocable: false)
```
uint8 milestoneLevel, uint16 totalInterventions, uint16 totalValidated, uint8 avgHealthImprovement, uint64 achievedAt, bytes32 evidenceRoot
```

**Activity** (revocable: true)
```
uint8 activityType, bytes32 payloadHash
```

> **Activity revocability**
>
> The Activity schema is registered `revocable: true` so `schedule` Activities can be revoked during the cancel/reschedule flow. `checkin`, `checkout`, `report`, and `healthcheck` Activities are never revoked in practice — a verifier policy MAY reject bundles containing revoked entries of those types. Enforcement is policy-level, not schema-level, because EAS registers revocability per-schema and the protocol collapses all off-chain activity types into a single schema.

> **Parent Linkage Convention**
>
> Every schema with a single dominant parent carries that parent as the EAS-native `refUID` slot rather than as a schema data field:
>
> | Schema / Activity type | `refUID` points at |
> |---|---|
> | Intervention | AreaRegistration UID |
> | Activity (type=`schedule`) | `keccak256(interventionId)` — intervention scope (§9.7) |
> | Activity (type=`checkin`) | `keccak256(interventionId)` — intervention scope (§9.7) |
> | Activity (type=`checkout`) | `keccak256(interventionId)` — intervention scope (§9.7) |
> | Activity (type=`report`) | `keccak256(interventionId)` — intervention scope (§9.7) |
> | Activity (type=`healthcheck`) | AreaRegistration UID |
> | AreaRegistration | `ZERO_BYTES32` (root) |
> | GardenerMilestone | `ZERO_BYTES32` (standalone; `evidenceRoot` data field is the Merkle anchor) |
>
> Consumers reading decoded schema data MUST read `refUID` from the EAS attestation envelope to resolve parent linkage. The intervention scope hash is a bytes32 value that does not itself resolve to an attestation UID — it is a shared anchor computed from the `interventionId` string per §9.7.
>
> No secondary linkage field exists on Activity. Pairing between a crew member's `checkin`, `checkout`, and `report` is established by matching the triple `(signer, refUID, type)` within the intervention scope — not by a secondary ref.

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
| Intervention | `commissionRef` | Commissioning entity identifier (sponsor ID, municipal contract number, grant ID) |
| Activity (type=`schedule`) | `payload.commissionRef` | Same as Intervention (must match for the same intervention) |

SDK helper: `hashIdentifier(id: string): string`

### 9.2 Media References

`mediaHash` fields on Activity payloads (`report.mediaHash`, `healthcheck.mediaHash`) are `bytes32` keccak256 commitments to the attested evidence. The underlying bytes live in publisher-owned storage (see the [Storage-Agnostic Commitments](#1-architecture-overview) principle).

**Two shapes:**

```
// 1. Single file — hash of the file's raw bytes
mediaHash = keccak256(fileBytes)
// e.g. a single condition photo on healthcheck

// 2. Multi-file manifest — hash of a canonical JSON manifest listing N files
mediaHash = keccak256(utf8Bytes(canonicalManifestJSON))
// e.g. a report with before/after photos + walkthrough video
```

**Canonical manifest** (shape 2) — use when a payload attests to multiple files. Each entry names the file and commits to its bytes by hash:

```
{"v":1,"items":[
  {"hash":"0x3c…","contentType":"image/jpeg"},
  {"hash":"0x8f…","contentType":"image/jpeg"},
  {"hash":"0xa1…","contentType":"video/mp4"}
]}
```

1. `v = 1`. Future versions MUST bump this and MUST be treated as distinct manifest shapes.
2. `items` is an array of `{hash, contentType}` objects. `hash` is the keccak256 of that file's raw bytes (`bytes32` hex). `contentType` is the MIME string declared by the publisher at attestation time (optional — MAY be omitted when unknown).
3. `items` MUST be sorted by `hash` in JavaScript string-comparison order before serialization. Callers pass items in any order; the serializer sorts.
4. Manifest object has exactly two keys in the order `v`, `items`. JSON serialized with no whitespace.
5. The manifest bytes are the input to `keccak256` — verifiers reproduce the hash by canonicalizing the manifest identically.

**Verification flow:** a verifier holding a payload with `mediaHash` receives the underlying bytes (file or manifest) from the publisher's exposed endpoint, recomputes `keccak256(bytes)`, and confirms it equals `mediaHash`. For manifest shape 2, the verifier additionally fetches each `items[i]` file by whatever addressing the publisher uses, computes `keccak256(fileBytes)`, and confirms it equals `items[i].hash`.

**Why not store a CID.** An earlier revision of this section stored the storage-layer CID (IPFS / S3 / URL) in the payload. That coupled the protocol to a retrieval convention, introduced ambiguity for verifiers reading across publishers that used different storage backends, and left the SDK library owning upload logic that was fundamentally app-specific. Keccak hashes are storage-agnostic — the protocol commits to bytes, not locations.

### 9.3 Coordinate Encoding

GPS coordinates in EAS schemas are signed `int32` microdegrees (`decimal × 1,000,000`, truncated). This is a fixed-point representation chosen to keep calldata small and to eliminate floating-point ambiguity. The SDK exposes `toMicrodegrees` / `fromMicrodegrees` helpers and applies the conversion internally when encoding coordinate fields.

### 9.4 Timestamps

Off-chain attestation `timestamp` fields are Unix seconds (`uint64`), matching the EAS EIP-712 `time` field convention. These are **self-reported** timestamps from the signing device. The authoritative time anchor for any attestation is the on-chain timestamp established via `EAS.timestamp(uid)` — see Section 4. Consumers MUST NOT trust a self-reported `timestamp` field in isolation.

### 9.5 Evidence Bundle JSON Serialization

The bundle shape defined in §5.2 is normative. Implementations that produce or consume bundles MUST follow these rules so that bundles are interoperable across organizations.

1. **Schema**. Every bundle has exactly the keys defined in §5.2: `interventionId`, `areaUID`, `activities` (flat array), `bundleVersion`.
2. **Flat activities array**. `activities` is a single array covering every lifecycle Activity for the intervention (schedule + per-crew-member checkin/checkout/report). Solo and crew jobs use the same shape — verifiers filter by `type` and group by `signer`. There is no separate code path for solo jobs.
3. **Sort order**. `activities` MUST be sorted ascending by `onchainTimestamp`. Same-block ties are permitted and do not violate the schema.
4. **BigInt fields as strings**. Inside `signedAttestation.message`, the fields `time`, `expirationTime`, and `nonce` (when present) MUST be serialized as decimal-digit strings — see §5.3. Other `uint*` fields on the message (e.g. the encoded `data` payload, which is a hex string) follow their natural string encoding.
5. **`signer` field**. Every bundle entry carries a top-level `signer` string plus a nested `signedAttestation.signer` string — both MUST equal the address of the wallet that signed the Activity. If the underlying EAS signing primitive does not populate the nested field, the implementation MUST inject it (typically by reading the signer wallet's address at sign time). Readers use these to short-circuit identity lookup — they can still recover the signer from `signature + message` and MUST do so for protocol-level check §5.4 (4).
6. **Payload canonicalization**. Activity `payload` objects MUST hash via §9.8 canonical JSON rules to the `payloadHash` decoded from `signedAttestation.message.data`. Divergent canonicalization produces hash mismatches and invalidates the bundle.
7. **`bundleVersion` is semver**. Readers MUST reject bundles whose `bundleVersion` they don't understand. Pre-1.0 versions are unstable — breaking changes may land in a 0.x.y bump.
8. **JSON determinism not required for bundle envelope**. The bundle hash is computed over the bytes the publisher uploads; any byte-identical copy of the bundle reproduces the same hash. Canonicalization of the outer bundle JSON (key ordering, whitespace) is NOT required by the protocol — the publisher and auditor coordinate via content-addressed storage (the bundle hash IS the address). Implementations that want reproducible bundle hashes across independent rebuilds SHOULD define and document their own canonicalization, but this is an implementation concern, not a protocol requirement. This exemption does NOT apply to individual Activity `payload` objects, which MUST follow §9.8.

### 9.6 Inline metadata vs hashed payloads

Extensibility slots on a schema follow one of two disjoint conventions. This avoids the "same concept, two field shapes" drift that accumulates in long-lived protocols.

**`string metadata` — inline JSON escape hatch.**
Used for small structured extras the protocol does not interpret. The payload lives inside the signed attestation, so there is no separate file to host, fetch, or pin, and signature coverage extends to every byte.

- MUST be a JSON-parseable string or the empty string (`""` = no metadata).
- SHOULD remain under **512 bytes** when UTF-8 encoded. The budget is advisory — heavier payloads are not protocol-invalid, but large inline strings waste calldata and signal the field is being misused as a hashed-payload slot. Implementations MAY enforce the budget at the write layer; the protocol does not require rejection.
- SHOULD carry an app-defined `version` or `v` key so consumers can detect shape changes. Unknown shapes MUST be ignored, not rejected, at the protocol layer.
- Current consumers: `AreaRegistration.metadata`, `healthcheck` Activity payload `metadata` key.

**`bytes32 *Hash` — keccak256 commitment to a large/binary payload.**
Used when the payload cannot fit inline or is inherently binary (polygon GeoJSON, evidence bundles, large opaque blobs).

- The `bytes32` value is the keccak256 of the canonical serialization of the payload (§9.8 rules for JSON payloads; raw byte hash for opaque binary). The payload itself may live on IPFS, in the organization's app database, or in any other storage the publisher chooses — the chain commits to the hash, not the location. Verifiers fetch the payload from the publisher's exposed endpoint and recompute the hash to audit.
- MUST use a purpose-named field — `boundariesHash`, `evidenceBundleHash`, `payloadHash`, `mediaHash`, and any future `*Hash` that names what is committed — never the generic name `metadataHash`. The field name tells readers what to fetch (or how to interpret the hash).
- `ZERO_BYTES32` MUST be accepted as "no payload of this type for this attestation," except where a payload is structurally required (e.g. `Activity.payloadHash` — every Activity carries a payload, even if empty, so the hash reflects that payload and is not `ZERO_BYTES32`).
- The same convention applies to `*Hash` fields carried inside off-chain Activity payloads (not only on-chain schema slots). `report.mediaHash` and `healthcheck.mediaHash` (§9.2) are payload-level hash fields; they follow the same keccak256 + publisher-hosted-bytes rule.
- Current consumers: `AreaRegistration.boundariesHash`, `Intervention.evidenceBundleHash`, `Activity.payloadHash`, `report.mediaHash`, `healthcheck.mediaHash`.

**Mutually exclusive naming.** No schema field is named `metadataHash`. If both a small inline extension and a large hashed payload are needed on the same schema, they live in two distinct fields — `metadata` + a purpose-named `*Hash` — and readers can tell at a glance which is inline and which requires a fetch.

### 9.7 Intervention Scope Hash

Every lifecycle Activity (`schedule`, `checkin`, `checkout`, `report`) sets its EAS `refUID` slot to a deterministic hash of the intervention's human-readable identifier:

```
interventionScopeHash = keccak256(utf8Bytes(interventionId))
```

The input is the raw UTF-8 string with no normalization, trimming, casing change, or prefix. This matches the convention used by §9.1.

Properties:

- **Deterministic from the ID string alone.** No crew device needs the schedule Activity's UID to sign a checkin — it just needs the `interventionId`. This simplifies the client-side flow and keeps coordination ergonomics minimal.
- **Not a pointer to an attestation.** The bytes32 value does not resolve to any attestation UID on chain. It is a shared anchor that EAS-compatible tooling happens to index because the protocol stores it in the `refUID` slot. A single EAS GraphQL query `where refUID = interventionScopeHash` returns every lifecycle Activity for the intervention.
- **Reschedule-resilient.** If a schedule Activity is revoked and a replacement issued for the same `interventionId`, the child Activities remain anchored correctly — all still share the same scope. The bundle publisher decides which schedule Activity is authoritative by including exactly one of them in the evidence bundle.
- **Collision boundary.** `interventionId` MUST be unique within a publisher. Two publishers using the same `interventionId` would produce colliding scope hashes; readers distinguish them by recovered signer (the schema UID + attester address is globally unique). Publishers that need a stronger boundary MAY namespace their IDs with an organization prefix.

SDK helper: `hashInterventionScope(interventionId: string): string`

Applies to:

| Schema / Activity type | Field | Input |
|---|---|---|
| Activity (type=`schedule`) | EAS `refUID` slot | `interventionId` |
| Activity (type=`checkin`) | EAS `refUID` slot | `interventionId` |
| Activity (type=`checkout`) | EAS `refUID` slot | `interventionId` |
| Activity (type=`report`) | EAS `refUID` slot | `interventionId` |

The on-chain Intervention attestation retains `refUID = AreaRegistration UID` so readers indexing by area still get direct Intervention lookups. The link from Intervention to its lifecycle Activities is resolved by the reader: compute the scope hash from `intervention.interventionId`, query EAS for Activities with matching `refUID`.

### 9.8 Activity Payload Canonicalization

The `payloadHash` field in every Activity's ABI-encoded schema data is the keccak256 of a canonical JSON serialization of the payload object (see §3.2 for per-type payload shapes). The payload itself is carried in the evidence bundle as plaintext; the hash is the only protocol-level cryptographic anchor for payload content.

Canonical form rules:

```
payloadHash = keccak256(utf8Bytes(canonicalJSON(payload)))
```

1. **Key ordering.** Object keys are sorted in **JavaScript string-comparison order** (UTF-16 code unit comparison) recursively at every nesting depth. Arrays retain their original order — sorting is NOT applied to array elements.
2. **Whitespace.** No whitespace between tokens. `JSON.stringify(obj)` with no `space` argument, after key sorting.
3. **Encoding.** UTF-8 bytes of the serialized JSON string.
4. **Numbers.** Serialized per JSON number canonical form: no leading `+`, no `-0`, no trailing zeros in the fractional part, no exponent when a plain decimal is shorter. All payload numbers in §3.2 fit in a 53-bit mantissa; implementations MUST NOT serialize them as strings.
5. **Strings.** JSON-escaped per RFC 8259. The SDK relies on the runtime's `JSON.stringify` escape rules; non-conforming runtimes MUST patch to match.
6. **`null` handling.** `null` is preserved as-is. Missing optional keys are omitted entirely, not written as `null`, unless the §3.2 payload shape explicitly specifies `null`.
7. **No duplicate keys.** Payload objects MUST NOT contain duplicate keys. (JSON forbids them; canonicalization does not need to handle this case.)

SDK helper: `hashActivityPayload(payload): string`

> **Normative for interoperability**
>
> Two implementations computing `payloadHash` on the same logical payload MUST produce byte-identical canonical JSON. Any divergence — extra whitespace, different key ordering, distinct number formatting — produces a different hash and invalidates the bundle. The rules above are normative for any implementation that claims compatibility with the OpenGarden Protocol. The SDK exposes `hashActivityPayload` as the single normative implementation; consumers SHOULD use it rather than re-implementing canonicalization.

> **Why not use the inline-metadata budget?**
>
> §9.6 defines a `string metadata` slot for small inline JSON extras. Activity payloads are NOT inline — they travel alongside the signed envelope in the evidence bundle and are committed to via `payloadHash`. The distinction is intentional: inline metadata keeps the payload inside the signed bytes (smaller on-chain footprint, free signature coverage) at the cost of calldata; hashed payloads keep the signed bytes compact (33 bytes for the whole Activity) at the cost of requiring canonicalization and payload transport. Both conventions coexist — `AreaRegistration.metadata` uses the inline slot; `Activity.payloadHash` uses the hashed slot.
