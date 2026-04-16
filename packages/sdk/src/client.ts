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
import { buildEvidenceBundle as buildBundle } from "./evidence";
import { getGraphqlUrl, getStoreUrl, submitToIndexer } from "./indexer";
import { validateFinalizeInput } from "./preflight";
import { SCHEMA_DEFINITIONS } from "./schemas/definitions";
import {
	type VerificationCheck,
	verifyBundleCompleteness,
	verifyBundleExecutionDateBracket,
	verifyBundleHealthcheckBracket,
	verifyBundleOnChainTimestamps,
	verifyBundleTemporalOrder,
	verifyBundleValidationApproved,
	verifyBundleVersion,
} from "./verification";
import {
	decodeAreaRegistration,
	decodeCitizenFeedback,
	decodeGardenerMilestone,
	decodeHealthcheck,
	decodePublishedIntervention,
	decodeScheduledIntervention,
	encodeAdminValidation,
	encodeAreaRegistration,
	encodeCitizenFeedback,
	encodeGardenerCheckin,
	encodeGardenerCheckout,
	encodeGardenerMilestone,
	encodeGardenerReport,
	encodeHealthcheck,
	encodePublishedIntervention,
	encodeScheduledIntervention,
	newSchemaEncoder,
} from "./schemas/encoders";
import type {
	Area,
	CitizenFeedback,
	EvidenceBundleVerification,
	Healthcheck,
	Intervention,
	Milestone,
	ScheduledIntervention,
} from "./types/attestation";
import type {
	ChainConfig,
	OpenGardenConfig,
	SchemaUIDs,
	StorageAdapter,
} from "./types/config";
import type { SchemaName } from "./types/enums";
import type {
	EvidenceBundle,
	EvidenceBundleBuilderInput,
	FinalizeInterventionInput,
	FinalizeInterventionResult,
} from "./types/evidence";
import type {
	BundleIndexingResult,
	BundleIndexingRole,
	OffChainAttestationResult,
	OnChainAttestationResult,
	SchemaRegistrationResult,
	TimestampedOffChainResult,
} from "./types/results";
import type {
	AdminValidationInput,
	AreaRegistrationInput,
	CitizenFeedbackInput,
	GardenerCheckinInput,
	GardenerCheckoutInput,
	GardenerMilestoneInput,
	GardenerReportInput,
	HealthcheckInput,
	PublishedInterventionInput,
	ScheduledInterventionInput,
} from "./types/schemas";
import { toUnixSeconds } from "./utils";

function resolveChain(chain: OpenGardenConfig["chain"]): ChainConfig {
	if (typeof chain === "string") {
		if (!Object.prototype.hasOwnProperty.call(CHAIN_CONFIGS, chain)) {
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

	// --- On-Chain Writes ---

	async registerArea(
		data: AreaRegistrationInput,
	): Promise<OnChainAttestationResult> {
		const schemaUID = this.requireSchemaUID("AreaRegistration");
		const encodedData = encodeAreaRegistration(data);

		const tx = await this.eas.attest({
			schema: schemaUID,
			data: {
				recipient: ZERO_ADDRESS,
				data: encodedData,
				expirationTime: 0n,
				revocable: false,
				refUID: ZERO_BYTES32,
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

	async publishIntervention(
		data: PublishedInterventionInput,
	): Promise<OnChainAttestationResult> {
		const schemaUID = this.requireSchemaUID("PublishedIntervention");
		const encodedData = encodePublishedIntervention(data);

		const tx = await this.eas.attest({
			schema: schemaUID,
			data: {
				recipient: ZERO_ADDRESS,
				data: encodedData,
				expirationTime: 0n,
				revocable: false,
				refUID: data.areaUID,
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

	async mintMilestone(
		data: GardenerMilestoneInput,
	): Promise<OnChainAttestationResult> {
		const schemaUID = this.requireSchemaUID("GardenerMilestone");
		const encodedData = encodeGardenerMilestone(data);

		const tx = await this.eas.attest({
			schema: schemaUID,
			data: {
				recipient: data.recipient,
				data: encodedData,
				expirationTime: 0n,
				revocable: false,
				refUID: ZERO_BYTES32,
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

	// --- Timestamped Off-Chain Writes ---

	private async signAndTimestamp(
		schemaName: SchemaName,
		encodedData: string,
		recipient: string,
		refUID: string,
		revocable: boolean,
	): Promise<TimestampedOffChainResult> {
		const schemaUID = this.requireSchemaUID(schemaName);
		const offchain = await this.eas.getOffchain();

		const signedAttestation = await offchain.signOffchainAttestation(
			{
				schema: schemaUID,
				recipient,
				time: BigInt(Math.floor(Date.now() / 1000)),
				expirationTime: 0n,
				revocable,
				refUID,
				data: encodedData,
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

		return {
			uid: signedAttestation.uid,
			signedAttestation: signedAttestation as unknown as Record<
				string,
				unknown
			>,
			timestampTxHash: timestampReceipt.hash,
			onchainTimestamp,
			timestampReceipt,
		};
	}

	async scheduleIntervention(
		data: ScheduledInterventionInput,
	): Promise<TimestampedOffChainResult> {
		const encodedData = encodeScheduledIntervention(data);
		return this.signAndTimestamp(
			"ScheduledIntervention",
			encodedData,
			data.crewLead,
			data.areaUID,
			true,
		);
	}

	async checkin(
		data: GardenerCheckinInput,
	): Promise<TimestampedOffChainResult> {
		const encodedData = encodeGardenerCheckin(data);
		return this.signAndTimestamp(
			"GardenerCheckin",
			encodedData,
			ZERO_ADDRESS,
			data.interventionUID,
			false,
		);
	}

	async checkout(
		data: GardenerCheckoutInput,
	): Promise<TimestampedOffChainResult> {
		const encodedData = encodeGardenerCheckout(data);
		return this.signAndTimestamp(
			"GardenerCheckout",
			encodedData,
			ZERO_ADDRESS,
			data.checkinUID,
			false,
		);
	}

	async submitReport(
		data: GardenerReportInput,
	): Promise<TimestampedOffChainResult> {
		const encodedData = encodeGardenerReport(data);
		return this.signAndTimestamp(
			"GardenerReport",
			encodedData,
			ZERO_ADDRESS,
			data.interventionUID,
			false,
		);
	}

	async validateIntervention(
		data: AdminValidationInput,
	): Promise<TimestampedOffChainResult> {
		const encodedData = encodeAdminValidation(data);
		return this.signAndTimestamp(
			"AdminValidation",
			encodedData,
			ZERO_ADDRESS,
			data.scheduleUID,
			true,
		);
	}

	async recordHealthcheck(
		areaUID: string,
		data: HealthcheckInput,
	): Promise<TimestampedOffChainResult> {
		const encodedData = encodeHealthcheck(data);
		return this.signAndTimestamp(
			"Healthcheck",
			encodedData,
			ZERO_ADDRESS,
			areaUID,
			false,
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
			crewIndex?: number;
		}> = [
			{
				uid: input.scheduled.uid,
				sig: input.scheduled.signedAttestation,
				role: "scheduled",
			},
		];
		input.crew.forEach((member, i) => {
			entries.push({
				uid: member.checkin.uid,
				sig: member.checkin.signedAttestation,
				role: "checkin",
				crewIndex: i,
			});
			entries.push({
				uid: member.checkout.uid,
				sig: member.checkout.signedAttestation,
				role: "checkout",
				crewIndex: i,
			});
			entries.push({
				uid: member.report.uid,
				sig: member.report.signedAttestation,
				role: "report",
				crewIndex: i,
			});
		});
		entries.push({
			uid: input.validation.uid,
			sig: input.validation.signedAttestation,
			role: "validation",
		});
		if (input.healthcheck) {
			entries.push({
				uid: input.healthcheck.uid,
				sig: input.healthcheck.signedAttestation,
				role: "healthcheck",
			});
		}

		const storeUrl = this.storeUrl;
		return Promise.all(
			entries.map(async (e) => {
				const result = await submitToIndexer(storeUrl, e.sig, signerAddress);
				return {
					uid: e.uid,
					role: e.role,
					...(e.crewIndex !== undefined ? { crewIndex: e.crewIndex } : {}),
					ok: result.ok,
					...(result.error ? { error: result.error } : {}),
				} satisfies BundleIndexingResult;
			}),
		);
	}

	async finalizeIntervention(
		input: FinalizeInterventionInput,
	): Promise<FinalizeInterventionResult> {
		const issues = validateFinalizeInput(input);
		if (issues.length > 0) {
			const summary = issues
				.map((i) => `- [${i.code}] ${i.message}`)
				.join("\n");
			throw new OpenGardenError(
				OpenGardenErrorCode.INVALID_INPUT,
				`Cannot finalize intervention: ${issues.length} issue${issues.length === 1 ? "" : "s"}:\n${summary}`,
			);
		}

		const executionDate = toUnixSeconds(input.executionDate);
		const bundle = this.buildEvidenceBundle(input);
		const evidenceBundleHash = await this.uploadEvidenceBundle(bundle);
		const indexingResults = await this.indexBundleAttestations(input);
		const indexedCount = indexingResults.filter((r) => r.ok).length;

		let offchainCount = 2 + 3 * input.crew.length;
		if (input.healthcheck) offchainCount++;

		const publication = await this.publishIntervention({
			areaUID: input.areaUID,
			interventionId: input.interventionId,
			interventionType: input.interventionType,
			executionDate,
			healthBefore: input.healthBefore,
			healthAfter: input.healthAfter,
			commissionId: input.commissionId,
			evidenceBundleHash,
			offchainCount,
			crewSize: input.crewSize,
		});

		return {
			bundle,
			evidenceBundleHash,
			indexedCount,
			indexingResults,
			publication,
		};
	}

	// --- Non-Timestamped Off-Chain Write ---

	async submitFeedback(
		data: CitizenFeedbackInput,
	): Promise<OffChainAttestationResult> {
		const schemaUID = this.requireSchemaUID("CitizenFeedback");
		const encodedData = encodeCitizenFeedback(data);
		const offchain = await this.eas.getOffchain();

		const signedAttestation = await offchain.signOffchainAttestation(
			{
				schema: schemaUID,
				recipient: ZERO_ADDRESS,
				time: BigInt(Math.floor(Date.now() / 1000)),
				expirationTime: 0n,
				revocable: false,
				refUID: data.areaUID,
				data: encodedData,
			},
			this.signer,
		);

		return {
			uid: signedAttestation.uid,
			signedAttestation: signedAttestation as unknown as Record<
				string,
				unknown
			>,
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
		const decoded = decodePublishedIntervention(attestation.data);
		return {
			uid: attestation.uid,
			...decoded,
			attester: attestation.attester,
			recipient: attestation.recipient,
			time: attestation.time,
		};
	}

	async getAreaInterventions(areaUID: string): Promise<Intervention[]> {
		const schemaUID = this.requireSchemaUID("PublishedIntervention");
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

		const response = await fetch(this.requireGraphqlUrl(), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				query,
				variables: { schemaId: schemaUID, refUID: areaUID },
			}),
		});

		const json = (await response.json()) as {
			data?: {
				attestations: Array<{
					id: string;
					attester: string;
					recipient: string;
					time: string;
					data: string;
					refUID: string;
				}>;
			};
		};
		const attestations = json.data?.attestations ?? [];

		return attestations.map((a) => {
			const decoded = decodePublishedIntervention(a.data);
			return {
				uid: a.id,
				...decoded,
				attester: a.attester,
				recipient: a.recipient,
				time: BigInt(a.time),
			};
		});
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

		const response = await fetch(this.requireGraphqlUrl(), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				query,
				variables: { schemaId: schemaUID, recipient: address },
			}),
		});

		const json = (await response.json()) as {
			data?: {
				attestations: Array<{
					id: string;
					attester: string;
					recipient: string;
					time: string;
					data: string;
				}>;
			};
		};
		const attestations = json.data?.attestations ?? [];

		return attestations.map((a) => {
			const decoded = decodeGardenerMilestone(a.data);
			return {
				uid: a.id,
				...decoded,
				recipient: a.recipient,
				attester: a.attester,
				time: BigInt(a.time),
			};
		});
	}

	async getScheduledInterventions(filter: {
		areaUID?: string;
		crewLead?: string;
	}): Promise<ScheduledIntervention[]> {
		if (!filter.areaUID && !filter.crewLead) {
			throw new OpenGardenError(
				OpenGardenErrorCode.INVALID_INPUT,
				"getScheduledInterventions requires at least one filter: areaUID or crewLead",
			);
		}

		const schemaUID = this.requireSchemaUID("ScheduledIntervention");
		const whereFields: string[] = [
			"schemaId: { equals: $schemaId }",
			"revoked: { equals: false }",
		];
		const paramDefs: string[] = ["$schemaId: String!"];
		const variables: Record<string, string> = { schemaId: schemaUID };

		if (filter.areaUID) {
			whereFields.push("refUID: { equals: $refUID }");
			paramDefs.push("$refUID: String!");
			variables.refUID = filter.areaUID;
		}
		if (filter.crewLead) {
			whereFields.push("recipient: { equals: $recipient }");
			paramDefs.push("$recipient: String!");
			variables.recipient = filter.crewLead;
		}

		const query = `
      query GetScheduledInterventions(${paramDefs.join(", ")}) {
        attestations(where: { ${whereFields.join(", ")} }, orderBy: [{ time: desc }]) {
          id
          attester
          recipient
          time
          data
        }
      }
    `;

		const response = await fetch(this.requireGraphqlUrl(), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ query, variables }),
		});

		const json = (await response.json()) as {
			data?: {
				attestations: Array<{
					id: string;
					attester: string;
					recipient: string;
					time: string;
					data: string;
				}>;
			};
		};
		const attestations = json.data?.attestations ?? [];

		return attestations.map((a) => {
			const decoded = decodeScheduledIntervention(a.data);
			return {
				uid: a.id,
				...decoded,
				attester: a.attester,
				recipient: a.recipient,
				time: BigInt(a.time),
			};
		});
	}

	async getAreaHealthchecks(areaUID: string): Promise<Healthcheck[]> {
		const schemaUID = this.requireSchemaUID("Healthcheck");
		const query = `
      query GetAreaHealthchecks($schemaId: String!, $refUID: String!) {
        attestations(where: { schemaId: { equals: $schemaId }, refUID: { equals: $refUID }, revoked: { equals: false } }, orderBy: [{ time: desc }]) {
          id
          attester
          time
          data
        }
      }
    `;

		const response = await fetch(this.requireGraphqlUrl(), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				query,
				variables: { schemaId: schemaUID, refUID: areaUID },
			}),
		});

		const json = (await response.json()) as {
			data?: {
				attestations: Array<{
					id: string;
					attester: string;
					time: string;
					data: string;
				}>;
			};
		};
		const attestations = json.data?.attestations ?? [];

		return attestations.map((a) => {
			const decoded = decodeHealthcheck(a.data);
			return {
				uid: a.id,
				...decoded,
				attester: a.attester,
				time: BigInt(a.time),
			};
		});
	}

	async getAreaCitizenFeedback(areaUID: string): Promise<CitizenFeedback[]> {
		const schemaUID = this.requireSchemaUID("CitizenFeedback");
		const query = `
      query GetAreaCitizenFeedback($schemaId: String!, $refUID: String!) {
        attestations(where: { schemaId: { equals: $schemaId }, refUID: { equals: $refUID }, revoked: { equals: false } }, orderBy: [{ time: desc }]) {
          id
          attester
          time
          data
        }
      }
    `;

		const response = await fetch(this.requireGraphqlUrl(), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				query,
				variables: { schemaId: schemaUID, refUID: areaUID },
			}),
		});

		const json = (await response.json()) as {
			data?: {
				attestations: Array<{
					id: string;
					attester: string;
					time: string;
					data: string;
				}>;
			};
		};
		const attestations = json.data?.attestations ?? [];

		return attestations.map((a) => {
			const decoded = decodeCitizenFeedback(a.data);
			return {
				uid: a.id,
				...decoded,
				attester: a.attester,
				time: BigInt(a.time),
			};
		});
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
		return this.storage.upload(JSON.stringify(bundle));
	}

	async verifyEvidenceBundle(uid: string): Promise<EvidenceBundleVerification> {
		if (!this.storage) {
			throw new OpenGardenError(
				OpenGardenErrorCode.STORAGE_NOT_CONFIGURED,
				"Storage adapter is required to verify evidence bundles. Pass a StorageAdapter in the config.",
			);
		}

		const intervention = await this.getIntervention(uid);
		const bundleBytes = await this.storage.download(
			intervention.evidenceBundleHash,
		);
		const bundle = JSON.parse(
			new TextDecoder().decode(bundleBytes),
		) as EvidenceBundle;

		const versionCheck = verifyBundleVersion(bundle);
		if (!versionCheck.valid) {
			throw new OpenGardenError(
				OpenGardenErrorCode.BUNDLE_VERIFICATION_FAILED,
				versionCheck.message ?? "Bundle version mismatch",
			);
		}

		const completeness = verifyBundleCompleteness(
			bundle,
			intervention.offchainCount,
		);
		const temporal = verifyBundleTemporalOrder(bundle);
		const healthcheckBracket = verifyBundleHealthcheckBracket(bundle);
		const executionBracket = verifyBundleExecutionDateBracket(
			bundle,
			intervention,
		);
		const validation = verifyBundleValidationApproved(bundle);
		const timestamps = await verifyBundleOnChainTimestamps(bundle, (u) =>
			this.eas.getTimestamp(u),
		);

		const checks: VerificationCheck[] = [
			completeness,
			temporal,
			healthcheckBracket,
			executionBracket,
			validation,
			timestamps,
		];
		const valid = checks.every((c) => c.valid);

		return {
			valid,
			attestationCount: completeness.attestationCount,
			expectedCount: completeness.expectedCount,
			temporalOrderValid: temporal.valid,
			timestampsVerified: timestamps.valid,
			healthcheckOrderValid: healthcheckBracket.valid,
			executionDateBracketed: executionBracket.valid,
			validationApproved: validation.valid,
			checks,
		};
	}
}
