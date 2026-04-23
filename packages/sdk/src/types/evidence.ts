import type { EVIDENCE_BUNDLE_VERSION } from "../constants";
import type {
	CheckinActivityPayload,
	CheckoutActivityPayload,
	ReportActivityPayload,
	ScheduleActivityPayload,
} from "./attestation";
import type {
	BundleIndexingResult,
	OnChainAttestationResult,
	TimestampedOffChainResult,
} from "./results";
import type { InterventionInput } from "./schemas";

/**
 * The raw signed EIP-712 attestation as returned by EAS SDK's
 * `Offchain.signOffchainAttestation`, with `signer` injected. Structure:
 *
 * ```
 * {
 *   version: number,
 *   uid: string,
 *   signer: string,
 *   message: {
 *     schema: string,
 *     recipient: string,
 *     time: bigint,
 *     expirationTime: bigint,
 *     revocable: boolean,
 *     refUID: string,
 *     data: string,
 *     salt?: string,
 *     nonce?: bigint,
 *     version?: number,
 *   },
 *   signature: { r: string, s: string, v: number },
 * }
 * ```
 *
 * Stored verbatim in evidence bundles so the bundle is self-verifying.
 * `bigint` fields are serialized as decimal strings in the bundle JSON;
 * `restoreBundleBigInts` rehydrates them before signature verification.
 */
export type SignedOffchainAttestation = Record<string, unknown>;

interface BaseBundleActivity {
	uid: string;
	/** Authoritative signer — must match `signedAttestation.signer` and the recovered signer. */
	signer: string;
	/** Self-reported Unix seconds from the EIP-712 envelope's `message.time`. */
	claimedTimestamp: number;
	/** Authoritative on-chain block timestamp. */
	onchainTimestamp: number;
	signedAttestation: SignedOffchainAttestation;
}

export type ScheduleBundleActivity = BaseBundleActivity & {
	type: "schedule";
	payload: ScheduleActivityPayload;
};

export type CheckinBundleActivity = BaseBundleActivity & {
	type: "checkin";
	payload: CheckinActivityPayload;
};

export type CheckoutBundleActivity = BaseBundleActivity & {
	type: "checkout";
	payload: CheckoutActivityPayload;
};

export type ReportBundleActivity = BaseBundleActivity & {
	type: "report";
	payload: ReportActivityPayload;
};

/** Activities that appear inside an intervention's evidence bundle (§5.2). Healthcheck is area-scoped and is NOT bundled. */
export type BundleActivity =
	| ScheduleBundleActivity
	| CheckinBundleActivity
	| CheckoutBundleActivity
	| ReportBundleActivity;

export interface EvidenceBundle {
	interventionId: string;
	/** UID of the AreaRegistration the intervention belongs to. Sourced at bundle-build time from the schedule activity's `payload.areaUID`. */
	areaUID: string;
	/** Flat activities array — sorted ascending by `onchainTimestamp`. Solo and crew jobs use the same shape. */
	activities: BundleActivity[];
	bundleVersion: typeof EVIDENCE_BUNDLE_VERSION;
}

export interface EvidenceBundleBuilderInput {
	interventionId: string;
	areaUID: string;
	/** Schedule activity result — MUST have `type === "schedule"`. */
	schedule: TimestampedOffChainResult;
	/** Flat list of crew activities across all members. Order irrelevant — builder sorts by `onchainTimestamp`. */
	crewActivities: TimestampedOffChainResult[];
}

export type FinalizeInterventionInput = EvidenceBundleBuilderInput &
	Omit<
		InterventionInput,
		"areaUID" | "interventionId" | "evidenceBundleHash"
	>;

export interface FinalizeInterventionResult {
	bundle: EvidenceBundle;
	/**
	 * keccak256 of the canonical bundle bytes (`serializeEvidenceBundle(bundle).hash`).
	 * Committed on-chain as `Intervention.evidenceBundleHash`. Callers can re-derive
	 * canonical bytes at any time via `serializeEvidenceBundle(bundle)` — what to
	 * persist and how is entirely the app's choice.
	 */
	evidenceBundleHash: string;
	/** Count of `indexingResults` with `ok === true`. Convenience for simple dashboards. */
	indexedCount: number;
	/** Per-activity indexer submission status with `uid`, `role`, `activityIndex?`, `ok`, `error?`. */
	indexingResults: BundleIndexingResult[];
	publication: OnChainAttestationResult;
}
