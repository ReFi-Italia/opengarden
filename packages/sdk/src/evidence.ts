import { keccak256, toUtf8Bytes } from "ethers";
import { EVIDENCE_BUNDLE_VERSION } from "./constants";
import { OpenGardenError, OpenGardenErrorCode } from "./errors";
import type {
	CheckinActivityPayload,
	CheckoutActivityPayload,
	ReportActivityPayload,
	ScheduleActivityPayload,
} from "./types/attestation";
import type {
	BundleActivity,
	EvidenceBundle,
	EvidenceBundleBuilderInput,
} from "./types/evidence";
import type { TimestampedOffChainResult } from "./types/results";

function toBundleEntry(result: TimestampedOffChainResult): BundleActivity {
	const message = result.signedAttestation.message as
		| Record<string, unknown>
		| undefined;
	const claimedTimestamp = message?.time ? Number(message.time) : 0;

	const base = {
		uid: result.uid,
		signer: result.attester,
		claimedTimestamp,
		onchainTimestamp: Number(result.onchainTimestamp),
		signedAttestation: result.signedAttestation,
	};

	switch (result.type) {
		case "schedule":
			return {
				...base,
				type: "schedule",
				payload: result.payload as unknown as ScheduleActivityPayload,
			};
		case "checkin":
			return {
				...base,
				type: "checkin",
				payload: result.payload as unknown as CheckinActivityPayload,
			};
		case "checkout":
			return {
				...base,
				type: "checkout",
				payload: result.payload as unknown as CheckoutActivityPayload,
			};
		case "report":
			return {
				...base,
				type: "report",
				payload: result.payload as unknown as ReportActivityPayload,
			};
		case "healthcheck":
			throw new OpenGardenError(
				OpenGardenErrorCode.INVALID_INPUT,
				`Healthcheck activities are area-scoped and MUST NOT appear in intervention evidence bundles (uid=${result.uid})`,
			);
		case "unspecified":
			throw new OpenGardenError(
				OpenGardenErrorCode.INVALID_INPUT,
				`Activity of type "unspecified" cannot be bundled (uid=${result.uid})`,
			);
	}
}

/**
 * Builds a §5.2-compliant evidence bundle from the writer-side activity
 * results. Activities are sorted ascending by `onchainTimestamp`. The schedule
 * activity is required (`type === "schedule"`) and is included alongside the
 * crew activities in the flat `activities` array.
 */
export function buildEvidenceBundle(
	input: EvidenceBundleBuilderInput,
): EvidenceBundle {
	if (input.schedule.type !== "schedule") {
		throw new OpenGardenError(
			OpenGardenErrorCode.INVALID_INPUT,
			`buildEvidenceBundle: input.schedule must be a schedule Activity (got type="${input.schedule.type}")`,
		);
	}

	const entries: BundleActivity[] = [
		toBundleEntry(input.schedule),
		...input.crewActivities.map(toBundleEntry),
	];

	entries.sort((a, b) => a.onchainTimestamp - b.onchainTimestamp);

	return {
		interventionId: input.interventionId,
		areaUID: input.areaUID,
		activities: entries,
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
 * Serialize an evidence bundle to its canonical byte sequence and compute
 * `keccak256(bytes)` — the value committed on-chain as
 * `Intervention.evidenceBundleHash`. Publishers persist `bytes` in whatever
 * storage they expose; verifiers fetch those bytes and recompute the hash to
 * verify integrity (spec §5.4 step 2).
 */
export function serializeEvidenceBundle(
	bundle: EvidenceBundle,
): { bytes: Uint8Array; hash: string } {
	const bytes = toUtf8Bytes(JSON.stringify(bundle, bundleJsonReplacer));
	return { bytes, hash: keccak256(bytes) };
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
	for (const entry of bundle.activities) {
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
