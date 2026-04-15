"use client";

import { Form, RenderFields } from "@payloadcms/ui";
import { useRouter } from "next/navigation";
import type { ClientField, FormState } from "payload";
import { useState } from "react";

export type RecordActivityFormProps = {
	label: string;
	doneLabel: string;
	clientFields: ClientField[];
	formState: FormState;
};

/**
 * Generic inline activity form. One component renders every activity
 * type (checkin / checkout / report / interventionHealthcheck /
 * areaHealthcheck) — the caller passes the right field subset, the
 * pre-populated initial state (including `type` + parent keys), and
 * the submit label.
 *
 * Submits via Payload's stock Form pipeline to `/api/activities`. The
 * collection's `afterChange` hook queues `commitActivityChain`, which
 * writes the Attestations row and links it back. `onSuccess` refreshes
 * the parent workflow view so the new activity shows up in the
 * timeline + stage rail.
 */
export function RecordActivityForm({
	label,
	doneLabel,
	clientFields,
	formState,
}: RecordActivityFormProps) {
	const router = useRouter();
	const [saved, setSaved] = useState(false);

	const onSuccess = () => {
		setSaved(true);
		setTimeout(() => router.refresh(), 1500);
	};

	return (
		<Form
			method="POST"
			action="/api/activities"
			initialState={formState}
			isDocumentForm
			onSuccess={onSuccess}
		>
			<RenderFields
				fields={clientFields}
				parentPath=""
				parentIndexPath=""
				parentSchemaPath="activities"
				permissions={true}
				forceRender
			/>
			<div className="iw-form__actions">
				<button
					type="submit"
					className="iw-form__submit"
					disabled={saved}
				>
					{saved ? doneLabel : `${label} →`}
				</button>
				{saved && (
					<p className="iw-form__ok">Committing on-chain · refreshing…</p>
				)}
			</div>
		</Form>
	);
}

export default RecordActivityForm;
