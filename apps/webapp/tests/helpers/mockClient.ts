import {
	ActivityType,
	buildCheckinPayload,
	buildCheckoutPayload,
	buildHealthcheckPayload,
	buildReportPayload,
	buildSchedulePayload,
	encodeActivityFromPayload,
	type EvidenceBundle,
	type EvidenceBundleVerification,
	type FinalizeInterventionInput,
	type FinalizeInterventionResult,
	hashInterventionScope,
	initEncoders,
	type OnChainAttestationResult,
	type OpenGardenClient,
	type ScheduleActivityInput,
	type CheckinActivityInput,
	type CheckoutActivityInput,
	type ReportActivityInput,
	type HealthcheckActivityInput,
	type TimestampedOffChainResult,
	validateFinalizeInput,
} from "@refi-italia/opengarden";

import type { OpenGardenContext } from "@/lib/openGardenClient";

const MOCK_ATTESTER = "0x" + "a".repeat(40);
const MOCK_CHAIN_ID = 11_155_420;
const MOCK_BUNDLE_HASH = "0x" + "b".repeat(64);

let _uidCounter = Date.now();
const nextUid = () => {
	_uidCounter += 1;
	return ("0x" + _uidCounter.toString(16).padStart(64, "0")) as string;
};

const nextTimestamp = (() => {
	let t = 1_700_000_000;
	return () => {
		t += 60;
		return BigInt(t);
	};
})();

export function resetMockClientState() {
	// uid counter must NOT reset across tests in a shared-DB run
}

/**
 * Idempotent — must be called once before any mock method runs because
 * `encodeActivityFromPayload` lazy-loads `eas-sdk`'s SchemaEncoder. Call
 * from `beforeAll` in every test file that uses the mock.
 */
export const ensureMockReady = () => initEncoders();

type EnvelopeOptions = {
	type: ActivityType;
	refUID: string;
	payload: Record<string, unknown>;
	time?: bigint;
	signer?: string;
	revocable?: boolean;
};

/**
 * Builds a TimestampedOffChainResult that is byte-coherent with the SDK's
 * own format: `signedAttestation.message.data` is real ABI-encoded
 * `(uint8 activityType, bytes32 payloadHash)`, and `payloadHash` is a real
 * keccak256 over the canonical-JSON of `payload`. So preflight's
 * `assertPayloadHash` exercises a real round-trip rather than skipping.
 */
function buildResult(opts: EnvelopeOptions): TimestampedOffChainResult {
	const uid = nextUid();
	const time = opts.time ?? nextTimestamp();
	const signer = opts.signer ?? MOCK_ATTESTER;
	const { data } = encodeActivityFromPayload(opts.type, opts.payload);
	return {
		uid,
		type: activityTypeName(opts.type),
		attester: signer,
		payload: opts.payload,
		signedAttestation: {
			version: 1,
			uid,
			signer,
			message: {
				schema: "0xActivitySchemaUID",
				recipient: "0x" + "0".repeat(40),
				time,
				expirationTime: 0n,
				revocable: opts.revocable ?? opts.type === ActivityType.Schedule,
				refUID: opts.refUID,
				data,
			},
			signature: { r: "0x" + "2".repeat(64), s: "0x" + "3".repeat(64), v: 27 },
		},
		timestampTxHash: nextUid(),
		onchainTimestamp: time + 15n,
		// biome-ignore lint/suspicious/noExplicitAny: receipt not consumed
		timestampReceipt: {} as any,
	};
}

function activityTypeName(t: ActivityType): TimestampedOffChainResult["type"] {
	switch (t) {
		case ActivityType.Schedule:
			return "schedule";
		case ActivityType.Checkin:
			return "checkin";
		case ActivityType.Checkout:
			return "checkout";
		case ActivityType.Report:
			return "report";
		case ActivityType.Healthcheck:
			return "healthcheck";
		default:
			throw new Error(`Unknown ActivityType ${t}`);
	}
}

export function makeOnChainResult(): OnChainAttestationResult {
	return {
		uid: nextUid(),
		txHash: nextUid(),
		// biome-ignore lint/suspicious/noExplicitAny: receipt not consumed
		receipt: {} as any,
	};
}

export function makeBundleVerification(
	overrides: Partial<EvidenceBundleVerification> = {},
): EvidenceBundleVerification {
	return {
		valid: true,
		bundleHashValid: true,
		bundleVersionValid: true,
		signaturesValid: true,
		payloadIntegrityValid: true,
		timestampsVerified: true,
		interventionScopeValid: true,
		temporalOrderValid: true,
		executionDateBracketed: true,
		checks: [],
		...overrides,
	};
}

export type MockClientCalls = {
	scheduleIntervention: TimestampedOffChainResult[];
	checkin: TimestampedOffChainResult[];
	checkout: TimestampedOffChainResult[];
	submitReport: TimestampedOffChainResult[];
	recordHealthcheck: TimestampedOffChainResult[];
	registerArea: OnChainAttestationResult[];
	finalizeIntervention: FinalizeInterventionInput[];
	verifyEvidenceBundle: { uid: string; bundleBytes: Uint8Array }[];
};

type MockOverrides = {
	scheduleIntervention?: TimestampedOffChainResult;
	checkin?: TimestampedOffChainResult;
	checkout?: TimestampedOffChainResult;
	submitReport?: TimestampedOffChainResult;
	recordHealthcheck?: TimestampedOffChainResult;
	registerArea?: OnChainAttestationResult;
	finalizeIntervention?: Partial<FinalizeInterventionResult>;
	verifyEvidenceBundle?: Partial<EvidenceBundleVerification>;
	/**
	 * When true, `finalizeIntervention` skips `validateFinalizeInput` and
	 * accepts any input. Use only for tests that intentionally feed garbage
	 * to inspect downstream handling.
	 */
	skipFinalizePreflight?: boolean;
};

export function makeMockClient(
	overrides: MockOverrides = {},
): { client: OpenGardenClient; calls: MockClientCalls } {
	const calls: MockClientCalls = {
		scheduleIntervention: [],
		checkin: [],
		checkout: [],
		submitReport: [],
		recordHealthcheck: [],
		registerArea: [],
		finalizeIntervention: [],
		verifyEvidenceBundle: [],
	};

	const client = {
		scheduleIntervention: async (input: ScheduleActivityInput) => {
			// `buildSchedulePayload` runs `validateScheduleActivity` and returns
			// the canonical payload. Bad inputs throw synchronously — same
			// behavior as the real SDK.
			const payload = buildSchedulePayload(input);
			const result =
				overrides.scheduleIntervention ??
				buildResult({
					type: ActivityType.Schedule,
					refUID: hashInterventionScope(input.interventionId),
					payload: payload as unknown as Record<string, unknown>,
					time: input.time != null ? toBigint(input.time) : undefined,
					signer: input.crewLead, // schedule recipient = crew lead; signer = org wallet
					revocable: true,
				});
			calls.scheduleIntervention.push(result);
			return result;
		},

		checkin: async (input: CheckinActivityInput) => {
			const payload = buildCheckinPayload(input);
			const result =
				overrides.checkin ??
				buildResult({
					type: ActivityType.Checkin,
					refUID: hashInterventionScope(input.interventionId),
					payload: payload as unknown as Record<string, unknown>,
					time: input.time != null ? toBigint(input.time) : undefined,
					revocable: false,
				});
			calls.checkin.push(result);
			return result;
		},

		checkout: async (input: CheckoutActivityInput) => {
			const payload = buildCheckoutPayload(input);
			const result =
				overrides.checkout ??
				buildResult({
					type: ActivityType.Checkout,
					refUID: hashInterventionScope(input.interventionId),
					payload: payload as unknown as Record<string, unknown>,
					time: input.time != null ? toBigint(input.time) : undefined,
					revocable: false,
				});
			calls.checkout.push(result);
			return result;
		},

		submitReport: async (input: ReportActivityInput) => {
			const payload = buildReportPayload(input);
			const result =
				overrides.submitReport ??
				buildResult({
					type: ActivityType.Report,
					refUID: hashInterventionScope(input.interventionId),
					payload: payload as unknown as Record<string, unknown>,
					time: input.time != null ? toBigint(input.time) : undefined,
					revocable: false,
				});
			calls.submitReport.push(result);
			return result;
		},

		recordHealthcheck: async (input: HealthcheckActivityInput) => {
			const payload = buildHealthcheckPayload(input);
			const result =
				overrides.recordHealthcheck ??
				buildResult({
					type: ActivityType.Healthcheck,
					// Healthchecks are area-scoped per spec §3.2.5 — refUID = AreaRegistration UID.
					refUID: input.areaUID,
					payload: payload as unknown as Record<string, unknown>,
					time: input.time != null ? toBigint(input.time) : undefined,
					revocable: false,
				});
			calls.recordHealthcheck.push(result);
			return result;
		},

		registerArea: async () => {
			const result = overrides.registerArea ?? makeOnChainResult();
			calls.registerArea.push(result);
			return result;
		},

		finalizeIntervention: async (input: FinalizeInterventionInput) => {
			calls.finalizeIntervention.push(input);

			if (!overrides.skipFinalizePreflight) {
				// Run real SDK preflight against the rehydrated input. If the
				// webapp's rehydration produces a malformed shape (refUID off,
				// payload hash mismatch, missing crew, etc.) this throws — the
				// same way the real SDK would.
				const issues = validateFinalizeInput(input);
				if (issues.length > 0) {
					const first = issues[0];
					throw new Error(
						`mock finalizeIntervention preflight failed: [${first.code}] ${first.message}`,
					);
				}
			}

			const bundle: EvidenceBundle = {
				interventionId: input.interventionId,
				areaUID: input.areaUID,
				activities: [],
				bundleVersion: "0.1.0",
			};
			const result: FinalizeInterventionResult = {
				bundle,
				evidenceBundleHash: MOCK_BUNDLE_HASH,
				indexedCount: input.crewActivities.length + 1,
				indexingResults: [],
				publication: makeOnChainResult(),
				...overrides.finalizeIntervention,
			};
			return result;
		},

		verifyEvidenceBundle: async (uid: string, bundleBytes: Uint8Array) => {
			calls.verifyEvidenceBundle.push({ uid, bundleBytes });
			return makeBundleVerification(overrides.verifyEvidenceBundle);
		},
		// biome-ignore lint/suspicious/noExplicitAny: shimming partial OpenGardenClient surface
	} as any as OpenGardenClient;

	return { client, calls };
}

function toBigint(t: Date | bigint): bigint {
	if (typeof t === "bigint") return t;
	return BigInt(Math.floor(t.getTime() / 1000));
}

export function makeMockContext(
	overrides?: MockOverrides,
): { context: OpenGardenContext; calls: MockClientCalls } {
	const { client, calls } = makeMockClient(overrides);
	return {
		context: {
			client,
			chainId: MOCK_CHAIN_ID,
			attesterWallet: MOCK_ATTESTER,
		},
		calls,
	};
}

export const MOCK_CHAIN = {
	id: MOCK_CHAIN_ID,
	attesterWallet: MOCK_ATTESTER,
	bundleHash: MOCK_BUNDLE_HASH,
};

// Legacy export — kept so existing imports of makeTimestampedResult don't
// break. New tests should not use this directly; let the mock methods build
// realistic results from validated inputs.
export function makeTimestampedResult<T extends ActivityType>(
	type: T,
	payload: Record<string, unknown>,
	signer = MOCK_ATTESTER,
): TimestampedOffChainResult {
	return buildResult({
		type,
		refUID: "0x" + "1".repeat(64),
		payload,
		signer,
	});
}
