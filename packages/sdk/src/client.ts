import { EAS, SchemaEncoder, SchemaRegistry } from '@ethereum-attestation-service/eas-sdk';
import type { Signer } from 'ethers';
import type { SchemaName } from './types/enums';
import type { OpenGardenConfig, SchemaUIDs, StorageAdapter } from './types/config';
import type {
  AreaRegistrationInput,
  PublishedInterventionInput,
  GardenerMilestoneInput,
  ScheduledInterventionInput,
  GardenerCheckinInput,
  GardenerCheckoutInput,
  GardenerReportInput,
  AdminValidationInput,
  CitizenFeedbackInput,
  HealthcheckInput,
} from './types/schemas';
import type {
  OnChainAttestationResult,
  PublishedInterventionResult,
  TimestampedOffChainResult,
  OffChainAttestationResult,
  SchemaRegistrationResult,
} from './types/results';
import type { Area, Intervention, Milestone, EvidenceBundleVerification } from './types/attestation';
import type { EvidenceBundle, EvidenceBundleBuilderInput } from './types/evidence';
import { ZERO_ADDRESS, ZERO_BYTES32, SCHEMA_NAME_UID } from './constants';
import { OpenGardenError, OpenGardenErrorCode } from './errors';
import { SCHEMA_STRINGS, SCHEMA_DEFINITIONS } from './schemas/definitions';
import {
  encodeAreaRegistration,
  encodePublishedIntervention,
  encodeGardenerMilestone,
  encodeScheduledIntervention,
  encodeGardenerCheckin,
  encodeGardenerCheckout,
  encodeGardenerReport,
  encodeAdminValidation,
  encodeCitizenFeedback,
  encodeHealthcheck,
  decodeAreaRegistration,
  decodePublishedIntervention,
  decodeGardenerMilestone,
} from './schemas/encoders';
import { buildEvidenceBundle as buildBundle } from './evidence';

const EASSCAN_GRAPHQL_URLS: Record<string, string> = {
  '42220': 'https://celo.easscan.org/graphql',
  '10': 'https://optimism.easscan.org/graphql',
  '8453': 'https://base.easscan.org/graphql',
  '11155420': 'https://optimism-sepolia.easscan.org/graphql',
  '84532': 'https://base-sepolia.easscan.org/graphql',
};

const EASSCAN_STORE_URLS: Record<string, string> = {
  '42220': 'https://celo.easscan.org/offchain/store',
  '10': 'https://optimism.easscan.org/offchain/store',
  '8453': 'https://base.easscan.org/offchain/store',
  '11155420': 'https://optimism-sepolia.easscan.org/offchain/store',
  '84532': 'https://base-sepolia.easscan.org/offchain/store',
};

export class OpenGardenClient {
  private readonly eas: EAS;
  private readonly registry: SchemaRegistry;
  private readonly signer: Signer;
  private readonly storage?: StorageAdapter;
  private readonly schemaUIDs: Partial<SchemaUIDs>;
  private readonly graphqlUrl: string | undefined;
  private readonly chainId: bigint;
  private readonly indexOffchain: boolean;
  private readonly storeUrl: string | undefined;
  private pendingIndexQueue: Array<Record<string, unknown>> = [];

  constructor(config: OpenGardenConfig) {
    if (!config.signer) {
      throw new OpenGardenError(OpenGardenErrorCode.SIGNER_ERROR, 'Signer is required');
    }

    this.signer = config.signer;
    this.storage = config.storage;
    this.schemaUIDs = { ...config.schemaUIDs };
    this.chainId = config.chain.chainId;
    this.graphqlUrl = EASSCAN_GRAPHQL_URLS[this.chainId.toString()];
    this.indexOffchain = config.indexOffchain ?? false;
    this.storeUrl = EASSCAN_STORE_URLS[this.chainId.toString()];

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

    return { name, uid, txHash: tx.receipt!.hash };
  }

  private async nameSchema(schemaUID: string, name: string): Promise<void> {
    try {
      const encoder = new SchemaEncoder('bytes32 schemaId, string name');
      const encodedData = encoder.encodeData([
        { name: 'schemaId', value: schemaUID, type: 'bytes32' },
        { name: 'name', value: name, type: 'string' },
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

  private async submitToIndexer(signedAttestation: Record<string, unknown>): Promise<boolean> {
    if (!this.indexOffchain || !this.storeUrl) return false;

    try {
      const signer = await this.signer.getAddress();
      const pkg = JSON.stringify(
        { sig: signedAttestation, signer },
        (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
      );
      const response = await fetch(this.storeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'eas.txt', textJson: pkg }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.warn(`easscan indexer returned ${response.status}: ${body}`);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('easscan indexer submission failed', err);
      return false;
    }
  }

  // --- On-Chain Writes ---

  async registerArea(data: AreaRegistrationInput): Promise<OnChainAttestationResult> {
    const schemaUID = this.requireSchemaUID('AreaRegistration');
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
    return { uid, txHash: tx.receipt!.hash, receipt: tx.receipt! };
  }

  async publishIntervention(data: PublishedInterventionInput): Promise<PublishedInterventionResult> {
    const schemaUID = this.requireSchemaUID('PublishedIntervention');
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

    let indexedCount = 0;
    if (this.indexOffchain && this.storeUrl && this.pendingIndexQueue.length > 0) {
      const pending = this.pendingIndexQueue;
      this.pendingIndexQueue = [];
      for (const sig of pending) {
        const ok = await this.submitToIndexer(sig);
        if (ok) indexedCount++;
      }
    }

    return { uid, txHash: tx.receipt!.hash, receipt: tx.receipt!, indexedCount };
  }

  async mintMilestone(data: GardenerMilestoneInput): Promise<OnChainAttestationResult> {
    const schemaUID = this.requireSchemaUID('GardenerMilestone');
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
    return { uid, txHash: tx.receipt!.hash, receipt: tx.receipt! };
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

    if (this.indexOffchain) {
      this.pendingIndexQueue.push(signedAttestation as unknown as Record<string, unknown>);
    }

    return {
      uid: signedAttestation.uid,
      signedAttestation: signedAttestation as unknown as Record<string, unknown>,
      timestampTxHash: timestampTx.receipt!.hash,
      onchainTimestamp,
      timestampReceipt: timestampTx.receipt!,
    };
  }

  async scheduleIntervention(data: ScheduledInterventionInput): Promise<TimestampedOffChainResult> {
    const encodedData = encodeScheduledIntervention(data);
    return this.signAndTimestamp(
      'ScheduledIntervention',
      encodedData,
      data.assignedGardener,
      data.areaUID,
      true,
    );
  }

  async checkin(data: GardenerCheckinInput): Promise<TimestampedOffChainResult> {
    const encodedData = encodeGardenerCheckin(data);
    return this.signAndTimestamp(
      'GardenerCheckin',
      encodedData,
      ZERO_ADDRESS,
      data.interventionUID,
      false,
    );
  }

  async checkout(data: GardenerCheckoutInput): Promise<TimestampedOffChainResult> {
    const encodedData = encodeGardenerCheckout(data);
    return this.signAndTimestamp(
      'GardenerCheckout',
      encodedData,
      ZERO_ADDRESS,
      data.checkinUID,
      false,
    );
  }

  async submitReport(data: GardenerReportInput): Promise<TimestampedOffChainResult> {
    const encodedData = encodeGardenerReport(data);
    return this.signAndTimestamp(
      'GardenerReport',
      encodedData,
      ZERO_ADDRESS,
      data.interventionUID,
      false,
    );
  }

  async validateIntervention(data: AdminValidationInput): Promise<TimestampedOffChainResult> {
    const encodedData = encodeAdminValidation(data);
    return this.signAndTimestamp(
      'AdminValidation',
      encodedData,
      data.gardener,
      data.reportUID,
      true,
    );
  }

  async recordHealthcheck(data: HealthcheckInput): Promise<TimestampedOffChainResult> {
    const encodedData = encodeHealthcheck(data);
    return this.signAndTimestamp(
      'Healthcheck',
      encodedData,
      ZERO_ADDRESS,
      data.areaUID,
      false,
    );
  }

  // --- Non-Timestamped Off-Chain Write ---

  async submitFeedback(data: CitizenFeedbackInput): Promise<OffChainAttestationResult> {
    const schemaUID = this.requireSchemaUID('CitizenFeedback');
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
      signedAttestation: signedAttestation as unknown as Record<string, unknown>,
    };
  }

  // --- Reads ---

  async getArea(uid: string): Promise<Area> {
    const attestation = await this.eas.getAttestation(uid);
    if (!attestation || attestation.uid === ZERO_BYTES32) {
      throw new OpenGardenError(OpenGardenErrorCode.ATTESTATION_NOT_FOUND, `Area attestation not found: ${uid}`);
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
      throw new OpenGardenError(OpenGardenErrorCode.ATTESTATION_NOT_FOUND, `Intervention attestation not found: ${uid}`);
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
    const schemaUID = this.requireSchemaUID('PublishedIntervention');
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    const schemaUID = this.requireSchemaUID('GardenerMilestone');
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
        'Storage adapter is required to upload evidence bundles. Pass a StorageAdapter in the config.',
      );
    }
    return this.storage.upload(JSON.stringify(bundle));
  }

  async verifyEvidenceBundle(uid: string): Promise<EvidenceBundleVerification> {
    if (!this.storage) {
      throw new OpenGardenError(
        OpenGardenErrorCode.STORAGE_NOT_CONFIGURED,
        'Storage adapter is required to verify evidence bundles. Pass a StorageAdapter in the config.',
      );
    }

    const intervention = await this.getIntervention(uid);
    const bundleBytes = await this.storage.download(intervention.evidenceBundleHash);
    const bundle = JSON.parse(new TextDecoder().decode(bundleBytes)) as EvidenceBundle;

    const attestationKeys = ['scheduled', 'checkin', 'checkout', 'report', 'validation'] as const;
    const presentAttestations = attestationKeys.filter(
      (key) => bundle.attestations[key] !== undefined,
    );
    const attestationCount = presentAttestations.length
      + (bundle.attestations.healthcheckBefore ? 1 : 0)
      + (bundle.attestations.healthcheckAfter ? 1 : 0);

    const expectedCount = intervention.offchainCount;

    // Verify temporal ordering
    const timestamps = presentAttestations.map(
      (key) => bundle.attestations[key].onchainTimestamp,
    );
    let temporalOrderValid = true;
    for (let i = 1; i < timestamps.length; i++) {
      if (timestamps[i] < timestamps[i - 1]) {
        temporalOrderValid = false;
        break;
      }
    }

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

    return {
      valid: attestationCount === expectedCount && temporalOrderValid && timestampsVerified,
      attestationCount,
      expectedCount,
      temporalOrderValid,
      timestampsVerified,
    };
  }
}
