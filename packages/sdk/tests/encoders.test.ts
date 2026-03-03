import { describe, it, expect } from 'vitest';
import { SchemaEncoder } from '@ethereum-attestation-service/eas-sdk';
import { SCHEMA_STRINGS } from '../src/schemas/definitions';
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
} from '../src/schemas/encoders';
import { ZERO_BYTES32 } from '../src/constants';

describe('AreaRegistration encoder', () => {
  const input = {
    areaId: 'RM-PIGN-042',
    latitude: 41.89,
    longitude: 12.4964,
    areaType: 0,
    name: 'Giardino Via Appia 12',
    municipality: 'RM-I',
    metadataHash: ZERO_BYTES32,
  };

  it('encodes and decodes roundtrip', () => {
    const encoded = encodeAreaRegistration(input);
    expect(encoded).toBeTruthy();
    expect(typeof encoded).toBe('string');
    expect(encoded.startsWith('0x')).toBe(true);

    const decoded = decodeAreaRegistration(encoded);
    expect(decoded.areaId).toBe('RM-PIGN-042');
    expect(decoded.latitude).toBeCloseTo(41.89, 4);
    expect(decoded.longitude).toBeCloseTo(12.4964, 4);
    expect(decoded.areaType).toBe(0);
    expect(decoded.name).toBe('Giardino Via Appia 12');
    expect(decoded.municipality).toBe('RM-I');
  });

  it('produces valid ABI-encoded data', () => {
    const encoded = encodeAreaRegistration(input);
    const encoder = new SchemaEncoder(SCHEMA_STRINGS.AreaRegistration);
    expect(encoder.isEncodedDataValid(encoded)).toBe(true);
  });
});

describe('PublishedIntervention encoder', () => {
  const input = {
    areaUID: ZERO_BYTES32,
    interventionId: 'INT-2026-0001',
    gardener: '0x0000000000000000000000000000000000000001',
    interventionType: 0,
    executionDate: 1709251200n,
    healthBefore: 3,
    healthAfter: 8,
    commissionRef: ZERO_BYTES32,
    evidenceBundleHash: ZERO_BYTES32,
    offchainCount: 5,
    crewSize: 2,
    isLead: true,
  };

  it('encodes and decodes roundtrip', () => {
    const encoded = encodePublishedIntervention(input);
    const decoded = decodePublishedIntervention(encoded);
    expect(decoded.interventionId).toBe('INT-2026-0001');
    expect(decoded.interventionType).toBe(0);
    expect(decoded.executionDate).toBe(1709251200n);
    expect(decoded.healthBefore).toBe(3);
    expect(decoded.healthAfter).toBe(8);
    expect(decoded.offchainCount).toBe(5);
    expect(decoded.crewSize).toBe(2);
    expect(decoded.isLead).toBe(true);
  });
});

describe('GardenerMilestone encoder', () => {
  const input = {
    recipient: '0x0000000000000000000000000000000000000001',
    milestoneLevel: 2,
    totalInterventions: 15,
    totalValidated: 14,
    avgHealthImprovement: 4,
    skillTier: 'Certified Urban Gardener — Level 2',
    achievedAt: 1709424000n,
    evidenceRoot: ZERO_BYTES32,
  };

  it('encodes and decodes roundtrip', () => {
    const encoded = encodeGardenerMilestone(input);
    const decoded = decodeGardenerMilestone(encoded);
    expect(decoded.milestoneLevel).toBe(2);
    expect(decoded.totalInterventions).toBe(15);
    expect(decoded.totalValidated).toBe(14);
    expect(decoded.avgHealthImprovement).toBe(4);
    expect(decoded.skillTier).toBe('Certified Urban Gardener — Level 2');
    expect(decoded.achievedAt).toBe(1709424000n);
  });
});

describe('ScheduledIntervention encoder', () => {
  it('encodes without error', () => {
    const encoded = encodeScheduledIntervention({
      areaUID: ZERO_BYTES32,
      interventionId: 'INT-2026-0002',
      interventionType: 1,
      assignedGardener: '0x0000000000000000000000000000000000000001',
      crewSize: 3,
      scheduledDate: 1709337600n,
      estimatedMinutes: 120,
      description: 'Restoration of flower beds',
      commissionRef: ZERO_BYTES32,
    });
    expect(encoded).toBeTruthy();
    const encoder = new SchemaEncoder(SCHEMA_STRINGS.ScheduledIntervention);
    expect(encoder.isEncodedDataValid(encoded)).toBe(true);
  });
});

describe('GardenerCheckin encoder', () => {
  it('encodes with coordinate conversion', () => {
    const encoded = encodeGardenerCheckin({
      interventionUID: ZERO_BYTES32,
      latitude: 41.89,
      longitude: 12.4964,
      timestamp: 1709337600n,
      photoHash: ZERO_BYTES32,
    });
    expect(encoded).toBeTruthy();
    const encoder = new SchemaEncoder(SCHEMA_STRINGS.GardenerCheckin);
    expect(encoder.isEncodedDataValid(encoded)).toBe(true);
  });
});

describe('GardenerCheckout encoder', () => {
  it('encodes without error', () => {
    const encoded = encodeGardenerCheckout({
      checkinUID: ZERO_BYTES32,
      timestamp: 1709344800n,
      actualMinutes: 90,
    });
    expect(encoded).toBeTruthy();
    const encoder = new SchemaEncoder(SCHEMA_STRINGS.GardenerCheckout);
    expect(encoder.isEncodedDataValid(encoded)).toBe(true);
  });
});

describe('GardenerReport encoder', () => {
  it('encodes without error', () => {
    const encoded = encodeGardenerReport({
      interventionUID: ZERO_BYTES32,
      checkoutUID: ZERO_BYTES32,
      tasksCompleted: 'PRUNE,CLEAN,WATER',
      taskCount: 3,
      photosHash: ZERO_BYTES32,
      notes: 'All tasks completed. Rose beds pruned.',
    });
    expect(encoded).toBeTruthy();
    const encoder = new SchemaEncoder(SCHEMA_STRINGS.GardenerReport);
    expect(encoder.isEncodedDataValid(encoded)).toBe(true);
  });
});

describe('AdminValidation encoder', () => {
  it('encodes without error', () => {
    const encoded = encodeAdminValidation({
      gardener: '0x0000000000000000000000000000000000000001',
      reportUID: ZERO_BYTES32,
      approved: true,
      qualityScore: 8,
      feedback: 'Good work.',
      validatorId: ZERO_BYTES32,
    });
    expect(encoded).toBeTruthy();
    const encoder = new SchemaEncoder(SCHEMA_STRINGS.AdminValidation);
    expect(encoder.isEncodedDataValid(encoded)).toBe(true);
  });
});

describe('CitizenFeedback encoder', () => {
  it('encodes without error', () => {
    const encoded = encodeCitizenFeedback({
      areaUID: ZERO_BYTES32,
      rating: 4,
      comment: 'The park looks much better now!',
      photoHash: ZERO_BYTES32,
    });
    expect(encoded).toBeTruthy();
    const encoder = new SchemaEncoder(SCHEMA_STRINGS.CitizenFeedback);
    expect(encoder.isEncodedDataValid(encoded)).toBe(true);
  });
});

describe('Healthcheck encoder', () => {
  it('encodes without error', () => {
    const encoded = encodeHealthcheck({
      areaUID: ZERO_BYTES32,
      healthScore: 7,
      photoHash: ZERO_BYTES32,
      assessorNotes: 'Good condition overall, minor weeding needed',
      interventionNeeded: false,
    });
    expect(encoded).toBeTruthy();
    const encoder = new SchemaEncoder(SCHEMA_STRINGS.Healthcheck);
    expect(encoder.isEncodedDataValid(encoded)).toBe(true);
  });
});
