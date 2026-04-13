"use server";

import configPromise from "@payload-config";
import { headers as nextHeaders } from "next/headers";
import { after } from "next/server";
import { getPayload } from "payload";

export type RegisterAreaActionResult =
	| { ok: true; jobId: number | string }
	| { ok: false; error: string };

/**
 * Thin trigger for the `registerArea` task. Intended to be called from a
 * custom admin button on the areas edit view.
 *
 * Flow:
 *   1. Authenticate via Payload's Local API + Next.js request headers.
 *   2. Guard on role (manager or admin can commit on-chain gas).
 *   3. Enqueue the job via `payload.jobs.queue`.
 *   4. Use Next.js `after()` to kick off an immediate in-process run AFTER
 *      the response returns, so the UI gets a fast ack and doesn't block on
 *      the chain call. The `vercel.json` cron is the safety net if the
 *      `after()` execution context is torn down before completion.
 */
export async function registerAreaAction(
	areaId: number,
): Promise<RegisterAreaActionResult> {
	const config = await configPromise;
	const payload = await getPayload({ config });

	const { user } = await payload.auth({ headers: await nextHeaders() });
	if (!user) {
		return { ok: false, error: "Unauthorized" };
	}
	const roles = user.roles ?? [];
	if (!roles.includes("admin") && !roles.includes("manager")) {
		return { ok: false, error: "Forbidden — requires admin or manager role" };
	}

	try {
		const job = await payload.jobs.queue({
			task: "registerArea",
			input: { areaId },
			queue: "default",
		});

		after(async () => {
			try {
				await payload.jobs.run({ queue: "default", limit: 1 });
			} catch (err) {
				payload.logger.error({
					msg: "registerAreaAction: after() run failed — relying on cron safety net",
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
