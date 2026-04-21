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
| **Healthcheck** | Off-chain + timestamped | Any wallet | Periodic area-condition signal |

_\*Implementation deferred until the release of the Gardeners' app_

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
| **boundariesHash** | `bytes32` | Content-addressable hash (IPFS CID) of the area's boundary payload — polygon GeoJSON, high-res photo bundle, or any other large binary artifact that describes the site's footprint. `ZERO_BYTES32` if the organization has no boundary data for this area |
| **metadata** | `string` | Small inline JSON escape hatch for app-specific extras (surface area m², access hours, institutional labels). SHOULD remain under the 512-byte budget defined in [§9.6](#96-inline-metadata-vs-hashed-payloads). Empty string if none |

> **Attestation Metadata**
>
> Recipient: ZERO_ADDRESS (no specific recipient — this is a public record).
> Attester: Organization wallet.
> Revocable: No. An area registration is a permanent geographic fact.
> RefUID: ZERO_BYTES32 (root attestation, no parent reference).

> **Gas Optimization**
>
> Coordinates use int32 microdegrees instead of string to reduce calldata. Large binary payloads (polygons, photo bundles) are offloaded to IPFS via the `boundariesHash` field. Small structured extras ride inline via `metadata` so readers don't need an extra IPFS fetch for a handful of bytes. The split follows the convention formalized in [§9.6](#96-inline-metadata-vs-hashed-payloads).

### 2.2 PublishedIntervention

Created when an intervention is fully executed and the organization signs off on it. This is the canonical **job record** — one per intervention, regardless of crew size. It bundles all off-chain operational attestations (per-gardener checkins, checkouts, and reports) by referencing their content hashes.

> **ON-CHAIN** · Revocable: No

| Field | Type | Description |
|---|---|---|
| **interventionId** | `string` | Internal intervention identifier (e.g. "INT-2026-0187") |
| **interventionType** | `uint8` | 0 = unspecified, 1 = routine maintenance, 2 = restoration, 3 = emergency, 4 = seasonal, 5 = new planting |
| **executionDate** | `uint64` | Unix timestamp of when work was completed |
| **evidenceBundleHash** | `bytes32` | IPFS CID hash of the evidence bundle JSON containing all off-chain attestation UIDs, their content hashes, and their on-chain timestamps |
| **commissionRef** | `bytes32` | Keccak256 hash of commissioning entity identifier (corporate sponsor ID, municipal contract number, or grant ID). `ZERO_BYTES32` for volunteer / unsponsored work |

> **Attestation Metadata**
>
> Recipient: ZERO_ADDRESS. A PublishedIntervention is a public job record, not a credential addressed to any individual. Per-gardener credentialing flows through GardenerMilestone SBTs (Section 2.3) whose evidence is the set of GardenerReports bundled inside the PublishedIntervention's evidence bundle.
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
> A crew job produces a single PublishedIntervention. Each crew member independently signs their own GardenerCheckin, GardenerCheckout, and GardenerReport attestations — these are cryptographically tied to their wallet via EAS off-chain signatures and all reference the same `interventionUID`. The evidence bundle collects every crew member's signed chain alongside the one-per-job ScheduledIntervention. Crew headcount is carried on the ScheduledIntervention.
>
> **To prove an individual gardener contributed to a specific intervention**, a verifier reads the PublishedIntervention, fetches the evidence bundle, and checks for a GardenerReport whose attester is that gardener's wallet. The gardener's aggregated credential (career history, level) is the GardenerMilestone SBT, which is directly addressed to their wallet.

### 2.3 GardenerMilestone (Soulbound)

A non-transferable credential minted when a gardener crosses a meaningful threshold. This is the gardener's portable proof of skill and reliability. Designed to be legible to future employers, housing authorities, and social services.

> **ON-CHAIN** · Revocable: No


| Field | Type | Description |
|---|---|---|
| **milestoneLevel** | `uint8` | Progressive level keyed off `totalValidated`: 1 = Apprentice (5 validated), 2 = Gardener (15), 3 = Senior (40), 4 = Master (100) |
| **totalInterventions** | `uint16` | Cumulative count of GardenerReports signed by this gardener, sourced from the organization's operational store. Covers every completed crew-member chain the gardener participated in |
| **totalValidated** | `uint16` | Subset of `totalInterventions` whose parent job reached a PublishedIntervention on-chain. Computed by counting the gardener's GardenerReports that appear inside any PublishedIntervention's evidence bundle. The gap `totalInterventions - totalValidated` represents work that stayed off-chain |
| **avgHealthImprovement** | `uint8` | Average area-health improvement attributable to the gardener's validated interventions, derived off-chain from the area's Healthcheck timeline (pre/post delta around each intervention's executionDate). `0` if no measurable signal |
| **achievedAt** | `uint64` | Unix timestamp when milestone was reached |
| **evidenceRoot** | `bytes32` | Merkle root of the PublishedIntervention UIDs the gardener contributed to (one leaf per intervention — matches `totalValidated`, not `totalInterventions`). The organization computes this at mint time by scanning its evidence bundles for GardenerReports signed by the recipient wallet. `ZERO_BYTES32` when no bundle evidence is recorded on-chain |

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

All off-chain attestations in the intervention lifecycle (ScheduledIntervention plus each crew member's GardenerCheckin, GardenerCheckout, and GardenerReport) are **timestamped on-chain** via `EAS.timestamp()` immediately after creation. See [Section 4: Temporal Integrity](#4-temporal-integrity) for the protocol rules.

### 3.1 ScheduledIntervention

Created when the organization plans a new intervention. One ScheduledIntervention per job, regardless of crew size. It may never reach on-chain if the intervention is cancelled or rescheduled.

> **OFF-CHAIN** · Revocable: Yes · **Timestamped on-chain: Required**

| Field | Type | Description |
|---|---|---|
| **interventionId** | `string` | Internal ID, will carry through to PublishedIntervention if completed |
| **interventionType** | `uint8` | Same enum as PublishedIntervention (0–5) |
| **scheduledDate** | `uint64` | Planned execution date as Unix timestamp |
| **estimatedMinutes** | `uint16` | Expected duration in minutes (`0` = unspecified) |
| **description** | `string` | Free-text description of required work |
| **commissionRef** | `bytes32` | Hash of commissioning entity (matches PublishedIntervention field). `ZERO_BYTES32` for volunteer / unsponsored work |
| **crewSize** | `uint8` | Total number of gardeners assigned (1 for solo jobs) |

> **Attestation Metadata**
>
> Recipient: Crew lead wallet (so the lead receives the assignment notification and is operationally responsible for the crew). `ZERO_ADDRESS` is permitted for unassigned schedules that will be reassigned via revoke-and-re-create.
> Attester: Organization wallet.
> Revocable: Yes. If an intervention is cancelled or rescheduled, the original attestation is revoked and a new one created. This maintains a clean audit trail of planning decisions.
> RefUID: AreaRegistration UID. Area linkage is carried by the EAS-native `refUID` slot.

> **Temporal Anchoring**
>
> This is the most critical attestation to timestamp on-chain. The on-chain timestamp of the ScheduledIntervention proves that planning preceded execution. A PublishedIntervention whose `executionDate` predates its schedule's on-chain timestamp is provably backfilled. See [Section 4.2](#42-ordering-rules).

### 3.2 GardenerCheckin

Created by the gardener (or their device) when arriving at the work site. Establishes presence and start time. **One per crew member per intervention.** Each crew member independently signs their own checkin; all of them reference the same ScheduledIntervention via the EAS `refUID` slot.

> **OFF-CHAIN** · Revocable: No · **Timestamped on-chain: Required**

| Field | Type | Description |
|---|---|---|
| **latitude** | `int32` | GPS latitude at check-in (microdegrees) |
| **longitude** | `int32` | GPS longitude at check-in (microdegrees) |
| **photoHash** | `bytes32` | IPFS CID of arrival photo (visual proof of presence and initial site condition) |

> **Time**
>
> The moment of check-in is carried by the EIP-712 envelope's `message.time` field and anchored on-chain via `EAS.timestamp(uid)`. No separate schema field restates it.

> **Attestation Metadata**
>
> Recipient: ZERO_ADDRESS (self-attestation of presence).
> Attester: Gardener wallet.
> Revocable: No. A check-in is a factual record of arrival.
> RefUID: ScheduledIntervention UID. The intervention linkage is carried by the EAS-native `refUID` slot.

> **Verification**
>
> GPS proximity to the registered area coordinates can be verified programmatically.

### 3.3 GardenerCheckout

Created when the gardener finishes work at the site. Closes the work session. **One per crew member per intervention**, each paired to the same crew member's GardenerCheckin via the EAS `refUID` slot.

> **OFF-CHAIN** · Revocable: No · **Timestamped on-chain: Required**

| Field | Type | Description |
|---|---|---|
| **actualMinutes** | `uint16` | Actual time spent on site in minutes |

> **Time**
>
> The moment of checkout is carried by the EIP-712 envelope's `message.time` field and anchored on-chain via `EAS.timestamp(uid)`. No separate schema field restates it.

> **Attestation Metadata**
>
> Recipient: ZERO_ADDRESS.
> Attester: Gardener wallet.
> Revocable: No. A checkout is a factual record of session closure.
> RefUID: GardenerCheckin UID. The checkin linkage is carried by the EAS-native `refUID` slot.

### 3.4 GardenerReport

The gardener's own account of the work performed. This is the primary evidence document and the foundation of the gardener's verifiable work history. **One per crew member per intervention.** For crew jobs, each crew member writes their own report — the set of reports is the cryptographic roster of who actually worked.

> **OFF-CHAIN** · Revocable: No · **Timestamped on-chain: Required**

| Field | Type | Description |
|---|---|---|
| **checkoutUID** | `bytes32` | Off-chain UID of the GardenerCheckout attestation. Carried as a schema field because the EAS `refUID` slot holds the ScheduledIntervention parent linkage. |
| **tasksCompleted** | `string` | Comma-separated list of completed task codes (e.g. "PRUNE,CLEAN,WATER,PLANT") |
| **taskCount** | `uint8` | Number of discrete tasks completed |
| **photosHash** | `bytes32` | IPFS CID of photo bundle (after-work documentation) |
| **notes** | `string` | Free-text field for gardener observations, issues encountered, materials used |

> **Attestation Metadata**
>
> Recipient: ZERO_ADDRESS.
> Attester: Gardener wallet. The report is the gardener's signed testimony; the organization's sign-off happens when it publishes the intervention on-chain.
> Revocable: No. A submitted report is a permanent record.
> RefUID: ScheduledIntervention UID. The primary intervention linkage is carried by the EAS-native `refUID` slot; the secondary linkage to the crew member's checkout lives in the `checkoutUID` data field.

### 3.5 Healthcheck

A periodic condition assessment of an area. Independent of any specific intervention — it is raw signal about the area's current state at a point in time. Healthchecks accumulate into an area-scoped timeline that consumers aggregate to compute trend, derive pre/post-intervention deltas, or flag areas needing attention.

> **OFF-CHAIN** · Revocable: No · **Timestamped on-chain: Required**

| Field | Type | Description |
|---|---|---|
| **healthScore** | `uint8` | Condition score (1–10 scale, 10 is best) |
| **photoHash** | `bytes32` | IPFS CID of condition documentation photo (`ZERO_BYTES32` if none) |
| **notes** | `string` | Free-text observations (empty string if none) |
| **metadata** | `string` | App-specific JSON escape hatch (empty string for none). See below. |

> **metadata field**
>
> A free-form JSON string for app-specific extras that the protocol does not interpret (weather, assessor wallet annotations, seasonal context, etc.). Consumers that don't recognize the shape ignore it. Empty string means no metadata. The field travels inside the attestation, so there is no separate file to host, fetch, or pin. SHOULD remain under the 512-byte budget defined in [§9.6](#96-inline-metadata-vs-hashed-payloads); heavier payloads belong on a dedicated `*Hash` field of a future schema version.

> **Attestation Metadata**
>
> Recipient: ZERO_ADDRESS.
> Attester: Any wallet — organization, gardener, or citizen. Role is inferred **off-chain** from the issuer wallet: match against the AreaRegistration attester (organization) or the app-maintained gardener roster, otherwise treat as citizen signal.
> Revocable: No. A health assessment is a factual measurement record at a given time.
> RefUID: AreaRegistration UID. Area linkage is carried by the EAS-native `refUID` slot — healthchecks are indexed by area in the EAS graph natively.

> **Area-scoped, intervention-independent**
>
> Healthchecks reference the area, not a specific intervention. An area's timeline contains both Healthcheck and PublishedIntervention streams — readers merge them by timestamp to reconstruct condition changes around each intervention.

> **Trust & aggregation**
>
> A single Healthcheck is raw signal. Aggregation, weighting by issuer role, and thresholding ("does this area need an intervention?") are **verifier policy** decisions — see [§7.4](#74-example-policy--healthcheck-weighting) for example policies. The SDK only surfaces the raw timeline via `getAreaHealthchecks(areaUID)`; composing it into a trust judgement is the reader's job.

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
max(T_report[*]) < T_publication
```

Put plainly: scheduling precedes every crew member's arrival, each crew member checks out after checking in and reports after checking out, and publication happens after every crew member's report is recorded. There is no ordering constraint *between* crew members — Alice can finish her shift before Bob even arrives.

The claimed `executionDate` in PublishedIntervention MUST fall within the bracket:

```
T_schedule ≤ executionDate ≤ T_publication
```

Healthchecks are an independent periodic stream outside the intervention lifecycle. Their on-chain timestamps are the authoritative time anchor for aggregation; no bracket rule ties them to scheduled/checkin/checkout/report timestamps.

A PublishedIntervention whose `executionDate` predates `T_schedule` is provably backfilled.

### 4.3 Timestamping Protocol

Each off-chain attestation is timestamped individually via `EAS.timestamp(uid)`. Steps that are logically simultaneous (e.g., a single gardener's checkout and report) MAY be batched via `multiTimestamp()`. Steps that must demonstrate elapsed time (e.g., checkin and checkout for the same gardener) MUST NOT be batched. All N crew members' checkins across a single crew job MAY be batched together if they genuinely arrive at the same moment, since the relative ordering between crew members is unconstrained.

Total cost per intervention lifecycle: `1 + 3N` timestamps (scheduled + per-crew-member checkin/checkout/report). A solo job is `4` timestamps at **~$0.0004**. A 4-person crew is `13` timestamps at **~$0.0013**. At 1,000 interventions/month with an average crew of 2, this is well under $1/month. Healthchecks are timestamped independently outside the intervention lifecycle.

### 4.4 MVP Minimum

At minimum, **timestamp the ScheduledIntervention on-chain**. Combined with the inherent block timestamp of the on-chain PublishedIntervention, this brackets the intervention: `T_schedule < work < T_publication`. This alone defeats the bulk-backfill attack. The intermediate timestamps (per-crew-member checkin/checkout/report) SHOULD be implemented from launch given the negligible cost.

---

## 5. Evidence Bundle Structure

The evidenceBundleHash field in PublishedIntervention points to a JSON document on IPFS that links all off-chain attestations for a given intervention. This is the bridge between the off-chain operational layer and the on-chain settlement layer.

The `scheduled` entry is always single (one per job). The `checkins`, `checkouts`, and `reports` entries are **always arrays** — length 1 for solo jobs, length N for a crew of N. Consumers treat solo and crew jobs uniformly by iterating the arrays; there is no separate code path.

### 5.1 Self-Verifying Bundles

Each bundle entry embeds the **full EIP-712 signed attestation** (`uid`, `message`, `signature`, `signer`) verbatim. A reader holding the bundle file can therefore:

- Recover the signer from every signature locally (no network).
- Re-verify every `refUID` wiring decision locally.
- Verify the bundle's stated `onchainTimestamp` against the chain with a single `EAS.getTimestamp(uid)` call per entry.

The bundle is the verifiable unit. No separate fetch from an off-chain attestation store (e.g. easscan) is required for signature or parent-linkage checks.

### 5.2 Bundle JSON

**evidence-bundle.json** (crew of 2 shown, some fields truncated with `…`)

```json
{
  "interventionId": "INT-2026-0187",
  "areaUID": "0xabc…def",
  "attestations": {
    "scheduled": {
      "uid": "0x123…789",
      "claimedTimestamp": 1709251200,
      "onchainTimestamp": 1709251215,
      "signedAttestation": {
        "version": 1,
        "uid": "0x123…789",
        "signer": "0xOrg…",
        "message": {
          "schema": "0xSchedSchemaUID",
          "recipient": "0xCrewLead…",
          "time": "1709251200",
          "expirationTime": "0",
          "revocable": true,
          "refUID": "0xabc…def",
          "data": "0x…encoded…"
        },
        "signature": { "r": "0x…", "s": "0x…", "v": 27 }
      }
    },
    "checkins": [
      {
        "uid": "0x456…012",
        "attester": "0xAlice…",
        "claimedTimestamp": 1709337600,
        "onchainTimestamp": 1709337618,
        "signedAttestation": {
          "version": 1,
          "uid": "0x456…012",
          "signer": "0xAlice…",
          "message": {
            "schema": "0xCheckinSchemaUID",
            "recipient": "0x0000…0000",
            "time": "1709337600",
            "expirationTime": "0",
            "revocable": false,
            "refUID": "0x123…789",
            "data": "0x…encoded…"
          },
          "signature": { "r": "0x…", "s": "0x…", "v": 27 }
        }
      },
      { "uid": "0x457…013", "attester": "0xBob…",   "signedAttestation": { "…": "…" }, "claimedTimestamp": 1709337650, "onchainTimestamp": 1709337670 }
    ],
    "checkouts": [
      { "uid": "0x789…345", "attester": "0xAlice…", "signedAttestation": { "…": "…" }, "claimedTimestamp": 1709344800, "onchainTimestamp": 1709344812 },
      { "uid": "0x790…346", "attester": "0xBob…",   "signedAttestation": { "…": "…" }, "claimedTimestamp": 1709344900, "onchainTimestamp": 1709344920 }
    ],
    "reports": [
      { "uid": "0xdef…901", "attester": "0xAlice…", "signedAttestation": { "…": "…" }, "claimedTimestamp": 1709345100, "onchainTimestamp": 1709345120 },
      { "uid": "0xdf0…902", "attester": "0xBob…",   "signedAttestation": { "…": "…" }, "claimedTimestamp": 1709345200, "onchainTimestamp": 1709345220 }
    ]
  },
  "photos": {
    "checkinPhotos": ["ipfs://Qm…/alice-arrival.jpg", "ipfs://Qm…/bob-arrival.jpg"],
    "reportPhotos": "ipfs://Qm…/work-evidence/",
    "afterPhotos": "ipfs://Qm…/completion/"
  },
  "bundleVersion": "0.1.0"
}
```

> **Bundle Fields**
>
> - `claimedTimestamp`: Self-reported Unix seconds from the off-chain attestation data (device time, application time) — what the attester claims.
> - `onchainTimestamp`: Block timestamp from `EAS.timestamp(uid)`. Authoritative, independently verifiable time anchor.
> - `attester` (per-gardener entries): Top-level identity claim recorded by the publisher. MUST match the signer recovered from `signedAttestation.signature`; the signature check (§5.4 protocol-level step (4)) enforces this.
> - `signedAttestation`: The full EIP-712 signed attestation, verbatim. Structure is the object EAS-compatible libraries return from their offchain signing primitive — `{version, uid, signer, message{schema, recipient, time, expirationTime, revocable, refUID, data, …}, signature{r, s, v}}`. Some implementations populate `signer` at sign time; others omit it and expect the reader to recover it from `signature`. A complete bundle MUST include `signer` so that readers can cross-check without re-running recovery just to learn the identity.
>
> The `onchainTimestamp` fields are technically redundant — readers can rebuild them by querying `EAS.getTimestamp(uid)`. Including them in the bundle enables offline inspection and makes drift between bundle and chain trivially detectable.

> **Attester vs signer**
>
> The bundle carries two identity fields per gardener entry: a top-level `attester` and an embedded `signedAttestation.signer`. The **authoritative** identity is the signer recovered from the EIP-712 signature. The top-level `attester` is a convenience claim the publisher wrote when assembling the bundle; a sig-verify policy (see §5.4) rejects the bundle if the two disagree. Verifiers that skip sig verification take the top-level `attester` at face value.

### 5.3 JSON Serialization — BigInt fields

The `signedAttestation.message.time`, `signedAttestation.message.expirationTime`, and (when present) `signedAttestation.message.nonce` fields are conceptually `uint256` and are serialized as **decimal-digit strings** (e.g. `"1709251200"`, not `1709251200`). Rationale:

- JSON has no native bigint.
- Emitting them as numbers loses precision once they exceed `Number.MAX_SAFE_INTEGER` (2⁵³ − 1).
- Stringification is reversible and unambiguous.

Verifiers re-running EIP-712 typed-data hashing MUST parse these back to integers before recomputing the digest; otherwise the recomputed hash will not match the signature.

Integer fields outside `signedAttestation.message` (`claimedTimestamp`, `onchainTimestamp`) are serialized as JSON numbers because they always fit in a 53-bit mantissa for any plausible Unix timestamp.

> **Bundle Version**
>
> The bundle format is versioned with semver. The current version is `0.1.0`. Consumers MUST reject bundles whose `bundleVersion` they don't understand. Pre-1.0 versions are unstable — breaking changes may land in a 0.x.y bump.

### 5.4 Verification Flow

Verification splits into two tiers. The first tier is **protocol-level** — the guarantees the protocol itself makes, which every consumer relies on. The second tier is **policy-level** — checks a specific verifier may choose to apply depending on their trust requirements (see [Section 7: Trust Model](#7-trust-model) for the philosophy).

**Protocol-level (non-negotiable — skip any of these and you no longer have a valid OpenGarden attestation):**

(1) Read the `evidenceBundleHash` from the on-chain PublishedIntervention attestation.
(2) Fetch the bundle JSON from IPFS (or the organization's storage) and confirm its content hashes to the on-chain `evidenceBundleHash`.
(3) Verify the `bundleVersion` is understood (reject unknown versions).
(4) For each bundle entry: recover the EIP-712 signer from `signedAttestation.signature` and `signedAttestation.message`; confirm it matches both `signedAttestation.signer` and the top-level `attester` (when present). This is a **local** operation — the bundle carries the full signed payload, so no network query is required. Remember to parse string-encoded bigint fields (§5.3) back to integers before recomputing the typed-data digest.
(5) For each bundle entry: query `EAS.getTimestamp(uid)` on chain and confirm it matches the `onchainTimestamp` recorded in the bundle.

**Policy-level (verifier's call — pick the subset that matches your trust model):**

- **Attester-role filtering.** Resolve the signer of each bundle entry against your roster of known organizations, gardener wallets, etc. Reject, weight, or flag based on role — see §7.3 and §7.4 for example policies.
- **Crew completeness.** Cross-reference `bundle.attestations.checkins.length` against the ScheduledIntervention's `crewSize` field. Decide whether a missing crew member invalidates the intervention.
- **Crew consistency.** Confirm each crew member's `(checkin, checkout, report)` triple is signed by the same wallet. Decide whether mixing signers across a single crew member's chain invalidates the evidence.
- **Crew distinctness.** Confirm every crew member's signer is distinct from every other. Decide whether multiple attestations from the same wallet collapse into one crew member.
- **RefUID wiring.** Confirm each entry's `signedAttestation.message.refUID` points at the expected parent (area UID for the scheduled attestation; scheduled UID for checkins and reports; the same member's checkin UID for checkouts). Decide whether a mis-wired bundle invalidates the evidence or just earns a warning.
- **Temporal ordering strictness.** Confirm the ordering rules from §4.2 hold on the on-chain timestamps. Decide whether same-block timestamps (`<=` vs `<`) are acceptable.

**Individual gardener participation.** To prove a specific gardener contributed to an intervention, find the entry in `bundle.attestations.reports` whose signer matches the gardener's wallet and verify its EIP-712 signature (step (4)). This is the canonical proof for milestone claims and CV-style gardener credentials.
>
> The protocol-level tier gives you full content and temporal integrity without putting operational data on-chain. The policy-level tier is where consumers differentiate — same data, different trust envelopes.

---

## 6. Attestation Reference Graph

EAS attestations can reference each other via the refUID field, creating a directed graph. The following describes the reference relationships in this system.

| From | | To | Relationship |
|---|---|---|---|
| PublishedIntervention | → | AreaRegistration | refUID (EAS native) |
| PublishedIntervention | → | Evidence Bundle | evidenceBundleHash |
| ScheduledIntervention | → | AreaRegistration | refUID (EAS native) |
| GardenerCheckin | → | ScheduledIntervention | refUID (EAS native) |
| GardenerCheckout | → | GardenerCheckin | refUID (EAS native) |
| GardenerReport | → | ScheduledIntervention | refUID (EAS native) |
| GardenerReport | → | GardenerCheckout | checkoutUID field (secondary ref) |
| Healthcheck | → | AreaRegistration | refUID (EAS native) |
| GardenerMilestone | → | (standalone) | evidenceRoot field |

> **Graph Traversal**
>
> Starting from any PublishedIntervention, an auditor can traverse the full evidence chain:
> On-chain attestation → evidence bundle on IPFS → individual off-chain attestations → photos and documents → on-chain timestamps for each step.
>
> Starting from any AreaRegistration, a dashboard can aggregate all interventions and healthchecks for that location, then merge them by timestamp to render a condition timeline.

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
- Whether `bundle.checkins.length === ScheduledIntervention.crewSize` is required
- Whether a PublishedIntervention with only the crew lead's attestations (and no solo-gardener attestations) is acceptable evidence that the job happened
- Whether all attesters in a bundle must be distinct wallets
- Whether a Healthcheck signed by a citizen wallet counts equally with one signed by the organization
- Whether temporal ordering must be strict (`<`) or may be same-block (`<=`)

Two consumers reading the same on-chain data can legitimately reach different conclusions about the same intervention. Both readings are consistent with the protocol.

Implementations typically expose policies as **composable data** — named presets (e.g. "strict", "protocol-only", "lenient") plus a builder that takes an explicit list of required or blocking check codes. Consumers swap policies at the call site without re-compiling the check stack. The specific preset names and builder shape are implementation concerns — the protocol only defines the checks themselves.

### 7.2 Attester Identity — The Primary Trust Primitive

The attester wallet on every attestation is the **entry point** for any trust policy. Policies are built by resolving the attester wallet to some application-layer identity (role, reputation score, registry membership) and applying weighting or filtering rules.

Each organization adopting the OpenGarden Protocol publishes its attester address on its website and in the schema metadata on IPFS. Readers who want to scope queries to a specific organization filter on-chain attestations by that attester address. Off-chain attestations carry their signer in the EIP-712 envelope; it is also surfaced at the bundle-entry level (§5.2) so policies can inspect it without re-running signature recovery.

### 7.3 Example Policy — Conservative Organizational Auditor

> **This is one example policy, not the protocol's policy.**

A conservative auditor reviewing a PublishedIntervention for a sponsor's impact report might require:

| Check | Rationale |
|---|---|
| On-chain attester ∈ known-organization registry | Filter out attestations from unrelated wallets |
| `evidenceBundleHash` resolves, bundle content hashes to this value | Bundle integrity |
| `bundle.checkins.length === ScheduledIntervention.crewSize` | Every assigned gardener actually attested |
| All crew attesters are distinct wallets | No single person producing multiple "crew member" chains |
| Each crew member's `(checkin, checkout, report)` share the same attester | Bundle wasn't stitched from unrelated attestations |
| Temporal ordering strict (`T_checkin < T_checkout < T_report`) per crew member | No backfilling |
| On-chain timestamps in bundle match `EAS.getTimestamp(uid)` | No timestamp tampering in bundle JSON |

A permissive dashboard rendering volunteer cleanup days might only require:

| Check | Rationale |
|---|---|
| `evidenceBundleHash` resolves, bundle content hashes to this value | Minimum integrity |
| At least one GardenerReport in the bundle | Someone attested work happened |

Both are valid policies. The protocol exposes the primitives; the verifier picks the subset that matches their risk appetite.

### 7.4 Example Policy — Healthcheck Weighting

Healthchecks can be signed by any wallet. A reader aggregating Healthcheck signals into an area condition timeline must decide how to weight each observation. Example policies:

- **Organization-only**: filter to Healthchecks whose attester matches the AreaRegistration attester. Ignore all others. Simplest, matches traditional closed-system QA.
- **Weighted by role**: resolve each attester against an app-layer roster. Organization = 1.0, registered gardener = 0.7, unregistered citizen = 0.3. Weighted moving average across the timeline.
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

**PublishedIntervention** (revocable: false)
```
string interventionId, uint8 interventionType, uint64 executionDate, bytes32 evidenceBundleHash, bytes32 commissionRef
```

**GardenerMilestone** (revocable: false)
```
uint8 milestoneLevel, uint16 totalInterventions, uint16 totalValidated, uint8 avgHealthImprovement, uint64 achievedAt, bytes32 evidenceRoot
```

**ScheduledIntervention** (revocable: true)
```
string interventionId, uint8 interventionType, uint64 scheduledDate, uint16 estimatedMinutes, string description, bytes32 commissionRef, uint8 crewSize
```

**GardenerCheckin** (revocable: false)
```
int32 latitude, int32 longitude, bytes32 photoHash
```

**GardenerCheckout** (revocable: false)
```
uint16 actualMinutes
```

**GardenerReport** (revocable: false)
```
bytes32 checkoutUID, string tasksCompleted, uint8 taskCount, bytes32 photosHash, string notes
```

**Healthcheck** (revocable: false)
```
uint8 healthScore, bytes32 photoHash, string notes, string metadata
```

> **Parent Linkage Convention**
>
> Every schema with a single dominant parent carries that parent as the EAS-native `refUID` slot rather than as a schema data field:
> - PublishedIntervention, ScheduledIntervention, Healthcheck → AreaRegistration UID
> - GardenerCheckin, GardenerReport → ScheduledIntervention UID
> - GardenerCheckout → GardenerCheckin UID
>
> GardenerReport carries a secondary reference to the crew member's GardenerCheckout in the `checkoutUID` data field because the `refUID` slot is reserved for the intervention parent. Consumers reading decoded schema data MUST read `refUID` from the EAS attestation envelope to resolve parent linkage.

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

SDK helper: `hashIdentifier(id: string): string`

### 9.2 Photo and Media Bundles

Fields carrying a hash of one or more media references (`photoHash`, `photosHash`, `boundariesHash`, `evidenceBundleHash`, and any future `*Hash` field introduced per §9.6) MUST be derived as follows.

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

### 9.5 Evidence Bundle JSON Serialization

The bundle shape defined in §5.2 is normative. Implementations that produce or consume bundles MUST follow these rules so that bundles are interoperable across organizations.

1. **Schema**. Every bundle has exactly the keys defined in §5.2: `interventionId`, `areaUID`, `attestations` (with `scheduled`, `checkins`, `checkouts`, `reports`), `photos` (optional; absent or present as an object), `bundleVersion`.
2. **Arrays over objects**. `checkins`, `checkouts`, `reports` are always arrays, even for solo jobs (length 1). Readers MUST iterate; there is no separate solo code path.
3. **BigInt fields as strings**. Inside `signedAttestation.message`, the fields `time`, `expirationTime`, and `nonce` (when present) MUST be serialized as decimal-digit strings — see §5.3. Other `uint*` fields on the message (e.g. the encoded `data` payload, which is a hex string) follow their natural string encoding.
4. **`signer` field**. Every `signedAttestation` MUST include a top-level `signer` string carrying the address of the wallet that signed the attestation. If the underlying EAS signing primitive does not populate this field, the implementation MUST inject it (typically by reading the signer wallet's address at sign time). Readers use this to short-circuit identity lookup — they can still recover the signer from `signature + message` and MUST do so for protocol-level check §5.4 (4).
5. **`bundleVersion` is semver**. Readers MUST reject bundles whose `bundleVersion` they don't understand. Pre-1.0 versions are unstable — breaking changes may land in a 0.x.y bump.
6. **JSON determinism not required**. The bundle hash is computed over the bytes the publisher uploads; any byte-identical copy of the bundle reproduces the same hash. Canonicalization of JSON (key ordering, whitespace) is NOT required by the protocol — the publisher and auditor coordinate via content-addressed storage (the bundle hash IS the address). Implementations that want reproducible bundle hashes across independent rebuilds SHOULD define and document their own canonicalization, but this is an implementation concern, not a protocol requirement.

### 9.6 Inline metadata vs hashed payloads

Extensibility slots on a schema follow one of two disjoint conventions. This avoids the "same concept, two field shapes" drift that accumulates in long-lived protocols.

**`string metadata` — inline JSON escape hatch.**
Used for small structured extras the protocol does not interpret. The payload lives inside the signed attestation, so there is no separate file to host, fetch, or pin, and signature coverage extends to every byte.

- MUST be a JSON-parseable string or the empty string (`""` = no metadata).
- SHOULD remain under **512 bytes** when UTF-8 encoded. The budget is advisory — heavier payloads are not protocol-invalid, but large inline strings waste calldata and signal the field is being misused as a hashed-payload slot. Implementations MAY enforce the budget at the write layer; the protocol does not require rejection.
- SHOULD carry an app-defined `version` or `v` key so consumers can detect shape changes. Unknown shapes MUST be ignored, not rejected, at the protocol layer.
- Current consumers: `AreaRegistration.metadata`, `Healthcheck.metadata`.

**`bytes32 *Hash` — content-addressable hash of a large/binary payload.**
Used when the payload cannot fit inline or is inherently binary (photos, polygon GeoJSON, evidence bundles).

- The `bytes32` value is whatever content-addressed hash the organization's storage adapter returns for the payload (IPFS CID, keccak256 of a canonical manifest, etc.).
- MUST use a purpose-named field — `photoHash`, `photosHash`, `evidenceBundleHash`, `boundariesHash` — never the generic name `metadataHash`. The field name tells readers what to fetch.
- `ZERO_BYTES32` MUST be accepted as "no payload of this type for this attestation."
- Current consumers: `AreaRegistration.boundariesHash`, `GardenerCheckin.photoHash`, `GardenerReport.photosHash`, `Healthcheck.photoHash`, `PublishedIntervention.evidenceBundleHash`.

**Mutually exclusive naming.** No schema field is named `metadataHash`. If both a small inline extension and a large hashed payload are needed on the same schema, they live in two distinct fields — `metadata` + a purpose-named `*Hash` — and readers can tell at a glance which is inline and which requires a fetch.
