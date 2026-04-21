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
		claimedTimestamp,
		onchainTimestamp: Number(result.onchainTimestamp),
		signedAttestation: result.signedAttestation,
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
		},
		photos: {
			checkinPhotos: input.photos?.checkinPhotos,
			reportPhotos: input.photos?.reportPhotos,
			afterPhotos: input.photos?.afterPhotos,
		},
		bundleVersion: EVIDENCE_BUNDLE_VERSION,
	};
}

/**
 * JSON.stringify replacer that serializes `bigint` values as decimal strings.
 * Evidence bundles embed raw signed EIP-712 attestations whose `message.time`
 * and `message.expirationTime` fields are `bigint`; without this replacer
 * `JSON.stringify` throws.
 */
export function bundleJsonReplacer(_key: string, value: unknown): unknown {
	return typeof value === "bigint" ? value.toString() : value;
}

/**
 * Rehydrate `bigint` fields inside the embedded `signedAttestation` of every
 * bundle entry. Bundles are serialized with bigints as decimal strings (see
 * `bundleJsonReplacer`); consumers that want to re-verify EIP-712 signatures
 * must restore the bigints first so the typed-data hash matches what was
 * originally signed.
 *
 * Mutates the bundle in place **and** returns it for chaining convenience.
 * Idempotent — fields already of type `bigint` are left alone.
 */
export function restoreBundleBigInts(bundle: EvidenceBundle): EvidenceBundle {
	const entries = [
		bundle.attestations.scheduled,
		...bundle.attestations.checkins,
		...bundle.attestations.checkouts,
		...bundle.attestations.reports,
	];
	for (const entry of entries) {
		restoreSignedAttestationBigInts(entry.signedAttestation);
	}
	return bundle;
}

function restoreSignedAttestationBigInts(
	sig: Record<string, unknown>,
): Record<string, unknown> {
	const message = sig.message as Record<string, unknown> | undefined;
	if (!message) return sig;
	for (const key of ["time", "expirationTime", "nonce"] as const) {
		const v = message[key];
		if (typeof v === "string" && /^\d+$/.test(v)) {
			message[key] = BigInt(v);
		}
	}
	return sig;
}
