import type { CollectionBeforeChangeHook } from "payload";
import { APIError } from "payload";

export const EVIDENCE_BUNDLE_STATES = [
	"draft",
	"built",
	"uploaded",
	"published",
	"verified",
	"failed",
] as const;

export type EvidenceBundleState = (typeof EVIDENCE_BUNDLE_STATES)[number];

/**
 * Build state machine table copied verbatim from the plan. All transitions
 * go through a server action handler — this hook only accepts/rejects the
 * edge. No side effects, no SDK calls.
 *
 * Server actions bypass via `req.context.skipLifecycleHooks: true`.
 */
const ALLOWED_TRANSITIONS: Record<EvidenceBundleState, EvidenceBundleState[]> =
	{
		draft: ["built", "failed"],
		built: ["draft", "uploaded", "failed"],
		uploaded: ["published", "failed"],
		published: ["verified"],
		verified: ["verified"],
		failed: ["draft"],
	};

export const enforceEvidenceBundleState: CollectionBeforeChangeHook = async ({
	data,
	originalDoc,
	operation,
	context,
}) => {
	if (context?.skipLifecycleHooks) return data;

	if (operation === "create") {
		const initial = (data.bundleState as string | undefined) ?? "draft";
		if (initial !== "draft") {
			throw new APIError(
				`New evidence bundles must be created in the "draft" state (got "${initial}").`,
				400,
			);
		}
		return data;
	}

	if (!originalDoc) return data;
	const from = originalDoc.bundleState as EvidenceBundleState;
	const next = data.bundleState as EvidenceBundleState | undefined;
	if (next === undefined || next === from) return data;

	if (!EVIDENCE_BUNDLE_STATES.includes(next)) {
		throw new APIError(`Unknown bundleState "${next}".`, 400);
	}

	const allowed = ALLOWED_TRANSITIONS[from] ?? [];
	if (!allowed.includes(next)) {
		throw new APIError(
			`Illegal bundleState transition: "${from}" → "${next}". Allowed: [${allowed.join(", ") || "none"}].`,
			400,
		);
	}

	return data;
};
