import type {
	InterventionType,
	ScheduledInterventionInput,
} from "@refi-italia/opengarden";
import type { TaskConfig } from "payload";

import {
	getOpenGardenContext,
	type OpenGardenContext,
} from "../lib/openGardenClient";
import {
	createAttestationRecord,
	createInterventionAttestation,
	extractCommissionId,
	failInterventionAndRethrow,
	requireAreaUID,
} from "../lib/taskHelpers";


type ScheduleInterventionInput = {
	/** Payload document id of the `interventions` row to schedule. */
	interventionId: string;
};

type ScheduleInterventionOutput = {
	chainUID: string;
	timestampTxHash: string;
};

/**
 * Task that drives an `interventions` row from `draft` / `failed` →
 * `scheduled` by calling `OpenGardenClient.scheduleIntervention`, writing
 * an `attestations` row, and setting `scheduling.attestation`. Idempotent
 * on retry: an already-scheduled row short-circuits to its existing UID.
 */
export const scheduleInterventionTask: TaskConfig<{
	input: ScheduleInterventionInput;
	output: ScheduleInterventionOutput;
}> = {
	slug: "scheduleIntervention",
	label: "Schedule Intervention on-chain",
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

		const existingAtt = (
			intervention.scheduling as { attestation?: unknown } | undefined
		)?.attestation;
		if (
			intervention.lifecycleStatus === "scheduled" &&
			typeof existingAtt === "object" &&
			existingAtt !== null &&
			(existingAtt as { uid?: string }).uid
		) {
			const att = existingAtt as { uid: string; timestampTxHash?: string };
			return {
				output: {
					chainUID: att.uid,
					timestampTxHash: att.timestampTxHash ?? "",
				},
			};
		}

		if (
			intervention.lifecycleStatus !== "draft" &&
			intervention.lifecycleStatus !== "failed"
		) {
			throw new Error(
				`Intervention ${interventionId} is in lifecycleStatus="${intervention.lifecycleStatus}"; expected "draft" or "failed".`,
			);
		}

		const areaUID = requireAreaUID(intervention.area, `Intervention ${interventionId} →`);

		if (!intervention.scheduling?.scheduledDate) {
			throw new Error(
				`Intervention ${interventionId} is missing scheduling.scheduledDate; the schedule server action must set it before queuing this task.`,
			);
		}
		if (typeof intervention.scheduling.estimatedMinutes !== "number") {
			throw new Error(
				`Intervention ${interventionId} is missing scheduling.estimatedMinutes.`,
			);
		}

		const crew = Array.isArray(intervention.crew) ? intervention.crew : [];
		if (crew.length === 0) {
			throw new Error(
				`Intervention ${interventionId} has an empty crew; cannot schedule.`,
			);
		}

		const lead = crew.find((row) => row?.isCrewLead === true) ?? crew[0];
		const leadGardener = lead?.gardener;
		const crewLead =
			typeof leadGardener === "object" && leadGardener !== null
				? leadGardener.wallet
				: null;
		if (!crewLead) {
			throw new Error(
				`Intervention ${interventionId} crew lead has no wallet; gardener wallets are required for scheduling.`,
			);
		}

		const commissionId = extractCommissionId(intervention);

		const sdkInput: ScheduledInterventionInput = {
			areaUID,
			interventionId: intervention.interventionId,
			interventionType: Number(
				intervention.interventionType,
			) as InterventionType,
			crewLead,
			crewSize: crew.length,
			scheduledDate: new Date(intervention.scheduling.scheduledDate),
			estimatedMinutes: intervention.scheduling.estimatedMinutes,
			description: intervention.description,
			commissionId,
		};

		let context: OpenGardenContext | null = null;
		try {
			context = await getOpenGardenContext(payload);
			const result = await context.client.scheduleIntervention(sdkInput);

			const attestationRow = await createInterventionAttestation(
				req,
				context,
				result,
				interventionId,
				"ScheduledIntervention",
			);

			await payload.update({
				collection: "interventions",
				id: interventionId,
				data: {
					lifecycleStatus: "scheduled",
					scheduling: { attestation: attestationRow.id },
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
			return await failInterventionAndRethrow(req, interventionId, "draft", "scheduleIntervention", err);
		}
	},
};
