"use server";

import configPromise from "@payload-config";
import { headers as nextHeaders } from "next/headers";
import { getPayload } from "payload";
import { validateInterventionAction } from "../validateIntervention";

type Input = {
	id: string;
	validator: string;
	approved: boolean;
	qualityScore: number;
	feedback: string;
};

export type SubmitValidationFormResult =
	| { ok: true; jobId: string }
	| { ok: false; error: string };

/**
 * Save validation inputs then queue the validateIntervention task. The
 * per-stage guard only accepts `validation.{validator,approved,qualityScore,feedback}`
 * while the doc is in `in_progress`.
 */
export async function submitValidationForm(
	input: Input,
): Promise<SubmitValidationFormResult> {
	const config = await configPromise;
	const payload = await getPayload({ config });
	const { user } = await payload.auth({ headers: await nextHeaders() });
	if (!user) return { ok: false, error: "Unauthorized" };

	try {
		await payload.update({
			collection: "interventions",
			id: input.id,
			data: {
				validation: {
					validator: input.validator,
					approved: input.approved,
					qualityScore: input.qualityScore,
					feedback: input.feedback,
				},
			},
			overrideAccess: false,
			user,
		});
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : "Failed to save validation",
		};
	}

	return validateInterventionAction(input.id);
}
