"use server";

import configPromise from "@payload-config";
import { headers as nextHeaders } from "next/headers";
import { getPayload } from "payload";
import { publishInterventionAction } from "../publishIntervention";

type Input = {
	id: string;
	executionDate: string;
	healthBefore: number;
	healthAfter: number;
};

export type SubmitExecutionFormResult =
	| { ok: true; jobId: string }
	| { ok: false; error: string };

/**
 * Save execution inputs then queue the publishIntervention task. The
 * per-stage guard only accepts `execution.{executionDate,healthBefore,healthAfter}`
 * while the doc is in `validated`. Publishing additionally requires an
 * evidence bundle in `uploaded` state — if missing, the publish task
 * errors and the transition is rejected.
 */
export async function submitExecutionForm(
	input: Input,
): Promise<SubmitExecutionFormResult> {
	const config = await configPromise;
	const payload = await getPayload({ config });
	const { user } = await payload.auth({ headers: await nextHeaders() });
	if (!user) return { ok: false, error: "Unauthorized" };

	try {
		await payload.update({
			collection: "interventions",
			id: input.id,
			data: {
				execution: {
					executionDate: input.executionDate,
					healthBefore: input.healthBefore,
					healthAfter: input.healthAfter,
				},
			},
			overrideAccess: false,
			user,
		});
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : "Failed to save execution",
		};
	}

	return publishInterventionAction(input.id);
}
