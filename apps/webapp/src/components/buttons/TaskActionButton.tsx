"use client";

import { Button, useDocumentInfo } from "@payloadcms/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

type ActionResult =
	| { ok: true; jobId?: number | string }
	| { ok: false; error: string };

type TaskAction = (id: string) => Promise<ActionResult>;

interface TaskActionButtonProps {
	label: string;
	action: TaskAction;
	/**
	 * Hint displayed under the button. Useful when an external precondition
	 * (e.g. "fill these fields first") isn't enforceable via field validation.
	 */
	hint?: string;
}

/**
 * Generic admin-form button: invokes a server action with the current
 * document id, shows transient loading / success / error state, and
 * triggers a router refresh on success so the row re-renders with the
 * task's mirror updates.
 */
export function TaskActionButton({
	label,
	action,
	hint,
}: TaskActionButtonProps) {
	const { id } = useDocumentInfo();
	const router = useRouter();
	const [state, setState] = useState<"idle" | "loading" | "success" | "error">(
		"idle",
	);
	const [error, setError] = useState<string | null>(null);

	if (id === undefined || id === null) return null;

	const onClick = async () => {
		setState("loading");
		setError(null);
		try {
			const result = await action(String(id));
			if (result.ok) {
				setState("success");
				// Give Next.js `after()` a moment to drain the queued task,
				// then refresh the form to pick up the chain mirror writes.
				setTimeout(() => router.refresh(), 1500);
			} else {
				setState("error");
				setError(result.error);
			}
		} catch (err) {
			setState("error");
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	return (
		<div style={{ marginBlock: "0.5rem" }}>
			<Button
				buttonStyle="primary"
				onClick={onClick}
				disabled={state === "loading"}
			>
				{state === "loading" ? `${label}…` : label}
			</Button>
			{hint && (
				<p style={{ color: "var(--theme-elevation-500)", fontSize: "0.85em" }}>
					{hint}
				</p>
			)}
			{state === "success" && (
				<p style={{ color: "var(--theme-success-500)", fontSize: "0.85em" }}>
					Queued. Refreshing…
				</p>
			)}
			{state === "error" && error && (
				<p style={{ color: "var(--theme-error-500)", fontSize: "0.85em" }}>
					{error}
				</p>
			)}
		</div>
	);
}
