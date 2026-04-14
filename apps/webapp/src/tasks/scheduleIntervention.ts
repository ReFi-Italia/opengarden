import type {
	InterventionType,
	ScheduledInterventionInput,
} from "@refi-italia/opengarden";
import type { TaskConfig } from "payload";

import {
	getOpenGardenContext,
	type OpenGardenContext,
} from "../lib/openGardenClient";
import { recordChainTransaction } from "../lib/recordChainTransaction";

type ScheduleInterventionInput = {
	/** Payload document id of the `interventions` row to schedule. */
	interventionId: number;
};

type ScheduleInterventionOutput = {
	chainUID: string;
	timestampTxHash: string;
};

/**
 * Task that drives an `interventions` row from `draft` / `failed` →
 * `scheduled` by calling `OpenGardenClient.scheduleIntervention` and
 * populating the `scheduling.chain.*` mirror. Idempotent on retry: an
 * already-scheduled row short-circuits to its existing UID.
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
			intervention.lifecycleStatus === "scheduled" &&
			intervention.scheduling?.chainUID
		) {
			return {
				output: {
					chainUID: intervention.scheduling.chainUID,
					timestampTxHash: intervention.scheduling.txHash ?? "",
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

		const area = intervention.area;
		if (typeof area !== "object" || area === null || !area.chain?.chainUID) {
			throw new Error(
				`Intervention ${interventionId} → area has no on-chain UID. Register the area first.`,
			);
		}

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

		const sponsor = intervention.commissioning?.sponsor;
		const commissionId =
			typeof sponsor === "object" &&
			sponsor !== null &&
			sponsor.kind !== "volunteer" &&
			typeof sponsor.canonicalJson === "string" &&
			sponsor.canonicalJson.length > 0
				? sponsor.canonicalJson
				: null;

		const sdkInput: ScheduledInterventionInput = {
			areaUID: area.chain.chainUID,
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

			await payload.update({
				collection: "interventions",
				id: interventionId,
				data: {
					lifecycleStatus: "scheduled",
					scheduling: {
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
				kind: "scheduleIntervention",
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
							failedFrom: "draft",
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
				kind: "scheduleIntervention",
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
