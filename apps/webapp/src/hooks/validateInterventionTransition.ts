import type { CollectionBeforeChangeHook } from "payload";
import { APIError } from "payload";
import {
	INTERVENTION_LIFECYCLE_STATUSES,
	type InterventionLifecycleStatus,
} from "../fields/lifecycleStatus";

/**
 * Transition table. Any `(from, to)` edge not present here is rejected.
 * The hook is TRANSITION-VALIDITY ONLY — it does not perform snapshots,
 * cross-collection writes, or SDK calls. All side effects live in server
 * action handlers that pass `req.context.skipLifecycleHooks: true` to
 * bypass this guard.
 *
 * Reschedule is not a transition: a cancelled intervention row is terminal,
 * and a replacement is a new intervention with `supersededBy` pointing back.
 */
const ALLOWED_TRANSITIONS: Record<
	InterventionLifecycleStatus,
	InterventionLifecycleStatus[]
> = {
	draft: ["scheduled", "cancelled"],
	scheduled: ["in_progress", "cancelled"],
	in_progress: ["completed", "cancelled"],
	completed: ["published", "cancelled"],
	published: [],
	cancelled: [],
};

export const validateInterventionTransition: CollectionBeforeChangeHook =
	async ({ data, originalDoc, operation, context }) => {
		if (context?.skipLifecycleHooks) return data;

		if (operation === "create") {
			const initial = (data.lifecycleStatus as string | undefined) ?? "draft";
			if (initial !== "draft") {
				throw new APIError(
					`New interventions must be created in the "draft" state (got "${initial}"). Transitions are performed by server actions.`,
					400,
				);
			}
			return data;
		}

		if (!originalDoc) return data;
		const from = originalDoc.lifecycleStatus as InterventionLifecycleStatus;
		const next = data.lifecycleStatus as
			| InterventionLifecycleStatus
			| undefined;
		if (next === undefined || next === from) return data;

		if (!INTERVENTION_LIFECYCLE_STATUSES.includes(next)) {
			throw new APIError(`Unknown lifecycleStatus "${next}".`, 400);
		}

		const allowed = ALLOWED_TRANSITIONS[from] ?? [];
		if (!allowed.includes(next)) {
			throw new APIError(
				`Illegal lifecycleStatus transition: "${from}" → "${next}". Allowed: [${allowed.join(", ") || "none"}].`,
				400,
			);
		}

		return data;
	};
