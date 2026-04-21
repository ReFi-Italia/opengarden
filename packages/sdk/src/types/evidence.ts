import type { EVIDENCE_BUNDLE_VERSION } from "../constants";
import type {
	BundleIndexingResult,
	OnChainAttestationResult,
	TimestampedOffChainResult,
} from "./results";
import type { PublishedInterventionInput } from "./schemas";

/**
 * The raw signed EIP-712 attestation as returned by EAS SDK's
 * `Offchain.signOffchainAttestation`. Structure is:
 *
 * ```
 * {
 *   version: number,
 *   uid: string,
 *   message: {
 *     schema: string,
 *     recipient: string,
 *     attester?: string,     // present in EAS offchain v2+
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
 *   signer: string,
 * }
 * ```
 *
 * Stored verbatim in evidence bundles so the bundle is self-verifying — a
 * reader can recover the signer locally without refetching the attestation
 * from easscan. `bigint` fields are serialized as decimal strings in the
 * bundle JSON; `restoreBundleBigInts` rehydrates them before signature
 * verification.
 */
export type SignedOffchainAttestation = Record<string, unknown>;

export interface EvidenceBundleAttestation {
	uid: string;
	claimedTimestamp: number;
	onchainTimestamp: number;
	/** The EIP-712 signed attestation, verbatim. Makes bundles self-verifying. */
	signedAttestation: SignedOffchainAttestation;
}

export interface EvidenceBundleGardenerAttestation
	extends EvidenceBundleAttestation {
	attester: string;
}

export interface EvidenceBundle {
	interventionId: string;
	areaUID: string;
	attestations: {
		scheduled: EvidenceBundleAttestation;
		checkins: EvidenceBundleGardenerAttestation[];
		checkouts: EvidenceBundleGardenerAttestation[];
		reports: EvidenceBundleGardenerAttestation[];
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
	photos?: {
		checkinPhotos?: string[];
		reportPhotos?: string;
		afterPhotos?: string;
	};
}

export type FinalizeInterventionInput = EvidenceBundleBuilderInput &
	Omit<
		PublishedInterventionInput,
		"areaUID" | "interventionId" | "evidenceBundleHash"
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
