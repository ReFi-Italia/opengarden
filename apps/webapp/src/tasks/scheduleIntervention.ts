import type {
	InterventionType,
	ScheduleActivityInput,
} from "@refi-italia/opengarden";
import type { TaskConfig } from "payload";

import {
	getOpenGardenContext,
	type OpenGardenContext,
} from "../lib/openGardenClient";
import {
	cancelInterventionAndRethrow,
	createInterventionAttestation,
	extractCommissionId,
	requireAreaUID,
} from "../lib/taskHelpers";

type ScheduleInterventionInput = {
	/** Payload document id of the `interventions` row to schedule. */
	interventionId: string;
};

type ScheduleInterventionOutput = {
	chainUID: string;
	timestampTxHash: string;
	activityId: string;
};

/**
 * Drives an `interventions` row from `draft` → `scheduled`:
 *
 *   1. Calls `client.scheduleIntervention(...)` — SDK signs an off-chain
 *      schedule Activity + timestamps its UID on-chain.
 *   2. Persists the returned attestation in `attestations` (schemaName=Activity).
 *   3. Creates an `activities` row with `type: "schedule"`, `data` = SDK payload
 *      (normalized by the SDK, guaranteed to hash back to the signed
 *      `payloadHash`), and `attestation` linking to the row from step 2.
 *   4. Points `intervention.scheduling.attestation` at the same attestation.
 *   5. Flips `intervention.lifecycleStatus` to `scheduled`.
 *
 * Idempotent: already-scheduled rows short-circuit to the existing uid.
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
		{ name: "activityId", type: "text", required: true },
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
			const existingActivity = await payload
				.find({
					collection: "activities",
					where: {
						and: [
							{ intervention: { equals: interventionId } },
							{ type: { equals: "schedule" } },
						],
					},
					limit: 1,
					depth: 0,
					overrideAccess: true,
					req,
				})
				.catch(() => ({ docs: [] as Array<{ id: string | number }> }));
			return {
				output: {
					chainUID: att.uid,
					timestampTxHash: att.timestampTxHash ?? "",
					activityId: String(existingActivity.docs[0]?.id ?? ""),
				},
			};
		}

		if (intervention.lifecycleStatus !== "draft") {
			throw new Error(
				`Intervention ${interventionId} is in lifecycleStatus="${intervention.lifecycleStatus}"; expected "draft".`,
			);
		}

		const areaUID = requireAreaUID(
			intervention.area,
			`Intervention ${interventionId} →`,
		);

		if (!intervention.scheduling?.scheduledDate) {
			throw new Error(
				`Intervention ${interventionId} is missing scheduling.scheduledDate.`,
			);
		}
		if (typeof intervention.scheduling.plannedDuration !== "number") {
			throw new Error(
				`Intervention ${interventionId} is missing scheduling.plannedDuration.`,
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
				`Intervention ${interventionId} crew lead has no wallet.`,
			);
		}

		const commissionId = extractCommissionId(intervention);

		const tasksPlanned = Array.isArray(intervention.tasks)
			? intervention.tasks
					.map((t) => (t as { code?: string }).code)
					.filter((c): c is string => typeof c === "string")
			: [];

		const scheduledDate = new Date(intervention.scheduling.scheduledDate);

		const sdkInput: ScheduleActivityInput = {
			areaUID,
			interventionId: intervention.interventionId,
			interventionType: Number(
				intervention.interventionType,
			) as InterventionType,
			crewLead,
			crewSize: crew.length,
			scheduledDate,
			plannedDuration: intervention.scheduling.plannedDuration,
			tasksPlanned,
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
				"Activity",
			);

			// Find the lead's activities-collection id for the gardener relation.
			const leadGardenerId =
				typeof leadGardener === "object" && leadGardener !== null
					? (leadGardener as { id?: string | number }).id
					: null;

			const activityRow = await payload.create({
				collection: "activities",
				data: {
					type: "schedule",
					intervention: interventionId,
					...(leadGardenerId !== null && leadGardenerId !== undefined
						? { gardener: String(leadGardenerId) }
						: {}),
					data: result.payload as Record<string, unknown>,
					claimedTimestamp: scheduledDate.toISOString(),
					attestation: attestationRow.id,
				},
				overrideAccess: true,
				// Activities collection blocks form creates; this is a server-side
				// write so we bypass the read-only access via overrideAccess.
				// We also set the attestation immediately, so queueChainCommit is
				// a no-op (it short-circuits when an attestation is already set).
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
					activityId: String(activityRow.id),
				},
			};
		} catch (err) {
			return await cancelInterventionAndRethrow(
				req,
				interventionId,
				"draft",
				"scheduleIntervention",
				err,
			);
		}
	},
};
