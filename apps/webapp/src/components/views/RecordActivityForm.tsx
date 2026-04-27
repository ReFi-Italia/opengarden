"use client";

import { createActivityAction } from "@/actions/createActivity";
import {
	ActivityDataInput,
	type ActivityDataInputProps,
} from "@/components/fields/ActivityDataInput";
import { Form, RenderFields } from "@payloadcms/ui";
import { useRouter } from "next/navigation";
import type { ClientField, FormState } from "payload";
import { useState, useTransition } from "react";

type RecordActivityFormProps = {
	label: string;
	doneLabel: string;
	clientFields: ClientField[];
	formState: FormState;
	activityType?: ActivityDataInputProps["activityType"];
	taskCodes?: ActivityDataInputProps["taskCodes"];
};

export function RecordActivityForm({
	label,
	doneLabel,
	clientFields,
	formState,
	activityType,
	taskCodes,
}: RecordActivityFormProps) {
	const router = useRouter();
	const [saved, setSaved] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();

	const visibleFields = activityType
		? clientFields.filter(
				(f) => (f as unknown as { name?: string }).name !== "data",
			)
		: clientFields;

	const handleSubmit = (
		_fields: FormState,
		data: Record<string, unknown>,
	) => {
		setError(null);
		startTransition(async () => {
			const result = await createActivityAction(data);
			if (result.ok) {
				setSaved(true);
				setTimeout(() => router.refresh(), 1500);
			} else {
				setError(result.error);
			}
		});
	};

	return (
		<Form
			initialState={formState}
			isDocumentForm
			onSubmit={handleSubmit}
		>
			<RenderFields
				fields={visibleFields}
				parentPath=""
				parentIndexPath=""
				parentSchemaPath="activities"
				permissions={true}
				forceRender
			/>
			{activityType && (
				<ActivityDataInput activityType={activityType} taskCodes={taskCodes} />
			)}
			<div className="iw-form__actions">
				<button
					type="submit"
					className="iw-form__submit"
					disabled={saved || isPending}
				>
					{saved ? doneLabel : isPending ? `${label}…` : `${label} →`}
				</button>
				{saved && (
					<p className="iw-form__ok">Committing on-chain · refreshing…</p>
				)}
				{error && (
					<p
						style={{
							color: "var(--theme-error-500)",
							fontSize: "0.85em",
							marginTop: "0.5rem",
						}}
					>
						{error}
					</p>
				)}
			</div>
		</Form>
	);
}

