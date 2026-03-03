import { SchemaEncoder } from '@ethereum-attestation-service/eas-sdk';
import { toMicrodegrees, fromMicrodegrees } from '../utils';
import { SCHEMA_STRINGS } from './definitions';
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
} from '../types/schemas';

// --- Encoders ---

export function encodeAreaRegistration(input: AreaRegistrationInput): string {
  const encoder = new SchemaEncoder(SCHEMA_STRINGS.AreaRegistration);
  return encoder.encodeData([
    { name: 'areaId', value: input.areaId, type: 'string' },
    { name: 'latitude', value: toMicrodegrees(input.latitude), type: 'int32' },
    { name: 'longitude', value: toMicrodegrees(input.longitude), type: 'int32' },
    { name: 'areaType', value: input.areaType, type: 'uint8' },
    { name: 'name', value: input.name, type: 'string' },
    { name: 'municipality', value: input.municipality, type: 'string' },
    { name: 'metadataHash', value: input.metadataHash, type: 'bytes32' },
  ]);
}

export function encodePublishedIntervention(input: PublishedInterventionInput): string {
  const encoder = new SchemaEncoder(SCHEMA_STRINGS.PublishedIntervention);
  return encoder.encodeData([
    { name: 'areaUID', value: input.areaUID, type: 'bytes32' },
    { name: 'interventionId', value: input.interventionId, type: 'string' },
    { name: 'gardener', value: input.gardener, type: 'address' },
    { name: 'interventionType', value: input.interventionType, type: 'uint8' },
    { name: 'executionDate', value: input.executionDate, type: 'uint64' },
    { name: 'healthBefore', value: input.healthBefore, type: 'uint8' },
    { name: 'healthAfter', value: input.healthAfter, type: 'uint8' },
    { name: 'commissionRef', value: input.commissionRef, type: 'bytes32' },
    { name: 'evidenceBundleHash', value: input.evidenceBundleHash, type: 'bytes32' },
    { name: 'offchainCount', value: input.offchainCount, type: 'uint8' },
    { name: 'crewSize', value: input.crewSize, type: 'uint8' },
    { name: 'isLead', value: input.isLead, type: 'bool' },
  ]);
}

export function encodeGardenerMilestone(input: GardenerMilestoneInput): string {
  const encoder = new SchemaEncoder(SCHEMA_STRINGS.GardenerMilestone);
  return encoder.encodeData([
    { name: 'milestoneLevel', value: input.milestoneLevel, type: 'uint8' },
    { name: 'totalInterventions', value: input.totalInterventions, type: 'uint16' },
    { name: 'totalValidated', value: input.totalValidated, type: 'uint16' },
    { name: 'avgHealthImprovement', value: input.avgHealthImprovement, type: 'uint8' },
    { name: 'skillTier', value: input.skillTier, type: 'string' },
    { name: 'achievedAt', value: input.achievedAt, type: 'uint64' },
    { name: 'evidenceRoot', value: input.evidenceRoot, type: 'bytes32' },
  ]);
}

export function encodeScheduledIntervention(input: ScheduledInterventionInput): string {
  const encoder = new SchemaEncoder(SCHEMA_STRINGS.ScheduledIntervention);
  return encoder.encodeData([
    { name: 'areaUID', value: input.areaUID, type: 'bytes32' },
    { name: 'interventionId', value: input.interventionId, type: 'string' },
    { name: 'interventionType', value: input.interventionType, type: 'uint8' },
    { name: 'assignedGardener', value: input.assignedGardener, type: 'address' },
    { name: 'scheduledDate', value: input.scheduledDate, type: 'uint64' },
    { name: 'estimatedMinutes', value: input.estimatedMinutes, type: 'uint16' },
    { name: 'description', value: input.description, type: 'string' },
    { name: 'commissionRef', value: input.commissionRef, type: 'bytes32' },
    { name: 'crewSize', value: input.crewSize, type: 'uint8' },
  ]);
}

export function encodeGardenerCheckin(input: GardenerCheckinInput): string {
  const encoder = new SchemaEncoder(SCHEMA_STRINGS.GardenerCheckin);
  return encoder.encodeData([
    { name: 'interventionUID', value: input.interventionUID, type: 'bytes32' },
    { name: 'latitude', value: toMicrodegrees(input.latitude), type: 'int32' },
    { name: 'longitude', value: toMicrodegrees(input.longitude), type: 'int32' },
    { name: 'timestamp', value: input.timestamp, type: 'uint64' },
    { name: 'photoHash', value: input.photoHash, type: 'bytes32' },
  ]);
}

export function encodeGardenerCheckout(input: GardenerCheckoutInput): string {
  const encoder = new SchemaEncoder(SCHEMA_STRINGS.GardenerCheckout);
  return encoder.encodeData([
    { name: 'checkinUID', value: input.checkinUID, type: 'bytes32' },
    { name: 'timestamp', value: input.timestamp, type: 'uint64' },
    { name: 'actualMinutes', value: input.actualMinutes, type: 'uint16' },
  ]);
}

export function encodeGardenerReport(input: GardenerReportInput): string {
  const encoder = new SchemaEncoder(SCHEMA_STRINGS.GardenerReport);
  return encoder.encodeData([
    { name: 'interventionUID', value: input.interventionUID, type: 'bytes32' },
    { name: 'checkoutUID', value: input.checkoutUID, type: 'bytes32' },
    { name: 'tasksCompleted', value: input.tasksCompleted, type: 'string' },
    { name: 'taskCount', value: input.taskCount, type: 'uint8' },
    { name: 'photosHash', value: input.photosHash, type: 'bytes32' },
    { name: 'notes', value: input.notes, type: 'string' },
  ]);
}

export function encodeAdminValidation(input: AdminValidationInput): string {
  const encoder = new SchemaEncoder(SCHEMA_STRINGS.AdminValidation);
  return encoder.encodeData([
    { name: 'reportUID', value: input.reportUID, type: 'bytes32' },
    { name: 'approved', value: input.approved, type: 'bool' },
    { name: 'qualityScore', value: input.qualityScore, type: 'uint8' },
    { name: 'feedback', value: input.feedback, type: 'string' },
    { name: 'validatorId', value: input.validatorId, type: 'bytes32' },
  ]);
}

export function encodeCitizenFeedback(input: CitizenFeedbackInput): string {
  const encoder = new SchemaEncoder(SCHEMA_STRINGS.CitizenFeedback);
  return encoder.encodeData([
    { name: 'areaUID', value: input.areaUID, type: 'bytes32' },
    { name: 'rating', value: input.rating, type: 'uint8' },
    { name: 'comment', value: input.comment, type: 'string' },
    { name: 'photoHash', value: input.photoHash, type: 'bytes32' },
  ]);
}

export function encodeHealthcheck(input: HealthcheckInput): string {
  const encoder = new SchemaEncoder(SCHEMA_STRINGS.Healthcheck);
  return encoder.encodeData([
    { name: 'areaUID', value: input.areaUID, type: 'bytes32' },
    { name: 'healthScore', value: input.healthScore, type: 'uint8' },
    { name: 'photoHash', value: input.photoHash, type: 'bytes32' },
    { name: 'assessorNotes', value: input.assessorNotes, type: 'string' },
    { name: 'interventionNeeded', value: input.interventionNeeded, type: 'bool' },
  ]);
}

// --- Decoders ---

interface DecodedField {
  name: string;
  value: { value: unknown } | unknown;
  type: string;
}

function getFieldValue(decoded: DecodedField[], name: string): unknown {
  const field = decoded.find((f) => f.name === name);
  if (!field) throw new Error(`Field "${name}" not found in decoded data`);
  const val = field.value;
  return typeof val === 'object' && val !== null && 'value' in val
    ? (val as { value: unknown }).value
    : val;
}

export function decodeAreaRegistration(data: string) {
  const encoder = new SchemaEncoder(SCHEMA_STRINGS.AreaRegistration);
  const decoded = encoder.decodeData(data) as unknown as DecodedField[];
  return {
    areaId: getFieldValue(decoded, 'areaId') as string,
    latitude: fromMicrodegrees(Number(getFieldValue(decoded, 'latitude'))),
    longitude: fromMicrodegrees(Number(getFieldValue(decoded, 'longitude'))),
    areaType: Number(getFieldValue(decoded, 'areaType')),
    name: getFieldValue(decoded, 'name') as string,
    municipality: getFieldValue(decoded, 'municipality') as string,
    metadataHash: String(getFieldValue(decoded, 'metadataHash')),
  };
}

export function decodePublishedIntervention(data: string) {
  const encoder = new SchemaEncoder(SCHEMA_STRINGS.PublishedIntervention);
  const decoded = encoder.decodeData(data) as unknown as DecodedField[];
  return {
    areaUID: String(getFieldValue(decoded, 'areaUID')),
    interventionId: getFieldValue(decoded, 'interventionId') as string,
    gardener: getFieldValue(decoded, 'gardener') as string,
    interventionType: Number(getFieldValue(decoded, 'interventionType')),
    executionDate: BigInt(String(getFieldValue(decoded, 'executionDate'))),
    healthBefore: Number(getFieldValue(decoded, 'healthBefore')),
    healthAfter: Number(getFieldValue(decoded, 'healthAfter')),
    commissionRef: String(getFieldValue(decoded, 'commissionRef')),
    evidenceBundleHash: String(getFieldValue(decoded, 'evidenceBundleHash')),
    offchainCount: Number(getFieldValue(decoded, 'offchainCount')),
    crewSize: Number(getFieldValue(decoded, 'crewSize')),
    isLead: Boolean(getFieldValue(decoded, 'isLead')),
  };
}

export function decodeGardenerMilestone(data: string) {
  const encoder = new SchemaEncoder(SCHEMA_STRINGS.GardenerMilestone);
  const decoded = encoder.decodeData(data) as unknown as DecodedField[];
  return {
    milestoneLevel: Number(getFieldValue(decoded, 'milestoneLevel')),
    totalInterventions: Number(getFieldValue(decoded, 'totalInterventions')),
    totalValidated: Number(getFieldValue(decoded, 'totalValidated')),
    avgHealthImprovement: Number(getFieldValue(decoded, 'avgHealthImprovement')),
    skillTier: getFieldValue(decoded, 'skillTier') as string,
    achievedAt: BigInt(String(getFieldValue(decoded, 'achievedAt'))),
    evidenceRoot: String(getFieldValue(decoded, 'evidenceRoot')),
  };
}
