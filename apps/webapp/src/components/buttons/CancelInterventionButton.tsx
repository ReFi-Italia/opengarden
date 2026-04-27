"use client";

import { Button, useDocumentInfo } from "@payloadcms/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { cancelInterventionAction } from "@/actions/cancelIntervention";

export default function CancelInterventionButton() {
	const { id } = useDocumentInfo();
	const router = useRouter();
	const [state, setState] = useState<"idle" | "confirming" | "loading" | "error">(
		"idle",
	);
	const [reason, setReason] = useState("");
	const [error, setError] = useState<string | null>(null);

	if (id === undefined || id === null) return null;

	const onSubmit = async () => {
		if (!reason.trim()) {
			setError("A reason is required.");
			return;
		}
		setState("loading");
		setError(null);
		try {
			const result = await cancelInterventionAction({
				interventionId: String(id),
				reason,
			});
			if (result.ok) {
				setTimeout(() => router.refresh(), 500);
			} else {
				setState("error");
				setError(result.error);
			}
		} catch (err) {
			setState("error");
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	if (state === "confirming" || state === "loading" || state === "error") {
		return (
			<div style={{ marginBlock: "0.5rem" }}>
				<textarea
					value={reason}
					onChange={(e) => setReason(e.target.value)}
					placeholder="Cancellation reason (required)"
					rows={3}
					style={{ width: "100%", marginBottom: "0.5rem" }}
					disabled={state === "loading"}
				/>
				<div style={{ display: "flex", gap: "0.5rem" }}>
					<Button
						buttonStyle="error"
						onClick={onSubmit}
						disabled={state === "loading"}
					>
						{state === "loading" ? "Cancelling…" : "Confirm cancel"}
					</Button>
					<Button
						buttonStyle="secondary"
						onClick={() => {
							setState("idle");
							setReason("");
							setError(null);
						}}
						disabled={state === "loading"}
					>
						Back
					</Button>
				</div>
				{error && (
					<p style={{ color: "var(--theme-error-500)", fontSize: "0.85em" }}>
						{error}
					</p>
				)}
			</div>
		);
	}

	return (
		<div style={{ marginBlock: "0.5rem" }}>
			<Button buttonStyle="secondary" onClick={() => setState("confirming")}>
				Cancel intervention
			</Button>
			<p style={{ color: "var(--theme-elevation-500)", fontSize: "0.85em" }}>
				Marks this intervention as cancelled (terminal). A replacement must be
				a new intervention row with `supersededBy` pointing back to this one.
			</p>
		</div>
	);
}
