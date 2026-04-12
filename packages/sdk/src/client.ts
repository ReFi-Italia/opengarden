import {
	EAS,
	SchemaEncoder,
	SchemaRegistry,
} from "@ethereum-attestation-service/eas-sdk";
import type { Signer } from "ethers";
import { SCHEMA_NAME_UID, ZERO_ADDRESS, ZERO_BYTES32 } from "./constants";
import { OpenGardenError, OpenGardenErrorCode } from "./errors";
import { buildEvidenceBundle as buildBundle } from "./evidence";
import { getGraphqlUrl, getStoreUrl, submitToIndexer } from "./indexer";
import { SCHEMA_DEFINITIONS } from "./schemas/definitions";
import {
	decodeAreaRegistration,
	decodeGardenerMilestone,
	decodePublishedIntervention,
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
} from "./schemas/encoders";
import type {
	Area,
	EvidenceBundleVerification,
	Intervention,
	Milestone,
} from "./types/attestation";
import type {
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

		this.signer = config.signer;
		this.storage = config.storage;
		this.schemaUIDs = { ...config.schemaUIDs };
		this.chainId = config.chain.chainId;
		this.graphqlUrl = getGraphqlUrl(this.chainId);
		this.storeUrl = getStoreUrl(this.chainId);

		this.eas = new EAS(config.chain.easAddress);
		this.eas.connect(this.signer);

		this.registry = new SchemaRegistry(config.chain.schemaRegistryAddress);
		this.registry.connect(this.signer);
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
			const encoder = new SchemaEncoder("bytes32 schemaId, string name");
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
				recipient: data.gardener,
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
			data.assignedGardener,
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
			data.gardener,
			data.reportUID,
			true,
		);
	}

	async recordHealthcheck(
		data: HealthcheckInput,
	): Promise<TimestampedOffChainResult> {
		const encodedData = encodeHealthcheck(data);
		return this.signAndTimestamp(
			"Healthcheck",
			encodedData,
			ZERO_ADDRESS,
			data.areaUID,
			false,
		);
	}

	// --- Indexing ---

	async indexBundleAttestations(
		input: EvidenceBundleBuilderInput,
	): Promise<number> {
		if (!this.storeUrl) return 0;

		const signerAddress = await this.signer.getAddress();
		const attestations: Record<string, unknown>[] = [
			input.scheduled.signedAttestation,
			input.checkin.signedAttestation,
			input.checkout.signedAttestation,
			input.report.signedAttestation,
			input.validation.signedAttestation,
		];
		if (input.healthcheckBefore)
			attestations.push(input.healthcheckBefore.signedAttestation);
		if (input.healthcheckAfter)
			attestations.push(input.healthcheckAfter.signedAttestation);

		let indexedCount = 0;
		for (const sig of attestations) {
			const ok = await submitToIndexer(this.storeUrl, sig, signerAddress);
			if (ok) indexedCount++;
		}
		return indexedCount;
	}

	async finalizeIntervention(
		input: FinalizeInterventionInput,
	): Promise<FinalizeInterventionResult> {
		// Execution date bracketing (lower bound): T_schedule ≤ executionDate
		if (input.scheduled.onchainTimestamp > input.executionDate) {
			throw new OpenGardenError(
				OpenGardenErrorCode.INVALID_INPUT,
				`Execution date (${input.executionDate}) must not be before the scheduled timestamp (${input.scheduled.onchainTimestamp})`,
			);
		}

		const bundle = this.buildEvidenceBundle(input);
		const evidenceBundleHash = await this.uploadEvidenceBundle(bundle);
		const indexedCount = await this.indexBundleAttestations(input);

		let offchainCount = 5;
		if (input.healthcheckBefore) offchainCount++;
		if (input.healthcheckAfter) offchainCount++;

		const publication = await this.publishIntervention({
			areaUID: input.areaUID,
			interventionId: input.interventionId,
			gardener: input.gardener,
			interventionType: input.interventionType,
			executionDate: input.executionDate,
			healthBefore: input.healthBefore,
			healthAfter: input.healthAfter,
			commissionRef: input.commissionRef,
			evidenceBundleHash,
			offchainCount,
			crewSize: input.crewSize,
			isLead: input.isLead,
		});

		return { bundle, evidenceBundleHash, indexedCount, publication };
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

		const attestationKeys = [
			"scheduled",
			"checkin",
			"checkout",
			"report",
			"validation",
		] as const;
		const presentAttestations = attestationKeys.filter(
			(key) => bundle.attestations[key] !== undefined,
		);
		const attestationCount =
			presentAttestations.length +
			(bundle.attestations.healthcheckBefore ? 1 : 0) +
			(bundle.attestations.healthcheckAfter ? 1 : 0);

		const expectedCount = intervention.offchainCount;

		// Verify strict temporal ordering (same-block timestamps fail)
		const timestamps = presentAttestations.map(
			(key) => bundle.attestations[key].onchainTimestamp,
		);
		let temporalOrderValid = true;
		for (let i = 1; i < timestamps.length; i++) {
			if (timestamps[i] <= timestamps[i - 1]) {
				temporalOrderValid = false;
				break;
			}
		}

		// Verify healthcheck temporal ordering per spec Section 4.2
		let healthcheckOrderValid = true;
		if (bundle.attestations.healthcheckBefore) {
			if (
				bundle.attestations.healthcheckBefore.onchainTimestamp >=
				bundle.attestations.checkin.onchainTimestamp
			) {
				healthcheckOrderValid = false;
			}
		}
		if (bundle.attestations.healthcheckAfter) {
			if (
				bundle.attestations.healthcheckAfter.onchainTimestamp <=
				bundle.attestations.checkout.onchainTimestamp
			) {
				healthcheckOrderValid = false;
			}
		}

		// Verify execution date bracketing: T_schedule ≤ executionDate ≤ T_publication
		const scheduledTimestamp = BigInt(
			bundle.attestations.scheduled.onchainTimestamp,
		);
		const executionDate = intervention.executionDate;
		const publicationTimestamp = intervention.time;
		const executionDateBracketed =
			scheduledTimestamp <= executionDate &&
			executionDate <= publicationTimestamp;

		// Verify validation approval
		const validationApproved = bundle.attestations.validation.approved === true;

		// Verify on-chain timestamps match
		let timestampsVerified = true;
		for (const key of presentAttestations) {
			const att = bundle.attestations[key];
			try {
				const onchainTs = await this.eas.getTimestamp(att.uid);
				if (Number(onchainTs) !== att.onchainTimestamp) {
					timestampsVerified = false;
					break;
				}
			} catch {
				timestampsVerified = false;
				break;
			}
		}

		const valid =
			attestationCount === expectedCount &&
			temporalOrderValid &&
			timestampsVerified &&
			healthcheckOrderValid &&
			executionDateBracketed &&
			validationApproved;

		return {
			valid,
			attestationCount,
			expectedCount,
			temporalOrderValid,
			timestampsVerified,
			healthcheckOrderValid,
			executionDateBracketed,
			validationApproved,
		};
	}
}
