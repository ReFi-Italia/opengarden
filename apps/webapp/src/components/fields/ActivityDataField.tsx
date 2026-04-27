"use client";

import { useField, useFormFields } from "@payloadcms/ui";
import type { ActivityType } from "@/collections/Activities";
import { formatDuration } from "./ActivityDataInput";

type CheckinData = { latitude: number; longitude: number };
type CheckoutData = { actualMinutes: number };
type ReportData = { completedTaskCodes: string[]; taskCount?: number; notes?: string };
type HealthcheckData = {
	healthScore: number;
	metadata?: Record<string, unknown>;
	metadataHash?: string;
};

function Stat({
	label,
	value,
	color,
}: {
	label: string;
	value: string;
	color?: string;
}) {
	return (
		<div>
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
			<div
				style={{
					fontSize: "1.125rem",
					fontWeight: 700,
					color: color ?? "var(--theme-text)",
				}}
			>
				{value}
			</div>
		</div>
	);
}

function CheckinDisplay({ data }: { data: CheckinData }) {
	const mapsUrl = `https://www.google.com/maps?q=${data.latitude},${data.longitude}`;
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
			<div style={{ display: "flex", gap: "2rem" }}>
				<Stat label="Latitude" value={data.latitude.toFixed(6)} />
				<Stat label="Longitude" value={data.longitude.toFixed(6)} />
			</div>
			<a
				href={mapsUrl}
				target="_blank"
				rel="noopener noreferrer"
				style={{
					fontSize: "0.8125rem",
					color: "var(--theme-elevation-500)",
					textDecoration: "none",
				}}
			>
				Open in Maps ↗
			</a>
		</div>
	);
}

function CheckoutDisplay({ data }: { data: CheckoutData }) {
	return (
		<div style={{ display: "flex", gap: "2rem" }}>
			<Stat label="Duration" value={formatDuration(data.actualMinutes)} />
			<Stat label="Minutes" value={String(data.actualMinutes)} />
		</div>
	);
}

function ReportDisplay({ data }: { data: ReportData }) {
	const shown = data.taskCount ?? data.completedTaskCodes.length;
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
			<div>
				<div
					style={{
						fontSize: "0.6875rem",
						fontWeight: 600,
						textTransform: "uppercase",
						letterSpacing: "0.06em",
						color: "var(--theme-elevation-500)",
						marginBottom: "0.375rem",
					}}
				>
					Completed Tasks ({data.completedTaskCodes.length}
					{data.taskCount ? `/${shown}` : ""})
				</div>
				<div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
					{data.completedTaskCodes.length > 0 ? (
						data.completedTaskCodes.map((code) => (
							<span
								key={code}
								style={{
									padding: "0.2em 0.55em",
									borderRadius: "3px",
									fontSize: "0.75rem",
									fontFamily: "var(--font-mono, monospace)",
									background: "var(--theme-elevation-100)",
									border: "1px solid var(--theme-elevation-200)",
									color: "var(--theme-text)",
								}}
							>
								{code}
							</span>
						))
					) : (
						<span
							style={{
								color: "var(--theme-elevation-400)",
								fontSize: "0.875rem",
							}}
						>
							None
						</span>
					)}
				</div>
			</div>
			{data.notes && (
				<div>
					<div
						style={{
							fontSize: "0.6875rem",
							fontWeight: 600,
							textTransform: "uppercase",
							letterSpacing: "0.06em",
							color: "var(--theme-elevation-500)",
							marginBottom: "0.25rem",
						}}
					>
						Notes
					</div>
					<p
						style={{
							margin: 0,
							fontSize: "0.875rem",
							lineHeight: 1.55,
							color: "var(--theme-text)",
						}}
					>
						{data.notes}
					</p>
				</div>
			)}
		</div>
	);
}

function HealthcheckDisplay({ data }: { data: HealthcheckData }) {
	const score = data.healthScore;
	const scoreColor =
		score >= 7
			? "var(--theme-success-500)"
			: score >= 4
				? "var(--theme-warning-500)"
				: "var(--theme-error-500)";
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
			<div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
				<Stat label="Health Score" value={`${score}/10`} color={scoreColor} />
				<div
					style={{
						flex: 1,
						height: "6px",
						borderRadius: "3px",
						background: "var(--theme-elevation-100)",
						overflow: "hidden",
					}}
				>
					<div
						style={{
							width: `${(score / 10) * 100}%`,
							height: "100%",
							background: scoreColor,
							borderRadius: "3px",
						}}
					/>
				</div>
			</div>
			{data.metadata && (
				<details>
					<summary
						style={{
							cursor: "pointer",
							fontSize: "0.8125rem",
							color: "var(--theme-elevation-500)",
							userSelect: "none",
						}}
					>
						Metadata
					</summary>
					<pre
						style={{
							marginTop: "0.5rem",
							padding: "0.625rem",
							background: "var(--theme-elevation-50)",
							borderRadius: "3px",
							fontSize: "0.75rem",
							overflow: "auto",
							maxHeight: "180px",
							color: "var(--theme-text)",
						}}
					>
						{JSON.stringify(data.metadata, null, 2)}
					</pre>
				</details>
			)}
		</div>
	);
}

export default function ActivityDataField() {
	const { value } = useField<Record<string, unknown> | null | undefined>({
		path: "data",
	});
	const type = useFormFields(
		([fields]) => fields["type"]?.value as ActivityType | undefined,
	);

	return (
		<div style={{ marginBottom: "1rem" }}>
			<div
				style={{
					fontSize: "0.6875rem",
					fontWeight: 600,
					textTransform: "uppercase",
					letterSpacing: "0.06em",
					color: "var(--theme-elevation-500)",
					marginBottom: "0.5rem",
				}}
			>
				Data
			</div>
			{!value || !type ? (
				<span
					style={{ color: "var(--theme-elevation-400)", fontSize: "0.875rem" }}
				>
					—
				</span>
			) : (
				<>
					{type === "checkin" && (
						<CheckinDisplay data={value as unknown as CheckinData} />
					)}
					{type === "checkout" && (
						<CheckoutDisplay data={value as unknown as CheckoutData} />
					)}
					{type === "report" && (
						<ReportDisplay data={value as unknown as ReportData} />
					)}
					{type === "healthcheck" && (
						<HealthcheckDisplay data={value as unknown as HealthcheckData} />
					)}
				</>
			)}
		</div>
	);
}
