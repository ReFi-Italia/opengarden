import type { AdminValidationInput } from "@refi-italia/opengarden";
import type { TaskConfig } from "payload";

import {
	getOpenGardenContext,
	type OpenGardenContext,
} from "../lib/openGardenClient";
import { serializeBigInts } from "../lib/serializeBigInts";


type ValidateInterventionInput = {
	/** Payload document id of the `interventions` row to validate. */
	interventionId: string;
};

type ValidateInterventionOutput = {
	chainUID: string;
	timestampTxHash: string;
};

/**
 * Task that drives an `interventions` row from `in_progress` →
 * `validated` by calling `OpenGardenClient.validateIntervention`, writing
 * an `attestations` row, and setting `validation.attestation`. Assumes
 * the validation input fields (`approved`, `qualityScore`, `feedback`,
 * `validator`) have already been written by the validate server action
 * via `skipLifecycleHooks: true`.
 */
export const validateInterventionTask: TaskConfig<{
	input: ValidateInterventionInput;
	output: ValidateInterventionOutput;
}> = {
	slug: "validateIntervention",
	label: "Validate Intervention off-chain",
	retries: {
		attempts: 3,
		backoff: { type: "exponential", delay: 5_000 },
	},
	inputSchema: [
		{
			name: "interventionId",
			type: "text",
			required: true,
		},
	],
	outputSchema: [
		{ name: "chainUID", type: "text", required: true },
		{ name: "timestampTxHash", type: "text", required: true },
	],
	handler: async ({ input, req }) => {
		const { payload } = req;
		const { interventionId } = input;

		const intervention = await payload.findByID({
			collection: "interventions",
			id: interventionId,
			depth: 2,
			req,
			overrideAccess: true,
		});

		const existingValAtt = (
			intervention.validation as { attestation?: unknown } | undefined
		)?.attestation;
		if (
			intervention.lifecycleStatus === "validated" &&
			typeof existingValAtt === "object" &&
			existingValAtt !== null &&
			(existingValAtt as { uid?: string }).uid
		) {
			const att = existingValAtt as { uid: string; timestampTxHash?: string };
			return {
				output: {
					chainUID: att.uid,
					timestampTxHash: att.timestampTxHash ?? "",
				},
			};
		}

		if (intervention.lifecycleStatus !== "in_progress") {
			throw new Error(
				`Intervention ${interventionId} is in lifecycleStatus="${intervention.lifecycleStatus}"; expected "in_progress".`,
			);
		}

		const schedAtt = (
			intervention.scheduling as { attestation?: unknown } | undefined
		)?.attestation;
		const scheduleUID =
			typeof schedAtt === "object" &&
			schedAtt !== null &&
			typeof (schedAtt as { uid?: unknown }).uid === "string"
				? (schedAtt as { uid: string }).uid
				: null;
		if (!scheduleUID) {
			throw new Error(
				`Intervention ${interventionId} has no scheduling.attestation.uid; schedule it before validating.`,
			);
		}

		const validation = intervention.validation;
		if (!validation || typeof validation.approved !== "boolean") {
			throw new Error(
				`Intervention ${interventionId} is missing validation.approved; the validate server action must set it before queuing this task.`,
			);
		}
		if (typeof validation.qualityScore !== "number") {
			throw new Error(
				`Intervention ${interventionId} is missing validation.qualityScore.`,
			);
		}
		if (typeof validation.feedback !== "string") {
			throw new Error(
				`Intervention ${interventionId} is missing validation.feedback.`,
			);
		}

		const validator = validation.validator;
		const validatorId =
			typeof validator === "object" &&
			validator !== null &&
			typeof validator.staffId === "string"
				? validator.staffId
				: null;
		const sdkInput: AdminValidationInput = {
			scheduleUID,
			approved: validation.approved,
			qualityScore: validation.qualityScore,
			feedback: validation.feedback,
			validatorId,
		};

		let context: OpenGardenContext | null = null;
		try {
			context = await getOpenGardenContext(payload);
			const result = await context.client.validateIntervention(sdkInput);

			const attestationRow = await payload.create({
				collection: "attestations",
				data: {
					uid: result.uid,
					schemaName: "AdminValidation",
					signedAttestation: serializeBigInts(result.signedAttestation) as unknown as Record<string, unknown>,
					timestampTxHash: result.timestampTxHash,
					onchainTimestamp: Number(result.onchainTimestamp),
					chainIdSnapshot: context.chainId,
					attesterWallet: context.attesterWallet,
					status: "committed",
					relatedCollection: "interventions",
					relatedId: interventionId,
				},
				overrideAccess: true,
				req,
			});

			await payload.update({
				collection: "interventions",
				id: interventionId,
				data: {
					lifecycleStatus: "validated",
					validation: { attestation: attestationRow.id },
				},
				overrideAccess: true,
				context: { skipLifecycleHooks: true },
				req,
			});

			return {
				output: {
					chainUID: result.uid,
					timestampTxHash: result.timestampTxHash,
				},
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);

			await payload
				.update({
					collection: "interventions",
					id: interventionId,
					data: {
						lifecycleStatus: "failed",
						revocation: {
							failedFrom: "in_progress",
						},
					},
					overrideAccess: true,
					context: { skipLifecycleHooks: true },
					req,
				})
				.catch(() => undefined);

			payload.logger.error({
				msg: `validateIntervention task failed for intervention ${interventionId}`,
				error: message,
			});

			throw err;
		}
	},
};
