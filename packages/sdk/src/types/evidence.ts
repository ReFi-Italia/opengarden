import type { EVIDENCE_BUNDLE_VERSION } from "../constants";
import type {
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
		healthcheckBefore?: EvidenceBundleHealthcheck;
		healthcheckAfter?: EvidenceBundleHealthcheck;
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
	healthcheckBefore?: TimestampedOffChainResult & { score: number };
	healthcheckAfter?: TimestampedOffChainResult & { score: number };
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
	indexedCount: number;
	publication: OnChainAttestationResult;
}
