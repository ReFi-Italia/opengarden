"use client";

import { useField } from "@payloadcms/ui";
import type { ActivityType } from "@/collections/Activities";

type TaskCodeOption = { code: string; label: string };

export interface ActivityDataInputProps {
	activityType: ActivityType;
	taskCodes?: TaskCodeOption[];
}

function FieldHeader({ children }: { children: React.ReactNode }) {
	return (
		<div
			style={{
				fontSize: "0.75rem",
				fontWeight: 600,
				textTransform: "uppercase",
				letterSpacing: "0.05em",
				color: "var(--theme-elevation-500)",
				marginBottom: "0.4rem",
			}}
		>
			{children}
		</div>
	);
}

export function formatDuration(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	if (h === 0) return `${m}m`;
	if (m === 0) return `${h}h`;
	return `${h}h ${m}m`;
}

export function ActivityDataInput({
	activityType,
	taskCodes = [],
}: ActivityDataInputProps) {
	const { value, setValue } = useField<Record<string, unknown>>({
		path: "data",
	});

	const data = (value ?? {}) as Record<string, unknown>;

	if (activityType === "checkin") {
		const lat = data.latitude as number | undefined;
		const lng = data.longitude as number | undefined;
		return (
			<div style={{ marginBottom: "1rem" }}>
				<FieldHeader>Location</FieldHeader>
				<div style={{ display: "flex", gap: "2rem" }}>
					{(
						[
							["Latitude", lat],
							["Longitude", lng],
						] as [string, number | undefined][]
					).map(([label, val]) => (
						<div key={label}>
							<div
								style={{
									fontSize: "0.6875rem",
									fontWeight: 600,
									textTransform: "uppercase",
									letterSpacing: "0.06em",
									color: "var(--theme-elevation-500)",
									marginBottom: "0.2rem",
								}}
							>
								{label}
							</div>
							<div style={{ fontSize: "1.125rem", fontWeight: 700 }}>
								{val !== undefined ? val.toFixed(6) : "—"}
							</div>
						</div>
					))}
				</div>
			</div>
		);
	}

	if (activityType === "checkout") {
		const minutes = Number(data.actualMinutes ?? 0);
		return (
			<div style={{ marginBottom: "1rem" }}>
				<FieldHeader>Duration (minutes)</FieldHeader>
				<div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
					<input
						type="number"
						min={1}
						value={minutes}
						onChange={(e) =>
							setValue({ ...data, actualMinutes: Number(e.target.value) })
						}
						style={{
							width: "100px",
							padding: "0.4em 0.6em",
							fontSize: "0.9rem",
							border: "1px solid var(--theme-elevation-200)",
							borderRadius: "4px",
							background: "var(--theme-input-bg, var(--theme-elevation-50))",
							color: "var(--theme-text)",
						}}
					/>
					{minutes > 0 && (
						<span
							style={{
								color: "var(--theme-elevation-500)",
								fontSize: "0.85rem",
							}}
						>
							{formatDuration(minutes)}
						</span>
					)}
				</div>
			</div>
		);
	}

	if (activityType === "report") {
		const completedCodes: string[] = Array.isArray(data.completedTaskCodes)
			? (data.completedTaskCodes as string[])
			: [];

		const toggleCode = (code: string) => {
			const next = completedCodes.includes(code)
				? completedCodes.filter((c) => c !== code)
				: [...completedCodes, code];
			setValue({ ...data, completedTaskCodes: next });
		};

		return (
			<div
				style={{
					marginBottom: "1rem",
					display: "flex",
					flexDirection: "column",
					gap: "1rem",
				}}
			>
				{taskCodes.length > 0 && (
					<div>
						<FieldHeader>
							Completed Tasks ({completedCodes.length}/{taskCodes.length})
						</FieldHeader>
						<div
							style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}
						>
							{taskCodes.map(({ code, label }) => (
								<label
									key={code}
									style={{
										display: "flex",
										alignItems: "center",
										gap: "0.5rem",
										cursor: "pointer",
										fontSize: "0.875rem",
									}}
								>
									<input
										type="checkbox"
										checked={completedCodes.includes(code)}
										onChange={() => toggleCode(code)}
									/>
									<span>{label}</span>
									<span
										style={{
											color: "var(--theme-elevation-400)",
											fontFamily: "monospace",
											fontSize: "0.75rem",
										}}
									>
										{code}
									</span>
								</label>
							))}
						</div>
					</div>
				)}
				<div>
					<FieldHeader>Notes</FieldHeader>
					<textarea
						value={String(data.notes ?? "")}
						onChange={(e) => setValue({ ...data, notes: e.target.value })}
						rows={3}
						style={{
							width: "100%",
							padding: "0.4em 0.6em",
							fontSize: "0.875rem",
							border: "1px solid var(--theme-elevation-200)",
							borderRadius: "4px",
							background: "var(--theme-input-bg, var(--theme-elevation-50))",
							color: "var(--theme-text)",
							resize: "vertical",
						}}
					/>
				</div>
			</div>
		);
	}

	if (activityType === "healthcheck") {
		const score = Number(data.healthScore ?? 7);
		const scoreColor =
			score >= 7
				? "var(--theme-success-500)"
				: score >= 4
					? "var(--theme-warning-500)"
					: "var(--theme-error-500)";
		return (
			<div style={{ marginBottom: "1rem" }}>
				<FieldHeader>Health Score (1–10)</FieldHeader>
				<div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
					<input
						type="range"
						min={1}
						max={10}
						value={score}
						onChange={(e) =>
							setValue({ ...data, healthScore: Number(e.target.value) })
						}
						style={{ flex: 1 }}
					/>
					<span
						style={{
							fontSize: "1.5rem",
							fontWeight: 700,
							color: scoreColor,
							minWidth: "2.5rem",
							textAlign: "center",
						}}
					>
						{score}
					</span>
				</div>
			</div>
		);
	}

	return null;
}
