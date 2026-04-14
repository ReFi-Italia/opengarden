"use server";

import configPromise from "@payload-config";
import { headers as nextHeaders } from "next/headers";
import { after } from "next/server";
import { getPayload } from "payload";

export type ScheduleInterventionActionResult =
	| { ok: true; jobId: string }
	| { ok: false; error: string };

/**
 * Thin trigger for the `scheduleIntervention` task. Authenticates,
 * gates on role, queues the job, and kicks an in-process drain via
 * Next.js `after()` so the UI gets a fast ack.
 */
export async function scheduleInterventionAction(
	interventionId: string,
): Promise<ScheduleInterventionActionResult> {
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
			task: "scheduleIntervention",
			input: { interventionId },
			queue: "default",
		});

		after(async () => {
			try {
				await payload.jobs.run({ queue: "default", limit: 1 });
			} catch (err) {
				payload.logger.error({
					msg: "scheduleInterventionAction: after() run failed — relying on cron safety net",
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
