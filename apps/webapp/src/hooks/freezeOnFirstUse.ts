import type { CollectionBeforeChangeHook } from "payload";
import { APIError } from "payload";

/**
 * Generic beforeChange helper used by `sponsors` and `staff` to enforce the
 * freeze semantics: once the parent row has been referenced from a scheduled
 * (or later) intervention, its hash-affecting fields can no longer change.
 * Display-only fields remain editable.
 *
 * The `frozen: true` flag is flipped by the schedule-intervention server
 * action (never by this hook). This hook only reads it.
 */
export interface FreezeOnFirstUseOptions {
	/** Fields whose value contributes to the canonical hash. Edits to these are refused when `frozen === true`. */
	hashInputFields: readonly string[];
}

export const freezeOnFirstUse = (
	options: FreezeOnFirstUseOptions,
): CollectionBeforeChangeHook => {
	return async ({ data, originalDoc, operation }) => {
		if (operation !== "update" || !originalDoc) return data;
		if (!originalDoc.frozen) return data;

		for (const field of options.hashInputFields) {
			const before = (originalDoc as Record<string, unknown>)[field];
			const after = (data as Record<string, unknown>)[field];
			if (after !== undefined && !deepEqual(before, after)) {
				throw new APIError(
					`Cannot modify frozen field "${field}" — row is already referenced by an attested intervention.`,
					403,
				);
			}
		}

		return data;
	};
};

const deepEqual = (a: unknown, b: unknown): boolean => {
	if (a === b) return true;
	if (a == null || b == null) return a === b;
	if (typeof a !== "object" || typeof b !== "object") return false;
	return JSON.stringify(a) === JSON.stringify(b);
};
