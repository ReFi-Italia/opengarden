import type { EvidenceBundle, EvidenceBundleBuilderInput } from './types/evidence';

function extractAttestation(result: { uid: string; signedAttestation: Record<string, unknown>; onchainTimestamp: bigint }) {
  const message = result.signedAttestation.message as Record<string, unknown> | undefined;
  const claimedTimestamp = message?.time
    ? Number(message.time)
    : 0;

  return {
    uid: result.uid,
    contentHash: result.uid,
    claimedTimestamp,
    onchainTimestamp: Number(result.onchainTimestamp),
  };
}

export function buildEvidenceBundle(input: EvidenceBundleBuilderInput): EvidenceBundle {
  const bundle: EvidenceBundle = {
    interventionId: input.interventionId,
    areaUID: input.areaUID,
    attestations: {
      scheduled: extractAttestation(input.scheduled),
      checkin: extractAttestation(input.checkin),
      checkout: extractAttestation(input.checkout),
      report: extractAttestation(input.report),
      validation: {
        ...extractAttestation(input.validation),
        approved: input.validation.approved,
        qualityScore: input.validation.qualityScore,
      },
    },
    photos: {
      checkinPhoto: input.photos?.checkinPhoto,
      reportPhotos: input.photos?.reportPhotos,
      afterPhotos: input.photos?.afterPhotos,
    },
    bundleVersion: '1.0',
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
