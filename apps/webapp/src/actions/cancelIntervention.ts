"use server";

import configPromise from "@payload-config";
import { headers as nextHeaders } from "next/headers";
import { getPayload } from "payload";
import type { InterventionLifecycleStatus } from "../fields/lifecycleStatus";
import type { User } from "../payload-types";

import type { ActionResult } from "./actionHelpers";

const ALLOWED_ROLES = ["admin", "manager"] as const;

const NON_TERMINAL: InterventionLifecycleStatus[] = [
	"draft",
	"scheduled",
	"in_progress",
	"completed",
];

type CancelInput = {
	interventionId: string;
	reason: string;
	/** Optional id of a replacement intervention that supersedes this one. */
	supersededById?: string | null;
};

/**
 * Cancels an intervention from any non-terminal state and writes the
 * cancellation audit group. Per spec, off-chain Activities already
 * signed on-chain are NOT revoked — a cancelled intervention simply
 * ensures its Activities are never bundled into a published Intervention.
 * A replacement, if any, is a new intervention with its own `interventionId`
 * and a back-pointer via `supersededBy` on this row.
 */
export async function cancelInterventionAction(
	input: CancelInput,
): Promise<ActionResult> {
	const config = await configPromise;
	const payload = await getPayload({ config });

	const { user } = await payload.auth({ headers: await nextHeaders() });
	if (!user) return { ok: false, error: "Unauthorized" };
	const roles = ((user as User).roles ?? []) as string[];
	if (!ALLOWED_ROLES.some((r) => roles.includes(r))) {
		return { ok: false, error: "Forbidden" };
	}

	if (!input.reason?.trim()) {
		return { ok: false, error: "A cancellation reason is required." };
	}

	try {
		const intervention = await payload.findByID({
			collection: "interventions",
			id: input.interventionId,
			depth: 0,
			overrideAccess: true,
		});

		const currentStatus =
			intervention.lifecycleStatus as InterventionLifecycleStatus;
		if (!NON_TERMINAL.includes(currentStatus)) {
			return {
				ok: false,
				error: `Cannot cancel an intervention in state "${currentStatus}".`,
			};
		}

		await payload.update({
			collection: "interventions",
			id: input.interventionId,
			data: {
				lifecycleStatus: "cancelled",
				cancellation: {
					reason: input.reason,
					cancelledAt: new Date().toISOString(),
					cancelledFrom: currentStatus as
						| "draft"
						| "scheduled"
						| "in_progress"
						| "completed",
				},
				...(input.supersededById
					? { supersededBy: input.supersededById }
					: {}),
			},
			overrideAccess: true,
			context: { skipLifecycleHooks: true },
		});

		return { ok: true, jobId: "" };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

/**
 * Creates a fresh draft intervention with the same area / crew / task set
 * as `sourceId`, then cancels `sourceId` with `supersededBy` pointing at
 * the new row. Returns the new intervention id.
 */
export async function supersedeInterventionAction(input: {
	sourceId: string;
	newInterventionId: string;
	reason: string;
}): Promise<ActionResult & { newId?: string }> {
	const config = await configPromise;
	const payload = await getPayload({ config });

	const { user } = await payload.auth({ headers: await nextHeaders() });
	if (!user) return { ok: false, error: "Unauthorized" };
	const roles = ((user as User).roles ?? []) as string[];
	if (!ALLOWED_ROLES.some((r) => roles.includes(r))) {
		return { ok: false, error: "Forbidden" };
	}

	try {
		const source = await payload.findByID({
			collection: "interventions",
			id: input.sourceId,
			depth: 0,
			overrideAccess: true,
		});

		const newIntervention = await payload.create({
			collection: "interventions",
			data: {
				interventionId: input.newInterventionId,
				area:
					typeof source.area === "object" && source.area !== null
						? String((source.area as { id: string | number }).id)
						: String(source.area ?? ""),
				interventionType: source.interventionType,
				description: source.description,
				tasks: source.tasks,
				commissioning: source.commissioning,
				crew: source.crew,
				lifecycleStatus: "draft",
			},
			overrideAccess: true,
		});

		const cancelResult = await cancelInterventionAction({
			interventionId: input.sourceId,
			reason: input.reason,
			supersededById: String(newIntervention.id),
		});
		if (!cancelResult.ok) {
			return cancelResult;
		}

		return { ok: true, jobId: "", newId: String(newIntervention.id) };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
