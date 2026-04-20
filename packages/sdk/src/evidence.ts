import { EVIDENCE_BUNDLE_VERSION } from "./constants";
import { OpenGardenError, OpenGardenErrorCode } from "./errors";
import type {
	EvidenceBundle,
	EvidenceBundleBuilderInput,
	EvidenceBundleGardenerAttestation,
} from "./types/evidence";

function extractAttestation(result: {
	uid: string;
	signedAttestation: Record<string, unknown>;
	onchainTimestamp: bigint;
}) {
	const message = result.signedAttestation.message as
		| Record<string, unknown>
		| undefined;
	const claimedTimestamp = message?.time ? Number(message.time) : 0;

	return {
		uid: result.uid,
		contentHash: result.uid,
		claimedTimestamp,
		onchainTimestamp: Number(result.onchainTimestamp),
	};
}

function extractGardenerAttestation(
	result: {
		uid: string;
		attester?: string;
		signedAttestation: Record<string, unknown>;
		onchainTimestamp: bigint;
	},
	role: "checkin" | "checkout" | "report",
	crewIndex: number,
): EvidenceBundleGardenerAttestation {
	const base = extractAttestation(result);
	// Prefer the top-level attester field (populated by signAndTimestamp).
	// Fall back to legacy locations in signedAttestation for pre-0.2 results.
	const message = result.signedAttestation.message as
		| Record<string, unknown>
		| undefined;
	const attester =
		result.attester ??
		(result.signedAttestation.signer as string | undefined) ??
		(result.signedAttestation.attester as string | undefined) ??
		(message?.attester as string | undefined);
	if (!attester) {
		throw new OpenGardenError(
			OpenGardenErrorCode.INVALID_INPUT,
			`Crew member ${crewIndex} ${role} (uid=${result.uid}) is missing signer/attester`,
		);
	}
	return { ...base, attester };
}

export function buildEvidenceBundle(
	input: EvidenceBundleBuilderInput,
): EvidenceBundle {
	return {
		interventionId: input.interventionId,
		areaUID: input.areaUID,
		attestations: {
			scheduled: extractAttestation(input.scheduled),
			checkins: input.crew.map((m, i) =>
				extractGardenerAttestation(m.checkin, "checkin", i),
			),
			checkouts: input.crew.map((m, i) =>
				extractGardenerAttestation(m.checkout, "checkout", i),
			),
			reports: input.crew.map((m, i) =>
				extractGardenerAttestation(m.report, "report", i),
			),
			validation: {
				...extractAttestation(input.validation),
				approved: input.validation.approved,
				qualityScore: input.validation.qualityScore,
			},
		},
		photos: {
			checkinPhotos: input.photos?.checkinPhotos,
			reportPhotos: input.photos?.reportPhotos,
			afterPhotos: input.photos?.afterPhotos,
		},
		bundleVersion: EVIDENCE_BUNDLE_VERSION,
	};
}
