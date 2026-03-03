// Types
export type { SchemaName } from './types/enums';
export { AreaType, InterventionType, MilestoneLevel } from './types/enums';

export type {
  ChainConfig,
  StorageAdapter,
  SchemaUIDs,
  OpenGardenConfig,
} from './types/config';

export type {
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

export type {
  OnChainAttestationResult,
  TimestampedOffChainResult,
  OffChainAttestationResult,
  SchemaRegistrationResult,
} from './types/results';

export type {
  Area,
  Intervention,
  Milestone,
  EvidenceBundleVerification,
} from './types/attestation';

export type {
  EvidenceBundle,
  EvidenceBundleAttestation,
  EvidenceBundleValidation,
  EvidenceBundleHealthcheck,
  EvidenceBundleBuilderInput,
} from './types/evidence';

// Constants
export {
  ZERO_ADDRESS,
  ZERO_BYTES32,
  CELO_MAINNET,
  CELO_ALFAJORES,
  OPTIMISM_MAINNET,
  OPTIMISM_SEPOLIA,
  BASE_MAINNET,
  BASE_SEPOLIA,
} from './constants';

// Errors
export { OpenGardenError, OpenGardenErrorCode } from './errors';

// Schema definitions
export { SCHEMA_STRINGS, SCHEMA_DEFINITIONS } from './schemas/definitions';
export type { SchemaDefinition } from './schemas/definitions';

// Utilities
export { toMicrodegrees, fromMicrodegrees } from './utils';

// Evidence bundle builder
export { buildEvidenceBundle } from './evidence';

// Client
export { OpenGardenClient } from './client';
