import type { EVIDENCE_BUNDLE_VERSION } from "../constants";
import type {
	BundleIndexingResult,
	OnChainAttestationResult,
	TimestampedOffChainResult,
} from "./results";
import type { PublishedInterventionInput } from "./schemas";

export interface EvidenceBundleAttestation {
	uid: string;
	contentHash: string;
	claimedTimestamp: number;
	onchainTimestamp: number;
}

export interface EvidenceBundleGardenerAttestation
	extends EvidenceBundleAttestation {
	attester: string;
}

export interface EvidenceBundleValidation extends EvidenceBundleAttestation {
	approved: boolean;
	qualityScore: number;
}

export interface EvidenceBundleHealthcheck {
	uid: string;
	score: number;
	/** Baseline (pre-intervention) score from off-chain metadata. Absent for standalone site checks. */
	baselineScore?: number;
	onchainTimestamp: number;
}

export interface EvidenceBundle {
	interventionId: string;
	areaUID: string;
	attestations: {
		scheduled: EvidenceBundleAttestation;
		checkins: EvidenceBundleGardenerAttestation[];
		checkouts: EvidenceBundleGardenerAttestation[];
		reports: EvidenceBundleGardenerAttestation[];
		validation: EvidenceBundleValidation;
		healthcheck?: EvidenceBundleHealthcheck;
	};
	photos: {
		checkinPhotos?: string[];
		reportPhotos?: string;
		afterPhotos?: string;
	};
	bundleVersion: typeof EVIDENCE_BUNDLE_VERSION;
}

export interface EvidenceBundleBuilderInput {
	interventionId: string;
	areaUID: string;
	scheduled: TimestampedOffChainResult;
	crew: Array<{
		checkin: TimestampedOffChainResult;
		checkout: TimestampedOffChainResult;
		report: TimestampedOffChainResult;
	}>;
	validation: TimestampedOffChainResult & {
		approved: boolean;
		qualityScore: number;
	};
	healthcheck?: TimestampedOffChainResult & { score: number; baselineScore?: number };
	photos?: {
		checkinPhotos?: string[];
		reportPhotos?: string;
		afterPhotos?: string;
	};
}

export type FinalizeInterventionInput = EvidenceBundleBuilderInput &
	Omit<
		PublishedInterventionInput,
		"areaUID" | "interventionId" | "evidenceBundleHash" | "offchainCount"
	>;

export interface FinalizeInterventionResult {
	bundle: EvidenceBundle;
	evidenceBundleHash: string;
	/** Count of `indexingResults` with `ok === true`. Convenience for simple dashboards. */
	indexedCount: number;
	/** Per-attestation indexer submission status with `uid`, `role`, `crewIndex?`, `ok`, `error?`. */
	indexingResults: BundleIndexingResult[];
	publication: OnChainAttestationResult;
}
