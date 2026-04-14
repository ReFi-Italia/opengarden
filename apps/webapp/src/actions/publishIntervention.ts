"use server";

import configPromise from "@payload-config";
import { headers as nextHeaders } from "next/headers";
import { after } from "next/server";
import { getPayload } from "payload";

export type PublishInterventionActionResult =
	| { ok: true; jobId: string }
	| { ok: false; error: string };

/**
 * Thin trigger for the `publishIntervention` task. Operator fills
 * `execution.executionDate` / `healthBefore` / `healthAfter` on the
 * form (relaxed freeze allows it while
 * `lifecycleStatus === "validated"`), ensures the linked evidence
 * bundle is in `uploaded` state, then clicks Publish to commit the
 * on-chain `PublishedIntervention` attestation.
 */
export async function publishInterventionAction(
	interventionId: string,
): Promise<PublishInterventionActionResult> {
	const config = await configPromise;
	const payload = await getPayload({ config });

	const { user } = await payload.auth({ headers: await nextHeaders() });
	if (!user) return { ok: false, error: "Unauthorized" };
	const roles = user.roles ?? [];
	if (!roles.includes("admin") && !roles.includes("manager")) {
		return { ok: false, error: "Forbidden — requires admin or manager role" };
	}

	try {
		const job = await payload.jobs.queue({
			task: "publishIntervention",
			input: { interventionId },
			queue: "default",
		});

		after(async () => {
			try {
				await payload.jobs.run({ queue: "default", limit: 1 });
			} catch (err) {
				payload.logger.error({
					msg: "publishInterventionAction: after() run failed — relying on cron safety net",
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
