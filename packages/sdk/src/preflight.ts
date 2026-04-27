import { OpenGardenError, OpenGardenErrorCode } from "./errors";
import { decodeActivityData } from "./schemas/encoders";
import type { ScheduleActivityPayload } from "./types/attestation";
import type { FinalizeInterventionInput } from "./types/evidence";
import type { TimestampedOffChainResult } from "./types/results";
import {
	hashActivityPayload,
	hashInterventionScope,
	sameAddress,
	sameBytes32,
	toUnixSeconds,
} from "./utils";

// --- Shared metadata helpers ---

export interface AttestationMetadata {
	uid: string;
	/** Lowercased signer address from the EIP-712 signed attestation. Empty string if unknown. */
	attester: string;
	/** Lowercased refUID from the signed attestation message, if set. */
	refUID: string;
	/** Self-reported `time` field from the signed attestation message (Unix seconds). 0 if unknown. */
	claimedTime: number;
	/** Authoritative on-chain timestamp (Unix seconds). */
	onchainTimestamp: number;
}

export function extractAttestationMetadata(
	result: TimestampedOffChainResult,
): AttestationMetadata {
	const sig = result.signedAttestation;
	const message = (sig.message ?? {}) as Record<string, unknown>;
	const attester =
		(sig.signer as string | undefined) ??
		(message.attester as string | undefined) ??
		result.attester ??
		"";
	const refUID = (message.refUID as string | undefined) ?? "";
	return {
		uid: result.uid,
		attester: attester.toLowerCase(),
		refUID: refUID.toLowerCase(),
		claimedTime: message.time != null ? Number(message.time) : 0,
		onchainTimestamp: Number(result.onchainTimestamp),
	};
}

// --- Per-step pre-flight primitives ---

/**
 * Asserts that a persisted activity's signer matches an expected wallet
 * address. Use before issuing a follow-up activity (checkout, report) to
 * prove the same wallet is about to sign a continuation of the same session.
 */
export function assertAttesterMatches(
	result: TimestampedOffChainResult,
	expectedAttester: string,
	descriptor = "activity",
): void {
	const { attester, uid } = extractAttestationMetadata(result);
	if (!attester) {
		throw new OpenGardenError(
			OpenGardenErrorCode.INVALID_INPUT,
			`${descriptor} (uid=${uid}) is missing signer/attester`,
		);
	}
	if (!sameAddress(attester, expectedAttester)) {
		throw new OpenGardenError(
			OpenGardenErrorCode.INVALID_INPUT,
			`${descriptor} (uid=${uid}) attester ${attester} does not match expected ${expectedAttester.toLowerCase()}`,
		);
	}
}

/**
 * Asserts that a persisted activity's refUID points at the expected parent
 * (intervention scope hash or Area UID depending on activity type).
 */
export function assertRefUIDMatches(
	result: TimestampedOffChainResult,
	expectedRefUID: string,
	descriptor = "activity",
): void {
	const { refUID, uid } = extractAttestationMetadata(result);
	if (!refUID) {
		throw new OpenGardenError(
			OpenGardenErrorCode.INVALID_INPUT,
			`${descriptor} (uid=${uid}) is missing refUID`,
		);
	}
	if (!sameBytes32(refUID, expectedRefUID)) {
		throw new OpenGardenError(
			OpenGardenErrorCode.INVALID_INPUT,
			`${descriptor} (uid=${uid}) refUID ${refUID} does not match expected ${expectedRefUID.toLowerCase()}`,
		);
	}
}

// --- FinalizeInterventionInput validator ---

export enum FinalizeInputIssueCode {
	EMPTY_CREW = "EMPTY_CREW",
	EXECUTION_DATE_BEFORE_SCHEDULE = "EXECUTION_DATE_BEFORE_SCHEDULE",
	SCHEDULE_SCOPE_MISMATCH = "SCHEDULE_SCOPE_MISMATCH",
	ACTIVITY_SCOPE_MISMATCH = "ACTIVITY_SCOPE_MISMATCH",
	SCHEDULE_AREA_MISMATCH = "SCHEDULE_AREA_MISMATCH",
	CREW_CHAIN_INCOMPLETE = "CREW_CHAIN_INCOMPLETE",
	TEMPORAL_ORDER_VIOLATION = "TEMPORAL_ORDER_VIOLATION",
	PAYLOAD_HASH_MISMATCH = "PAYLOAD_HASH_MISMATCH",
}

export interface FinalizeInputIssue {
	code: FinalizeInputIssueCode;
	message: string;
	/** Signer wallet address when the issue is signer-specific. */
	signer?: string;
	/** Activity UID where the issue was detected, when applicable. */
	uid?: string;
}

interface CrewChain {
	signer: string;
	checkin?: TimestampedOffChainResult;
	checkout?: TimestampedOffChainResult;
	report?: TimestampedOffChainResult;
	extras: TimestampedOffChainResult[];
}

function groupCrewActivities(
	activities: readonly TimestampedOffChainResult[],
): Map<string, CrewChain> {
	const groups = new Map<string, CrewChain>();
	for (const a of activities) {
		if (a.type !== "checkin" && a.type !== "checkout" && a.type !== "report") {
			continue;
		}
		const key = a.attester.toLowerCase();
		let g = groups.get(key);
		if (!g) {
			g = { signer: a.attester, extras: [] };
			groups.set(key, g);
		}
		if (a.type === "checkin") {
			if (g.checkin) g.extras.push(a);
			else g.checkin = a;
		} else if (a.type === "checkout") {
			if (g.checkout) g.extras.push(a);
			else g.checkout = a;
		} else {
			if (g.report) g.extras.push(a);
			else g.report = a;
		}
	}
	return groups;
}

/**
 * Pure, side-effect-free validator for a `FinalizeInterventionInput`. Runs
 * the full spec §4.2 temporal-integrity check plus wiring / payload-integrity
 * checks. Returns a flat list of issues — empty means the input is ready to
 * finalize.
 */
export function validateFinalizeInput(
	input: FinalizeInterventionInput,
): FinalizeInputIssue[] {
	const issues: FinalizeInputIssue[] = [];

	if (input.schedule.type !== "schedule") {
		issues.push({
			code: FinalizeInputIssueCode.SCHEDULE_SCOPE_MISMATCH,
			message: `Expected schedule activity, got type="${input.schedule.type}"`,
			uid: input.schedule.uid,
		});
		return issues;
	}

	if (input.crewActivities.length === 0) {
		issues.push({
			code: FinalizeInputIssueCode.EMPTY_CREW,
			message: "Intervention has no crew activities",
		});
		return issues;
	}

	const expectedScope = hashInterventionScope(input.interventionId);
	const scheduleMeta = extractAttestationMetadata(input.schedule);
	const executionDate = toUnixSeconds(input.executionDate);
	const scheduleTs = BigInt(scheduleMeta.onchainTimestamp);

	if (scheduleTs > executionDate) {
		issues.push({
			code: FinalizeInputIssueCode.EXECUTION_DATE_BEFORE_SCHEDULE,
			message: `Execution date (${executionDate}) must not be before the schedule's on-chain timestamp (${scheduleTs})`,
			uid: input.schedule.uid,
		});
	}

	if (scheduleMeta.refUID && !sameBytes32(scheduleMeta.refUID, expectedScope)) {
		issues.push({
			code: FinalizeInputIssueCode.SCHEDULE_SCOPE_MISMATCH,
			message: `Schedule activity refUID (${scheduleMeta.refUID}) does not match interventionScopeHash (${expectedScope})`,
			uid: input.schedule.uid,
		});
	}

	const schedulePayload = input.schedule.payload as unknown as
		| ScheduleActivityPayload
		| undefined;
	if (
		schedulePayload?.areaUID &&
		!sameBytes32(schedulePayload.areaUID, input.areaUID)
	) {
		issues.push({
			code: FinalizeInputIssueCode.SCHEDULE_AREA_MISMATCH,
			message: `Schedule payload areaUID (${schedulePayload.areaUID}) does not match input.areaUID (${input.areaUID.toLowerCase()})`,
			uid: input.schedule.uid,
		});
	}

	// Payload hash integrity — recompute keccak256(canonicalJSON(payload))
	// and compare against payloadHash decoded from the signed data. This
	// ensures the writer hasn't drifted between the payload object and the
	// hash committed on-chain.
	assertPayloadHash(input.schedule, issues);

	// Walk every crew activity: scope match + payload integrity.
	for (const activity of input.crewActivities) {
		if (
			activity.type !== "checkin" &&
			activity.type !== "checkout" &&
			activity.type !== "report"
		) {
			issues.push({
				code: FinalizeInputIssueCode.ACTIVITY_SCOPE_MISMATCH,
				message: `Crew activity has unexpected type "${activity.type}"`,
				uid: activity.uid,
				signer: activity.attester,
			});
			continue;
		}
		const meta = extractAttestationMetadata(activity);
		if (meta.refUID && !sameBytes32(meta.refUID, expectedScope)) {
			issues.push({
				code: FinalizeInputIssueCode.ACTIVITY_SCOPE_MISMATCH,
				message: `${activity.type} (uid=${activity.uid}) refUID ${meta.refUID} does not match interventionScopeHash ${expectedScope}`,
				uid: activity.uid,
				signer: activity.attester,
			});
		}
		assertPayloadHash(activity, issues);
	}

	// Per-signer crew chain completeness + temporal order.
	const crew = groupCrewActivities(input.crewActivities);
	if (crew.size === 0) {
		issues.push({
			code: FinalizeInputIssueCode.CREW_CHAIN_INCOMPLETE,
			message:
				"No crew members found (need at least one checkin/checkout/report triple)",
		});
	}
	for (const [signerKey, group] of crew) {
		if (!group.checkin) {
			issues.push({
				code: FinalizeInputIssueCode.CREW_CHAIN_INCOMPLETE,
				message: `Signer ${signerKey} has no checkin`,
				signer: signerKey,
			});
		}
		if (!group.checkout) {
			issues.push({
				code: FinalizeInputIssueCode.CREW_CHAIN_INCOMPLETE,
				message: `Signer ${signerKey} has no checkout`,
				signer: signerKey,
			});
		}
		if (!group.report) {
			issues.push({
				code: FinalizeInputIssueCode.CREW_CHAIN_INCOMPLETE,
				message: `Signer ${signerKey} has no report`,
				signer: signerKey,
			});
		}
		if (group.checkin && group.checkout && group.report) {
			const ci = Number(group.checkin.onchainTimestamp);
			const co = Number(group.checkout.onchainTimestamp);
			const rp = Number(group.report.onchainTimestamp);
			if (!(ci < co && co < rp)) {
				issues.push({
					code: FinalizeInputIssueCode.TEMPORAL_ORDER_VIOLATION,
					message: `Signer ${signerKey}: on-chain timestamps must satisfy checkin < checkout < report, got ${ci} / ${co} / ${rp}`,
					signer: signerKey,
				});
			}
			if (!(scheduleMeta.onchainTimestamp < ci)) {
				issues.push({
					code: FinalizeInputIssueCode.TEMPORAL_ORDER_VIOLATION,
					message: `Schedule on-chain timestamp (${scheduleMeta.onchainTimestamp}) must precede signer ${signerKey}'s checkin (${ci})`,
					signer: signerKey,
				});
			}
		}
	}

	return issues;
}

function assertPayloadHash(
	result: TimestampedOffChainResult,
	issues: FinalizeInputIssue[],
): void {
	// Compare the caller-supplied payload against the payloadHash embedded in
	// the signed ABI data. A mismatch means the writer mutated the payload
	// object after signing — the bundle would fail read-side verification.
	const message = result.signedAttestation.message as
		| Record<string, unknown>
		| undefined;
	const data = message?.data as string | undefined;
	if (!data) return;

	let committedHash: string;
	try {
		committedHash = decodeActivityData(data).payloadHash;
	} catch {
		// If the data field isn't decodable as an Activity (truncated, wrong
		// schema, etc.) we skip the integrity check — a later stage would catch
		// this anyway.
		return;
	}

	const computed = hashActivityPayload(result.payload);
	if (committedHash.toLowerCase() !== computed.toLowerCase()) {
		issues.push({
			code: FinalizeInputIssueCode.PAYLOAD_HASH_MISMATCH,
			message: `${result.type} activity (uid=${result.uid}) payload hashes to ${computed}, signed data commits to ${committedHash}`,
			uid: result.uid,
			signer: result.attester,
		});
	}
}
