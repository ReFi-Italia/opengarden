"use client";

import { Form, RenderFields } from "@payloadcms/ui";
import { useRouter } from "next/navigation";
import type { ClientField, FormState } from "payload";
import { useState } from "react";

export type RecordCheckinFormProps = {
	clientFields: ClientField[];
	formState: FormState;
};

/**
 * Inline checkin form rendered inside the workflow view's `in_progress`
 * stage panel. Uses Payload's stock `<Form>` + `<RenderFields>` so the
 * relationship picker (gardener), date picker (claimedTimestamp), upload
 * widget (photo), and number inputs (latitude/longitude) all come from
 * Payload's stock UI — no custom widgets to maintain.
 *
 * The `intervention` relationship is pre-populated in the form's initial
 * state server-side (see `InterventionWorkflow.tsx`) so Payload's Form
 * includes it in the POST body natively — no custom function action
 * needed. The collection's `afterChange` hook queues the on-chain commit
 * task, so when the row lands the chain mirror is populated within a
 * beat.
 */
export function RecordCheckinForm({
	clientFields,
	formState,
}: RecordCheckinFormProps) {
	const router = useRouter();
	const [saved, setSaved] = useState(false);

	const onSuccess = () => {
		setSaved(true);
		// Give the queued chain task a beat to drain, then refresh so the
		// parent workflow view picks up the new checkin (with chain mirror).
		setTimeout(() => router.refresh(), 1500);
	};

	return (
		<Form
			method="POST"
			action="/api/gardenerCheckins"
			initialState={formState}
			isDocumentForm
			onSuccess={onSuccess}
		>
			<RenderFields
				fields={clientFields}
				parentPath=""
				parentIndexPath=""
				parentSchemaPath="gardenerCheckins"
				permissions={true}
				forceRender
			/>
			<div className="iw-form__actions">
				<button
					type="submit"
					className="iw-form__submit"
					disabled={saved}
				>
					{saved ? "Recorded ✓" : "Record check-in →"}
				</button>
				{saved && (
					<p className="iw-form__ok">Committing on-chain · refreshing…</p>
				)}
			</div>
		</Form>
	);
}

export default RecordCheckinForm;
