"use server";

import configPromise from "@payload-config";
import { headers as nextHeaders } from "next/headers";
import { getPayload } from "payload";

export type StartWorkActionResult = { ok: true } | { ok: false; error: string };

/**
 * Direct lifecycle transition `scheduled → in_progress`. No chain call,
 * no task queue — just a `payload.update` with the lifecycle bypass so
 * the operator can flag a scheduled intervention as actively running
 * before the validate flow.
 */
export async function startWorkAction(
	interventionId: string,
): Promise<StartWorkActionResult> {
	const config = await configPromise;
	const payload = await getPayload({ config });

	const { user } = await payload.auth({ headers: await nextHeaders() });
	if (!user) return { ok: false, error: "Unauthorized" };
	const roles = user.roles ?? [];
	if (
		!roles.includes("admin") &&
		!roles.includes("manager") &&
		!roles.includes("authoring")
	) {
		return { ok: false, error: "Forbidden" };
	}

	try {
		await payload.update({
			collection: "interventions",
			id: interventionId,
			data: { lifecycleStatus: "in_progress" },
			overrideAccess: true,
			context: { skipLifecycleHooks: true },
		});
		return { ok: true };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
