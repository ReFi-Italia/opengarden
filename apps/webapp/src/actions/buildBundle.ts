"use server";

import configPromise from "@payload-config";
import { headers as nextHeaders } from "next/headers";
import { after } from "next/server";
import { getPayload } from "payload";

export type BuildBundleActionResult =
	| { ok: true; jobId: string }
	| { ok: false; error: string };

/**
 * Thin trigger for the `buildBundle` task. Reads the linked
 * intervention + every gardener attestation row, builds the evidence
 * bundle JSON, uploads it to the configured storage adapter, and
 * snapshots the hash + crew references onto the bundle row.
 */
export async function buildBundleAction(
	bundleId: string,
): Promise<BuildBundleActionResult> {
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
			task: "buildBundle",
			input: { bundleId },
			queue: "default",
		});

		after(async () => {
			try {
				await payload.jobs.run({ queue: "default", limit: 1 });
			} catch (err) {
				payload.logger.error({
					msg: "buildBundleAction: after() run failed — relying on cron safety net",
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
