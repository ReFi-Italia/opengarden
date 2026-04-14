"use server";

import configPromise from "@payload-config";
import { headers as nextHeaders } from "next/headers";
import { after } from "next/server";
import { getPayload } from "payload";

export type VerifyBundleActionResult =
	| { ok: true; jobId: string }
	| { ok: false; error: string };

/**
 * Thin trigger for the `verifyBundle` task. Downloads the bundle
 * from storage and cross-checks every attestation against the chain
 * via `OpenGardenClient.verifyEvidenceBundle`.
 */
export async function verifyBundleAction(
	bundleId: string,
): Promise<VerifyBundleActionResult> {
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
			task: "verifyBundle",
			input: { bundleId },
			queue: "default",
		});

		after(async () => {
			try {
				await payload.jobs.run({ queue: "default", limit: 1 });
			} catch (err) {
				payload.logger.error({
					msg: "verifyBundleAction: after() run failed — relying on cron safety net",
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
