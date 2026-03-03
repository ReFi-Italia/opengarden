export enum OpenGardenErrorCode {
	SCHEMA_NOT_REGISTERED = "SCHEMA_NOT_REGISTERED",
	ATTESTATION_NOT_FOUND = "ATTESTATION_NOT_FOUND",
	INVALID_INPUT = "INVALID_INPUT",
	TRANSACTION_FAILED = "TRANSACTION_FAILED",
	TIMESTAMP_MISMATCH = "TIMESTAMP_MISMATCH",
	BUNDLE_VERIFICATION_FAILED = "BUNDLE_VERIFICATION_FAILED",
	STORAGE_NOT_CONFIGURED = "STORAGE_NOT_CONFIGURED",
	SIGNER_ERROR = "SIGNER_ERROR",
}

export class OpenGardenError extends Error {
	readonly code: OpenGardenErrorCode;

	constructor(code: OpenGardenErrorCode, message: string) {
		super(message);
		this.name = "OpenGardenError";
		this.code = code;
	}
}
