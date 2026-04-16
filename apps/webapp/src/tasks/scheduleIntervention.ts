import type {
	InterventionType,
	ScheduledInterventionInput,
} from "@refi-italia/opengarden";
import type { TaskConfig } from "payload";

import {
	getOpenGardenContext,
	type OpenGardenContext,
} from "../lib/openGardenClient";
import { serializeBigInts } from "../lib/serializeBigInts";


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

		const area = intervention.area;
		if (typeof area !== "object" || area === null) {
			throw new Error(
				`Intervention ${interventionId} → area could not be resolved.`,
			);
		}
		const areaAttestation = (area as { attestation?: unknown }).attestation;
		const areaUID =
			typeof areaAttestation === "object" &&
			areaAttestation !== null &&
			typeof (areaAttestation as { uid?: unknown }).uid === "string"
				? (areaAttestation as { uid: string }).uid
				: null;
		if (!areaUID) {
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

			const attestationRow = await payload.create({
				collection: "attestations",
				data: {
					uid: result.uid,
					schemaName: "ScheduledIntervention",
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

			payload.logger.error({
				msg: `scheduleIntervention task failed for intervention ${interventionId}`,
				error: message,
			});

			throw err;
		}
	},
};
