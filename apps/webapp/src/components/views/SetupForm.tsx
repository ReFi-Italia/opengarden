"use client";

import { DefaultEditView } from "@payloadcms/ui";
import type { DocumentSubViewTypes, FormState, ViewTypes } from "payload";

type SetupFormProps = {
	documentSubViewType: DocumentSubViewTypes;
	formState: FormState;
	viewType: ViewTypes;
};

/**
 * Create-mode wrapper for new interventions. Defers the actual form
 * rendering to Payload's stock `DefaultEditView` so we get the fully
 * wired collection form — relationship pickers, the crew array with
 * its server-function-driven add-row, validation, the Save button,
 * and the post-create redirect to the new doc URL — without having
 * to re-implement the form runtime ourselves.
 *
 * The custom workflow view kicks in once the doc exists (edit mode),
 * via the `if (id === undefined)` branch in `InterventionWorkflow`.
 */
export function SetupForm({
	documentSubViewType,
	formState,
	viewType,
}: SetupFormProps) {
	return (
		<DefaultEditView
			documentSubViewType={documentSubViewType}
			formState={formState}
			viewType={viewType}
		/>
	);
}

