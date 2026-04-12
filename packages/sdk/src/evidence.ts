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

function extractGardenerAttestation(result: {
	uid: string;
	signedAttestation: Record<string, unknown>;
	onchainTimestamp: bigint;
}): EvidenceBundleGardenerAttestation {
	const base = extractAttestation(result);
	const message = result.signedAttestation.message as
		| Record<string, unknown>
		| undefined;
	const attester =
		(result.signedAttestation.signer as string | undefined) ??
		(message?.attester as string | undefined) ??
		"";
	return { ...base, attester };
}

export function buildEvidenceBundle(
	input: EvidenceBundleBuilderInput,
): EvidenceBundle {
	const bundle: EvidenceBundle = {
		interventionId: input.interventionId,
		areaUID: input.areaUID,
		attestations: {
			scheduled: extractAttestation(input.scheduled),
			checkins: input.crew.map((m) => extractGardenerAttestation(m.checkin)),
			checkouts: input.crew.map((m) => extractGardenerAttestation(m.checkout)),
			reports: input.crew.map((m) => extractGardenerAttestation(m.report)),
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
		bundleVersion: "2.0",
	};

	if (input.healthcheckBefore) {
		bundle.attestations.healthcheckBefore = {
			uid: input.healthcheckBefore.uid,
			score: input.healthcheckBefore.score,
			onchainTimestamp: Number(input.healthcheckBefore.onchainTimestamp),
		};
	}

	if (input.healthcheckAfter) {
		bundle.attestations.healthcheckAfter = {
			uid: input.healthcheckAfter.uid,
			score: input.healthcheckAfter.score,
			onchainTimestamp: Number(input.healthcheckAfter.onchainTimestamp),
		};
	}

	return bundle;
}
