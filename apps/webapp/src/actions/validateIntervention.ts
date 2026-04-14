"use server";

import configPromise from "@payload-config";
import { headers as nextHeaders } from "next/headers";
import { after } from "next/server";
import { getPayload } from "payload";

export type ValidateInterventionActionResult =
	| { ok: true; jobId: number | string }
	| { ok: false; error: string };

/**
 * Thin trigger for the `validateIntervention` task. The validator
 * fills `validation.approved` / `qualityScore` / `feedback` /
 * `validator` on the form (relaxed freeze allows it while
 * `lifecycleStatus === "in_progress"`), then clicks Validate to
 * commit the off-chain attestation.
 */
export async function validateInterventionAction(
	interventionId: number,
): Promise<ValidateInterventionActionResult> {
	const config = await configPromise;
	const payload = await getPayload({ config });

	const { user } = await payload.auth({ headers: await nextHeaders() });
	if (!user) return { ok: false, error: "Unauthorized" };
	const roles = user.roles ?? [];
	if (
		!roles.includes("admin") &&
		!roles.includes("manager") &&
		!roles.includes("validator")
	) {
		return { ok: false, error: "Forbidden — requires validator role" };
	}

	try {
		const job = await payload.jobs.queue({
			task: "validateIntervention",
			input: { interventionId },
			queue: "default",
		});

		after(async () => {
			try {
				await payload.jobs.run({ queue: "default", limit: 1 });
			} catch (err) {
				payload.logger.error({
					msg: "validateInterventionAction: after() run failed — relying on cron safety net",
					err: err instanceof Error ? err.message : String(err),
				});
			}
		});

		return { ok: true, jobId: job.id };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
