"use server";

import configPromise from "@payload-config";
import { headers as nextHeaders } from "next/headers";
import { after } from "next/server";
import { getPayload } from "payload";
import type { TaskType } from "payload";
import type { User } from "../payload-types";

export type ActionResult =
	| { ok: true; jobId: string }
	| { ok: false; error: string };

type UserRole = User["roles"][number];

export async function queueTaskAction(
	task: TaskType,
	input: Record<string, string>,
	allowedRoles: UserRole[],
): Promise<ActionResult> {
	const config = await configPromise;
	const payload = await getPayload({ config });

	const { user } = await payload.auth({ headers: await nextHeaders() });
	if (!user) return { ok: false, error: "Unauthorized" };
	const roles = (user.roles ?? []) as UserRole[];
	if (!allowedRoles.some((r) => roles.includes(r))) {
		return { ok: false, error: "Forbidden" };
	}

	try {
		const job = await payload.jobs.queue({
			task,
			input,
			queue: "default",
		});

		after(async () => {
			try {
				await payload.jobs.run({ queue: "default", limit: 1 });
			} catch (err) {
				payload.logger.error({
					msg: `${task}Action: after() run failed — relying on cron safety net`,
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
