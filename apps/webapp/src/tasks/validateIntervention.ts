// FIXME (spec-refactor): The OpenGarden Protocol has no "AdminValidation"
// on-chain attestation. Per spec §2.2, internal QA fields (approved flag,
// quality score, reviewer feedback) live in the organization's database,
// outside the verifiable envelope. Publication is the quality sign-off.
//
// The old SDK method `client.validateIntervention` and the
// `AdminValidationInput` type have been removed. This task now just flips
// the intervention's lifecycle state from `in_progress` → `completed`
// after the completion-review server action has written the reviewer inputs.
// It performs no on-chain work.
import type { TaskConfig } from "payload";

import { cancelInterventionAndRethrow } from "../lib/taskHelpers";

type CompleteInterventionInput = {
	interventionId: string;
};

type CompleteInterventionOutput = {
	interventionId: string;
};

export const validateInterventionTask: TaskConfig<{
	input: CompleteInterventionInput;
	output: CompleteInterventionOutput;
}> = {
	slug: "validateIntervention",
	label: "Complete intervention review (off-chain state flip)",
	retries: {
		attempts: 2,
		backoff: { type: "exponential", delay: 2_000 },
	},
	inputSchema: [{ name: "interventionId", type: "text", required: true }],
	outputSchema: [{ name: "interventionId", type: "text", required: true }],
	handler: async ({ input, req }) => {
		const { payload } = req;
		const { interventionId } = input;

		const intervention = await payload.findByID({
			collection: "interventions",
			id: interventionId,
			depth: 1,
			req,
			overrideAccess: true,
		});

		if (intervention.lifecycleStatus === "completed") {
			return { output: { interventionId } };
		}
		if (intervention.lifecycleStatus !== "in_progress") {
			throw new Error(
				`Intervention ${interventionId} is in lifecycleStatus="${intervention.lifecycleStatus}"; expected "in_progress".`,
			);
		}

		const completion = (
			intervention as { completion?: Record<string, unknown> }
		).completion;
		if (!completion || typeof completion.approved !== "boolean") {
			throw new Error(
				`Intervention ${interventionId} is missing completion.approved.`,
			);
		}

		try {
			await payload.update({
				collection: "interventions",
				id: interventionId,
				data: { lifecycleStatus: "completed" },
				overrideAccess: true,
				context: { skipLifecycleHooks: true },
				req,
			});
			return { output: { interventionId } };
		} catch (err) {
			return await cancelInterventionAndRethrow(
				req,
				interventionId,
				"in_progress",
				"validateIntervention",
				err,
			);
		}
	},
};
