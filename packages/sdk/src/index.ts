// Types

// Client
export { OpenGardenClient } from "./client";
// Lazy DX helper
export {
	type CreateOpenGardenClientConfig,
	createOpenGardenClient,
} from "./connect";
// Constants
export type { ChainName } from "./constants";
export {
	BASE_MAINNET,
	BASE_SEPOLIA,
	CELO_ALFAJORES,
	CELO_MAINNET,
	CHAIN_CONFIGS,
	EVIDENCE_BUNDLE_VERSION,
	getChainConfig,
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
// Schema encoder runtime (advanced — most consumers should use createOpenGardenClient)
export { initEncoders } from "./schemas/encoders";
// Sponsor reference helpers
export type { SponsorRef } from "./sponsor";
export { serializeSponsorRef } from "./sponsor";
export type {
	Area,
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
	FinalizeInterventionInput,
	FinalizeInterventionResult,
} from "./types/evidence";
export type {
	BundleIndexingResult,
	BundleIndexingRole,
	IndexerSubmissionResult,
	OnChainAttestationResult,
	SchemaRegistrationResult,
	TimestampedOffChainResult,
} from "./types/results";
export type {
	AreaRegistrationInput,
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
// Verification helpers
export type {
	TimestampFetcher,
	VerificationCheck,
} from "./verification";
export {
	VerificationCheckCode,
	verifyBundleExecutionDateBracket,
	verifyBundleOnChainTimestamps,
	verifyBundleTemporalOrder,
	verifyBundleVersion,
} from "./verification";
