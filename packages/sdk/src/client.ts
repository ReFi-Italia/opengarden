import type {
	EAS,
	SchemaRegistry,
} from "@ethereum-attestation-service/eas-sdk";
import type { Signer } from "ethers";
import {
	CHAIN_CONFIGS,
	SCHEMA_NAME_UID,
	ZERO_ADDRESS,
	ZERO_BYTES32,
} from "./constants";
import { OpenGardenError, OpenGardenErrorCode } from "./errors";
import {
	buildEvidenceBundle as buildBundle,
	bundleJsonReplacer,
	restoreBundleBigInts,
} from "./evidence";
import { getGraphqlUrl, getStoreUrl, submitToIndexer } from "./indexer";
import type { FinalizePolicy, VerifyPolicy } from "./policy";
import { STRICT_FINALIZE_POLICY, STRICT_VERIFY_POLICY } from "./policy";
import { validateFinalizeInput } from "./preflight";
import { SCHEMA_DEFINITIONS } from "./schemas/definitions";
import {
	buildCheckinPayload,
	buildCheckoutPayload,
	buildHealthcheckPayload,
	buildReportPayload,
	buildSchedulePayload,
	decodeAreaRegistration,
	decodeGardenerMilestone,
	decodeIntervention,
	encodeActivityData,
	encodeAreaRegistration,
	encodeGardenerMilestone,
	encodeIntervention,
	newSchemaEncoder,
	parseActivityDecodedDataJson,
} from "./schemas/encoders";
import type {
	Area,
	EvidenceBundleVerification,
	Intervention,
	Milestone,
} from "./types/attestation";
import type {
	ChainConfig,
	OpenGardenConfig,
	SchemaUIDs,
	StorageAdapter,
} from "./types/config";
import {
	ActivityType,
	type ActivityTypeName,
	activityTypeFromName,
	type SchemaName,
} from "./types/enums";
import type {
	EvidenceBundle,
	EvidenceBundleBuilderInput,
	FinalizeInterventionInput,
	FinalizeInterventionResult,
} from "./types/evidence";
import type {
	BundleIndexingResult,
	BundleIndexingRole,
	OnChainAttestationResult,
	SchemaRegistrationResult,
	TimestampedOffChainResult,
} from "./types/results";
import type {
	AreaRegistrationInput,
	CheckinActivityInput,
	CheckoutActivityInput,
	GardenerMilestoneInput,
	HealthcheckActivityInput,
	InterventionInput,
	ReportActivityInput,
	ScheduleActivityInput,
} from "./types/schemas";
import { hashActivityPayload, hashInterventionScope, toUnixSeconds } from "./utils";
import {
	type VerificationCheck,
	verifyBundleExecutionDateBracket,
	verifyBundleInterventionScope,
	verifyBundleOnChainTimestamps,
	verifyBundlePayloadIntegrity,
	verifyBundleSignatures,
	verifyBundleTemporalOrder,
	verifyBundleVersion,
} from "./verification";

function resolveChain(chain: OpenGardenConfig["chain"]): ChainConfig {
	if (typeof chain === "string") {
		if (!Object.hasOwn(CHAIN_CONFIGS, chain)) {
			throw new OpenGardenError(
				OpenGardenErrorCode.INVALID_INPUT,
				`Unknown chain name "${chain}". Known chains: ${Object.keys(
					CHAIN_CONFIGS,
				).join(", ")}. Pass a ChainConfig object for custom deployments.`,
			);
		}
		return CHAIN_CONFIGS[chain];
	}
	return chain;
}

export class OpenGardenClient {
	private readonly eas: EAS;
	private readonly registry: SchemaRegistry;
	private readonly signer: Signer;
	private readonly storage?: StorageAdapter;
	private readonly schemaUIDs: Partial<SchemaUIDs>;
	private readonly graphqlUrl: string | undefined;
	private readonly chainId: bigint;
	private readonly storeUrl: string | undefined;

	constructor(config: OpenGardenConfig) {
		if (!config.signer) {
			throw new OpenGardenError(
				OpenGardenErrorCode.SIGNER_ERROR,
				"Signer is required",
			);
		}
		if (!config.eas || !config.registry) {
			throw new OpenGardenError(
				OpenGardenErrorCode.INVALID_INPUT,
				"eas and registry are required. Use `createOpenGardenClient` from the SDK root entry if you want the helper to construct them for you.",
			);
		}

		const chain = resolveChain(config.chain);

		this.signer = config.signer;
		this.storage = config.storage;
		this.schemaUIDs = { ...chain.schemaUIDs, ...config.schemaUIDs };
		this.chainId = chain.chainId;
		this.graphqlUrl = config.graphqlUrl ?? getGraphqlUrl(this.chainId);
		this.storeUrl = config.storeUrl ?? getStoreUrl(this.chainId);

		this.eas = config.eas;
		this.registry = config.registry;
	}

	// --- Schema Registration ---

	async registerAllSchemas(): Promise<SchemaRegistrationResult[]> {
		const results: SchemaRegistrationResult[] = [];
		const names = Object.keys(SCHEMA_DEFINITIONS) as SchemaName[];
		for (const name of names) {
			if (this.schemaUIDs[name]) continue;
			const result = await this.registerSchema(name);
			results.push(result);
		}
		return results;
	}

	async registerSchema(name: SchemaName): Promise<SchemaRegistrationResult> {
		const def = SCHEMA_DEFINITIONS[name];
		const tx = await this.registry.register({
			schema: def.schema,
			resolverAddress: ZERO_ADDRESS,
			revocable: def.revocable,
		});
		const uid = await tx.wait();
		this.schemaUIDs[name] = uid;

		await this.nameSchema(uid, name);

		const receipt = tx.receipt;
		if (!receipt) {
			throw new OpenGardenError(
				OpenGardenErrorCode.SIGNER_ERROR,
				"Transaction receipt unavailable after wait()",
			);
		}
		return { name, uid, txHash: receipt.hash };
	}

	private async nameSchema(schemaUID: string, name: string): Promise<void> {
		try {
			const encoder = newSchemaEncoder("bytes32 schemaId, string name");
			const encodedData = encoder.encodeData([
				{ name: "schemaId", value: schemaUID, type: "bytes32" },
				{ name: "name", value: name, type: "string" },
			]);

			const tx = await this.eas.attest({
				schema: SCHEMA_NAME_UID,
				data: {
					recipient: ZERO_ADDRESS,
					data: encodedData,
					expirationTime: 0n,
					revocable: true,
					refUID: ZERO_BYTES32,
					value: 0n,
				},
			});
			await tx.wait();
		} catch {
			// Naming schema may not be deployed on this chain — skip silently.
		}
	}

	getSchemaUIDs(): Partial<SchemaUIDs> {
		return { ...this.schemaUIDs };
	}

	private requireSchemaUID(name: SchemaName): string {
		const uid = this.schemaUIDs[name];
		if (!uid) {
			throw new OpenGardenError(
				OpenGardenErrorCode.SCHEMA_NOT_REGISTERED,
				`Schema "${name}" is not registered. Call registerSchema("${name}") or registerAllSchemas() first, or provide the UID in config.schemaUIDs.`,
			);
		}
		return uid;
	}

	private requireGraphqlUrl(): string {
		if (!this.graphqlUrl) {
			throw new OpenGardenError(
				OpenGardenErrorCode.INVALID_INPUT,
				`No EAS GraphQL endpoint known for chain ${this.chainId}. GraphQL reads are not available on this chain.`,
			);
		}
		return this.graphqlUrl;
	}

	private async attestOnChain(
		schemaUID: string,
		encodedData: string,
		recipient: string,
		refUID: string,
	): Promise<OnChainAttestationResult> {
		const tx = await this.eas.attest({
			schema: schemaUID,
			data: {
				recipient,
				data: encodedData,
				expirationTime: 0n,
				revocable: false,
				refUID,
				value: 0n,
			},
		});
		const uid = await tx.wait();
		const receipt = tx.receipt;
		if (!receipt) {
			throw new OpenGardenError(
				OpenGardenErrorCode.SIGNER_ERROR,
				"Transaction receipt unavailable after wait()",
			);
		}
		return { uid, txHash: receipt.hash, receipt };
	}

	private async gqlFetch<T>(
		query: string,
		variables: Record<string, string>,
	): Promise<T[]> {
		const response = await fetch(this.requireGraphqlUrl(), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ query, variables }),
		});
		const json = (await response.json()) as { data?: { attestations: T[] } };
		return json.data?.attestations ?? [];
	}

	// --- On-Chain Writes ---

	async registerArea(
		data: AreaRegistrationInput,
	): Promise<OnChainAttestationResult> {
		const schemaUID = this.requireSchemaUID("AreaRegistration");
		return this.attestOnChain(
			schemaUID,
			encodeAreaRegistration(data),
			ZERO_ADDRESS,
			ZERO_BYTES32,
		);
	}

	async publishIntervention(
		data: InterventionInput,
	): Promise<OnChainAttestationResult> {
		const schemaUID = this.requireSchemaUID("Intervention");
		return this.attestOnChain(
			schemaUID,
			encodeIntervention(data),
			ZERO_ADDRESS,
			data.areaUID,
		);
	}

	async mintMilestone(
		data: GardenerMilestoneInput,
	): Promise<OnChainAttestationResult> {
		const schemaUID = this.requireSchemaUID("GardenerMilestone");
		return this.attestOnChain(
			schemaUID,
			encodeGardenerMilestone(data),
			data.recipient,
			ZERO_BYTES32,
		);
	}

	// --- Off-Chain Activity Writes (timestamped on-chain) ---

	/**
	 * Internal primitive: builds an Activity's ABI data from its canonical
	 * payload, signs an EAS offchain envelope, timestamps its UID on-chain, and
	 * returns the full `TimestampedOffChainResult` (including the plaintext
	 * payload for bundle assembly).
	 *
	 * All lifecycle Activity methods route through here. Healthcheck too — it
	 * differs only in its `refUID` target (AreaRegistration UID vs intervention
	 * scope hash) and has no intervention-scope-related envelope metadata.
	 */
	private async signActivity(
		type: ActivityTypeName,
		payload: unknown,
		refUID: string,
		recipient: string,
		timeOverride?: Date | bigint,
	): Promise<TimestampedOffChainResult> {
		const schemaUID = this.requireSchemaUID("Activity");
		const activityTypeEnum = activityTypeFromName(type);
		const payloadHash = hashActivityPayload(payload);
		const data = encodeActivityData(activityTypeEnum, payloadHash);

		const offchain = await this.eas.getOffchain();
		const signedAttestation = await offchain.signOffchainAttestation(
			{
				schema: schemaUID,
				recipient,
				time:
					timeOverride !== undefined
						? toUnixSeconds(timeOverride)
						: BigInt(Math.floor(Date.now() / 1000)),
				expirationTime: 0n,
				// Activity schema is registered `revocable: true` — at call-time all
				// types are signed `true`. Non-schedule types are simply never revoked
				// in practice; a verifier policy rejects revoked bundles of those types.
				revocable: true,
				refUID,
				data,
			},
			this.signer,
		);

		const timestampTx = await this.eas.timestamp(signedAttestation.uid);
		const onchainTimestamp = await timestampTx.wait();
		const timestampReceipt = timestampTx.receipt;
		if (!timestampReceipt) {
			throw new OpenGardenError(
				OpenGardenErrorCode.SIGNER_ERROR,
				"Transaction receipt unavailable after wait()",
			);
		}

		const attester = await this.signer.getAddress();

		// EAS SDK's `SignedOffchainAttestation` may not carry the signer address
		// as a top-level field — inject it so bundles are self-verifying without
		// re-running signature recovery just to learn the identity.
		const signedWithSigner = {
			...(signedAttestation as unknown as Record<string, unknown>),
			signer: attester,
		};

		return {
			uid: signedAttestation.uid,
			type,
			attester,
			// Narrow `unknown` back to the `TimestampedOffChainResult.payload`
			// contract (always a JSON-serializable object) — per-type payload
			// discipline is enforced upstream by the `buildXxxPayload` helpers.
			payload: payload as Record<string, unknown>,
			signedAttestation: signedWithSigner,
			timestampTxHash: timestampReceipt.hash,
			onchainTimestamp,
			timestampReceipt,
		};
	}

	async scheduleIntervention(
		input: ScheduleActivityInput,
	): Promise<TimestampedOffChainResult> {
		const payload = buildSchedulePayload(input);
		const refUID = hashInterventionScope(input.interventionId);
		return this.signActivity(
			"schedule",
			payload,
			refUID,
			input.crewLead,
			input.time,
		);
	}

	async checkin(
		input: CheckinActivityInput,
	): Promise<TimestampedOffChainResult> {
		const payload = buildCheckinPayload(input);
		const refUID = hashInterventionScope(input.interventionId);
		return this.signActivity(
			"checkin",
			payload,
			refUID,
			ZERO_ADDRESS,
			input.time,
		);
	}

	async checkout(
		input: CheckoutActivityInput,
	): Promise<TimestampedOffChainResult> {
		const payload = buildCheckoutPayload(input);
		const refUID = hashInterventionScope(input.interventionId);
		return this.signActivity(
			"checkout",
			payload,
			refUID,
			ZERO_ADDRESS,
			input.time,
		);
	}

	async submitReport(
		input: ReportActivityInput,
	): Promise<TimestampedOffChainResult> {
		const payload = buildReportPayload(input);
		const refUID = hashInterventionScope(input.interventionId);
		return this.signActivity(
			"report",
			payload,
			refUID,
			ZERO_ADDRESS,
			input.time,
		);
	}

	async recordHealthcheck(
		input: HealthcheckActivityInput,
	): Promise<TimestampedOffChainResult> {
		const payload = buildHealthcheckPayload(input);
		return this.signActivity(
			"healthcheck",
			payload,
			input.areaUID,
			ZERO_ADDRESS,
			input.time,
		);
	}

	// --- Indexing ---

	async indexBundleAttestations(
		input: EvidenceBundleBuilderInput,
	): Promise<BundleIndexingResult[]> {
		if (!this.storeUrl) return [];

		const signerAddress = await this.signer.getAddress();
		const entries: Array<{
			uid: string;
			sig: Record<string, unknown>;
			role: BundleIndexingRole;
			activityIndex?: number;
		}> = [
			{
				uid: input.schedule.uid,
				sig: input.schedule.signedAttestation,
				role: "schedule",
			},
		];
		input.crewActivities.forEach((activity, i) => {
			if (
				activity.type !== "checkin" &&
				activity.type !== "checkout" &&
				activity.type !== "report"
			) {
				return;
			}
			entries.push({
				uid: activity.uid,
				sig: activity.signedAttestation,
				role: activity.type,
				activityIndex: i,
			});
		});

		const storeUrl = this.storeUrl;
		return Promise.all(
			entries.map(async (e) => {
				const result = await submitToIndexer(storeUrl, e.sig, signerAddress);
				return {
					uid: e.uid,
					role: e.role,
					...(e.activityIndex !== undefined
						? { activityIndex: e.activityIndex }
						: {}),
					ok: result.ok,
					...(result.error ? { error: result.error } : {}),
				} satisfies BundleIndexingResult;
			}),
		);
	}

	async finalizeIntervention(
		input: FinalizeInterventionInput,
		options?: { policy?: FinalizePolicy },
	): Promise<FinalizeInterventionResult> {
		const policy = options?.policy ?? STRICT_FINALIZE_POLICY;
		const issues = validateFinalizeInput(input);
		const blocking = issues.filter((i) => policy.blocking.has(i.code));
		if (blocking.length > 0) {
			const summary = blocking
				.map((i) => `- [${i.code}] ${i.message}`)
				.join("\n");
			throw new OpenGardenError(
				OpenGardenErrorCode.INVALID_INPUT,
				`Cannot finalize intervention: ${blocking.length} blocking issue${blocking.length === 1 ? "" : "s"}:\n${summary}`,
			);
		}

		const executionDate = toUnixSeconds(input.executionDate);
		const bundle = this.buildEvidenceBundle(input);
		const evidenceBundleHash = await this.uploadEvidenceBundle(bundle);
		const indexingResults = await this.indexBundleAttestations(input);
		const indexedCount = indexingResults.filter((r) => r.ok).length;

		const publication = await this.publishIntervention({
			areaUID: input.areaUID,
			interventionId: input.interventionId,
			interventionType: input.interventionType,
			executionDate,
			commissionId: input.commissionId,
			evidenceBundleHash,
		});

		return {
			bundle,
			evidenceBundleHash,
			indexedCount,
			indexingResults,
			publication,
		};
	}

	// --- Reads ---

	async getArea(uid: string): Promise<Area> {
		const attestation = await this.eas.getAttestation(uid);
		if (!attestation || attestation.uid === ZERO_BYTES32) {
			throw new OpenGardenError(
				OpenGardenErrorCode.ATTESTATION_NOT_FOUND,
				`Area attestation not found: ${uid}`,
			);
		}
		const decoded = decodeAreaRegistration(attestation.data);
		return {
			uid: attestation.uid,
			...decoded,
			attester: attestation.attester,
			time: attestation.time,
		};
	}

	async getIntervention(uid: string): Promise<Intervention> {
		const attestation = await this.eas.getAttestation(uid);
		if (!attestation || attestation.uid === ZERO_BYTES32) {
			throw new OpenGardenError(
				OpenGardenErrorCode.ATTESTATION_NOT_FOUND,
				`Intervention attestation not found: ${uid}`,
			);
		}
		const decoded = decodeIntervention(attestation.data);
		return {
			uid: attestation.uid,
			areaUID: attestation.refUID,
			...decoded,
			attester: attestation.attester,
			recipient: attestation.recipient,
			time: attestation.time,
		};
	}

	async getAreaInterventions(areaUID: string): Promise<Intervention[]> {
		const schemaUID = this.requireSchemaUID("Intervention");
		const query = `
      query GetAreaInterventions($schemaId: String!, $refUID: String!) {
        attestations(where: { schemaId: { equals: $schemaId }, refUID: { equals: $refUID }, revoked: { equals: false } }, orderBy: [{ time: desc }]) {
          id
          attester
          recipient
          time
          data
          refUID
        }
      }
    `;
		const items = await this.gqlFetch<{
			id: string;
			attester: string;
			recipient: string;
			time: string;
			data: string;
			refUID: string;
		}>(query, { schemaId: schemaUID, refUID: areaUID });
		return items.map((a) => ({
			uid: a.id,
			areaUID: a.refUID,
			...decodeIntervention(a.data),
			attester: a.attester,
			recipient: a.recipient,
			time: BigInt(a.time),
		}));
	}

	async getGardenerMilestones(address: string): Promise<Milestone[]> {
		const schemaUID = this.requireSchemaUID("GardenerMilestone");
		const query = `
      query GetGardenerMilestones($schemaId: String!, $recipient: String!) {
        attestations(where: { schemaId: { equals: $schemaId }, recipient: { equals: $recipient }, revoked: { equals: false } }, orderBy: [{ time: desc }]) {
          id
          attester
          recipient
          time
          data
        }
      }
    `;
		const items = await this.gqlFetch<{
			id: string;
			attester: string;
			recipient: string;
			time: string;
			data: string;
		}>(query, { schemaId: schemaUID, recipient: address });
		return items.map((a) => ({
			uid: a.id,
			...decodeGardenerMilestone(a.data),
			recipient: a.recipient,
			attester: a.attester,
			time: BigInt(a.time),
		}));
	}

	/**
	 * Returns activity UIDs + decoded (activityType, payloadHash) for every
	 * Activity sharing the given intervention's scope. Payload plaintext is NOT
	 * fetched — it lives in the evidence bundle (for published interventions)
	 * or the publishing organization's attestation store (for in-flight
	 * activities). Use `verifyEvidenceBundle` / `getEvidenceBundle` to obtain
	 * full activity payloads.
	 */
	async getInterventionActivities(interventionId: string): Promise<
		Array<{
			uid: string;
			activityType: ActivityType;
			payloadHash: string;
			signer: string;
			refUID: string;
			revoked: boolean;
			time: bigint;
		}>
	> {
		const schemaUID = this.requireSchemaUID("Activity");
		const refUID = hashInterventionScope(interventionId);
		const query = `
      query GetInterventionActivities($schemaId: String!, $refUID: String!) {
        attestations(where: { schemaId: { equals: $schemaId }, refUID: { equals: $refUID } }, orderBy: [{ time: asc }]) {
          id
          attester
          time
          decodedDataJson
          refUID
          revoked
        }
      }
    `;
		const items = await this.gqlFetch<{
			id: string;
			attester: string;
			time: string;
			decodedDataJson: string;
			refUID: string;
			revoked: boolean;
		}>(query, { schemaId: schemaUID, refUID });
		return items.map((a) => {
			const { activityType, payloadHash } = parseActivityDecodedDataJson(
				a.decodedDataJson,
			);
			return {
				uid: a.id,
				activityType,
				payloadHash,
				signer: a.attester,
				refUID: a.refUID,
				revoked: a.revoked,
				time: BigInt(a.time),
			};
		});
	}

	/**
	 * Returns `healthcheck` Activity headers for an area (UID + decoded
	 * activityType/payloadHash). Payload plaintext lives in the publishing
	 * organization's attestation store; this method only surfaces the
	 * on-chain-timestamped headers.
	 */
	async getAreaHealthchecks(areaUID: string): Promise<
		Array<{
			uid: string;
			payloadHash: string;
			signer: string;
			refUID: string;
			time: bigint;
		}>
	> {
		const schemaUID = this.requireSchemaUID("Activity");
		const query = `
      query GetAreaHealthchecks($schemaId: String!, $refUID: String!) {
        attestations(where: { schemaId: { equals: $schemaId }, refUID: { equals: $refUID }, revoked: { equals: false } }, orderBy: [{ time: desc }]) {
          id
          attester
          time
          decodedDataJson
          refUID
        }
      }
    `;
		const items = await this.gqlFetch<{
			id: string;
			attester: string;
			time: string;
			decodedDataJson: string;
			refUID: string;
		}>(query, { schemaId: schemaUID, refUID: areaUID });
		return items
			.map((a) => {
				const { activityType, payloadHash } = parseActivityDecodedDataJson(
					a.decodedDataJson,
				);
				return { a, activityType, payloadHash };
			})
			.filter(({ activityType }) => activityType === ActivityType.Healthcheck)
			.map(({ a, payloadHash }) => ({
				uid: a.id,
				payloadHash,
				signer: a.attester,
				refUID: a.refUID,
				time: BigInt(a.time),
			}));
	}

	// --- Evidence Bundle ---

	buildEvidenceBundle(input: EvidenceBundleBuilderInput): EvidenceBundle {
		return buildBundle(input);
	}

	async uploadEvidenceBundle(bundle: EvidenceBundle): Promise<string> {
		if (!this.storage) {
			throw new OpenGardenError(
				OpenGardenErrorCode.STORAGE_NOT_CONFIGURED,
				"Storage adapter is required to upload evidence bundles. Pass a StorageAdapter in the config.",
			);
		}
		return this.storage.upload(JSON.stringify(bundle, bundleJsonReplacer));
	}

	async verifyEvidenceBundle(
		uid: string,
		options?: { policy?: VerifyPolicy },
	): Promise<EvidenceBundleVerification> {
		if (!this.storage) {
			throw new OpenGardenError(
				OpenGardenErrorCode.STORAGE_NOT_CONFIGURED,
				"Storage adapter is required to verify evidence bundles. Pass a StorageAdapter in the config.",
			);
		}
		const policy = options?.policy ?? STRICT_VERIFY_POLICY;

		const intervention = await this.getIntervention(uid);
		const bundleBytes = await this.storage.download(
			intervention.evidenceBundleHash,
		);
		const bundle = restoreBundleBigInts(
			JSON.parse(new TextDecoder().decode(bundleBytes)) as EvidenceBundle,
		);

		const versionCheck = verifyBundleVersion(bundle);
		if (!versionCheck.valid) {
			throw new OpenGardenError(
				OpenGardenErrorCode.BUNDLE_VERIFICATION_FAILED,
				versionCheck.message ?? "Bundle version mismatch",
			);
		}

		const signatures = await verifyBundleSignatures(bundle, this.eas);
		const payloads = verifyBundlePayloadIntegrity(bundle);
		const timestamps = await verifyBundleOnChainTimestamps(bundle, (u) =>
			this.eas.getTimestamp(u),
		);
		const scope = verifyBundleInterventionScope(bundle, intervention);
		const temporal = verifyBundleTemporalOrder(bundle);
		const executionBracket = verifyBundleExecutionDateBracket(
			bundle,
			intervention,
		);

		const checks: VerificationCheck[] = [
			versionCheck,
			signatures,
			payloads,
			timestamps,
			scope,
			temporal,
			executionBracket,
		];
		const valid = checks.every((c) => !policy.required.has(c.code) || c.valid);

		return {
			valid,
			bundleVersionValid: versionCheck.valid,
			signaturesValid: signatures.valid,
			payloadIntegrityValid: payloads.valid,
			timestampsVerified: timestamps.valid,
			interventionScopeValid: scope.valid,
			temporalOrderValid: temporal.valid,
			executionDateBracketed: executionBracket.valid,
			checks,
		};
	}
}
