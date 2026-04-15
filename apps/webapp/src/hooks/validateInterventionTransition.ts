import type { CollectionBeforeChangeHook } from "payload";
import { APIError } from "payload";
import {
	INTERVENTION_LIFECYCLE_STATUSES,
	type InterventionLifecycleStatus,
} from "../fields/lifecycleStatus";

/**
 * Transition table copied verbatim from the plan. Any `(from, to)` edge not
 * present here is rejected. The hook is TRANSITION-VALIDITY ONLY — it does
 * not perform snapshots, cross-collection writes, or SDK calls. All side
 * effects live in server action handlers that pass
 * `req.context.skipLifecycleHooks: true` to bypass this guard.
 *
 * The transitions from `failed` additionally require the admin role (enforced
 * below). The recovery edge guards that cross-check `revocation.failedFrom`
 * against the target state are enforced in the recovery server actions,
 * which snapshot `failedFrom` and clear it on successful recovery.
 */
const ALLOWED_TRANSITIONS: Record<
	InterventionLifecycleStatus,
	InterventionLifecycleStatus[]
> = {
	draft: ["scheduled", "failed"],
	scheduled: ["in_progress", "draft", "revoked", "failed"],
	in_progress: ["pending_validation", "failed"],
	pending_validation: ["in_progress", "validated", "failed"],
	validated: ["pending_validation", "published", "failed"],
	published: [],
	revoked: [],
	failed: [
		"draft",
		"scheduled",
		"in_progress",
		"pending_validation",
		"validated",
	],
};

export const validateInterventionTransition: CollectionBeforeChangeHook =
	async ({ data, originalDoc, operation, req, context }) => {
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

		if (from === "failed") {
			if (!req.user?.roles?.includes("admin")) {
				throw new APIError(
					'Recovery from "failed" requires the admin role.',
					403,
				);
			}
		}

		return data;
	};
