"use server";

import configPromise from "@payload-config";
import { headers as nextHeaders } from "next/headers";
import { getPayload } from "payload";
import { scheduleInterventionAction } from "../scheduleIntervention";

type Input = {
	id: string;
	scheduledDate: string;
	estimatedMinutes: number;
};

export type SubmitSchedulingFormResult =
	| { ok: true; jobId: string }
	| { ok: false; error: string };

/**
 * Save scheduling inputs then queue the scheduleIntervention task. The
 * per-stage guard in `guardInterventionInvariants` only accepts
 * `scheduling.{scheduledDate,estimatedMinutes}` while the doc is in
 * `draft` or `failed`, matching the sidebar-button flow.
 */
export async function submitSchedulingForm(
	input: Input,
): Promise<SubmitSchedulingFormResult> {
	const config = await configPromise;
	const payload = await getPayload({ config });
	const { user } = await payload.auth({ headers: await nextHeaders() });
	if (!user) return { ok: false, error: "Unauthorized" };

	try {
		await payload.update({
			collection: "interventions",
			id: input.id,
			data: {
				scheduling: {
					scheduledDate: input.scheduledDate,
					estimatedMinutes: input.estimatedMinutes,
				},
			},
			overrideAccess: false,
			user,
		});
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : "Failed to save scheduling",
		};
	}

	return scheduleInterventionAction(input.id);
}
