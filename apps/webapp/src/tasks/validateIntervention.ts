import type { AdminValidationInput } from "@refi-italia/opengarden";
import type { TaskConfig } from "payload";

import {
	getOpenGardenContext,
	type OpenGardenContext,
} from "../lib/openGardenClient";
import { recordChainTransaction } from "../lib/recordChainTransaction";

type ValidateInterventionInput = {
	/** Payload document id of the `interventions` row to validate. */
	interventionId: number;
};

type ValidateInterventionOutput = {
	chainUID: string;
	timestampTxHash: string;
};

/**
 * Task that drives an `interventions` row from `in_progress` →
 * `validated` by calling `OpenGardenClient.validateIntervention` and
 * populating the `validation.chain.*` mirror. Assumes the validation
 * input fields (`approved`, `qualityScore`, `feedback`, `validator`)
 * have already been written by the validate server action via
 * `skipLifecycleHooks: true`.
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
			type: "number",
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

		if (
			intervention.lifecycleStatus === "validated" &&
			intervention.validation?.chainUID
		) {
			return {
				output: {
					chainUID: intervention.validation.chainUID,
					timestampTxHash: intervention.validation.txHash ?? "",
				},
			};
		}

		if (intervention.lifecycleStatus !== "in_progress") {
			throw new Error(
				`Intervention ${interventionId} is in lifecycleStatus="${intervention.lifecycleStatus}"; expected "in_progress".`,
			);
		}

		const scheduleUID = intervention.scheduling?.chainUID;
		if (!scheduleUID) {
			throw new Error(
				`Intervention ${interventionId} has no scheduling.chainUID; schedule it before validating.`,
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
		const validatorIdHash =
			typeof validator === "object" &&
			validator !== null &&
			typeof validator.staffIdHash === "string"
				? validator.staffIdHash
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

			await payload.update({
				collection: "interventions",
				id: interventionId,
				data: {
					lifecycleStatus: "validated",
					validation: {
						validatorIdHashAtValidation: validatorIdHash ?? undefined,
						chainUID: result.uid,
						txHash: result.timestampTxHash,
						onchainTimestamp: Number(result.onchainTimestamp),
						attesterWallet: context.attesterWallet,
						chainIdSnapshot: context.chainId,
						signedAttestation: result.signedAttestation,
					},
				},
				overrideAccess: true,
				context: { skipLifecycleHooks: true },
				req,
			});

			await recordChainTransaction({
				payload,
				req,
				kind: "validateIntervention",
				relatedCollection: "interventions",
				relatedId: interventionId,
				status: "success",
				txHash: result.timestampTxHash,
				chainUID: result.uid,
				chainId: context.chainId,
				attesterWallet: context.attesterWallet,
				payloadJson: sdkInput,
				resultJson: {
					uid: result.uid,
					timestampTxHash: result.timestampTxHash,
					onchainTimestamp: String(result.onchainTimestamp),
				},
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

			await recordChainTransaction({
				payload,
				req,
				kind: "validateIntervention",
				relatedCollection: "interventions",
				relatedId: interventionId,
				status: "failed",
				error: message,
				chainId: context?.chainId,
				attesterWallet: context?.attesterWallet,
				payloadJson: sdkInput,
			}).catch(() => undefined);

			throw err;
		}
	},
};
