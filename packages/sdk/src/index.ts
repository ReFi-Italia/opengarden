// Types

// Client
export { OpenGardenClient } from "./client";
// Constants
export {
	BASE_MAINNET,
	BASE_SEPOLIA,
	CELO_ALFAJORES,
	CELO_MAINNET,
	EVIDENCE_BUNDLE_VERSION,
	OPTIMISM_MAINNET,
	OPTIMISM_SEPOLIA,
	SCHEMA_NAME_UID,
	ZERO_ADDRESS,
	ZERO_BYTES32,
} from "./constants";
// Errors
export { OpenGardenError, OpenGardenErrorCode } from "./errors";
// Evidence bundle builder
export { buildEvidenceBundle } from "./evidence";
// Indexer
export { getGraphqlUrl, getStoreUrl, submitToIndexer } from "./indexer";
// Preflight validation & inspection helpers
export type {
	AttestationMetadata,
	FinalizeInputIssue,
} from "./preflight";
export {
	assertAttesterMatches,
	assertRefUIDMatches,
	extractAttestationMetadata,
	FinalizeInputIssueCode,
	validateFinalizeInput,
} from "./preflight";
export type { SchemaDefinition } from "./schemas/definitions";
// Schema definitions
export { SCHEMA_DEFINITIONS, SCHEMA_STRINGS } from "./schemas/definitions";
export type {
	Area,
	CitizenFeedback,
	EvidenceBundleVerification,
	Healthcheck,
	Intervention,
	Milestone,
	ScheduledIntervention,
} from "./types/attestation";
export type {
	ChainConfig,
	OpenGardenConfig,
	SchemaUIDs,
	StorageAdapter,
} from "./types/config";
export type { SchemaName } from "./types/enums";
export { AreaType, InterventionType, MilestoneLevel } from "./types/enums";
export type {
	EvidenceBundle,
	EvidenceBundleAttestation,
	EvidenceBundleBuilderInput,
	EvidenceBundleGardenerAttestation,
	EvidenceBundleHealthcheck,
	EvidenceBundleValidation,
	FinalizeInterventionInput,
	FinalizeInterventionResult,
} from "./types/evidence";
export type {
	OffChainAttestationResult,
	OnChainAttestationResult,
	SchemaRegistrationResult,
	TimestampedOffChainResult,
} from "./types/results";
export type {
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
// Utilities
export {
	fromMicrodegrees,
	hashIdentifier,
	hashPhotoBundle,
	toMicrodegrees,
	toUnixSeconds,
} from "./utils";
