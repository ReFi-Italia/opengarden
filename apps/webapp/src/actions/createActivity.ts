"use server";

import configPromise from "@payload-config";
import { headers as nextHeaders } from "next/headers";
import { getPayload } from "payload";

type CreateActivityResult =
	| { ok: true; id: string | number }
	| { ok: false; error: string };

export async function createActivityAction(
	data: Record<string, unknown>,
): Promise<CreateActivityResult> {
	const config = await configPromise;
	const payload = await getPayload({ config });

	const { user } = await payload.auth({ headers: await nextHeaders() });
	if (!user) return { ok: false, error: "Unauthorized" };

	try {
		const activity = await payload.create({
			collection: "activities",
			// biome-ignore lint/suspicious/noExplicitAny: form data shape validated server-side by collection hooks
			data: data as any,
			overrideAccess: true,
			user,
		});
		return { ok: true, id: activity.id };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
