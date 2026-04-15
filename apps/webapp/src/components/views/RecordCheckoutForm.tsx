"use client";

import { Form, RenderFields } from "@payloadcms/ui";
import { useRouter } from "next/navigation";
import type { ClientField, FormState } from "payload";
import { useState } from "react";

export type RecordCheckoutFormProps = {
	clientFields: ClientField[];
	formState: FormState;
};

/**
 * Inline checkout form rendered inside the workflow view's `in_progress`
 * stage panel (below the checkin form). Uses Payload's stock `<Form>` +
 * `<RenderFields>` so the relationship picker (checkin), date picker
 * (claimedTimestamp), and number input (actualMinutes) all come from
 * Payload's stock UI — no custom widgets to maintain.
 *
 * The `checkin` relationship is pre-populated in the form's initial state
 * server-side (see `InterventionWorkflow.tsx`) to the most recent
 * un-checked-out checkin for the current intervention. The collection's
 * `afterChange` hook queues the on-chain commit task so the chain mirror
 * is populated within a beat.
 */
export function RecordCheckoutForm({
	clientFields,
	formState,
}: RecordCheckoutFormProps) {
	const router = useRouter();
	const [saved, setSaved] = useState(false);

	const onSuccess = () => {
		setSaved(true);
		setTimeout(() => router.refresh(), 1500);
	};

	return (
		<Form
			method="POST"
			action="/api/gardenerCheckouts"
			initialState={formState}
			isDocumentForm
			onSuccess={onSuccess}
		>
			<RenderFields
				fields={clientFields}
				parentPath=""
				parentIndexPath=""
				parentSchemaPath="gardenerCheckouts"
				permissions={true}
				forceRender
			/>
			<div className="iw-form__actions">
				<button
					type="submit"
					className="iw-form__submit"
					disabled={saved}
				>
					{saved ? "Recorded ✓" : "Record check-out →"}
				</button>
				{saved && (
					<p className="iw-form__ok">Committing on-chain · refreshing…</p>
				)}
			</div>
		</Form>
	);
}

export default RecordCheckoutForm;
