import type { TaskConfig } from "payload";

/**
 * Deprecated — replaced by `publishIntervention` which calls
 * `client.finalizeIntervention`. The SDK orchestrates preflight + build +
 * serialize + index + publish in one call, so the separate buildBundle
 * stage no longer exists (see spec §5, SDK README "Full lifecycle").
 *
 * Kept as a deprecation shim so any queued-but-not-yet-drained job from
 * the old flow surfaces a clear error instead of silently failing.
 */
export const buildBundleTask: TaskConfig<{
	input: { bundleId: string };
	output: { deprecated: true };
}> = {
	slug: "buildBundle",
	label: "Build Evidence Bundle (deprecated)",
	retries: { attempts: 0 },
	inputSchema: [{ name: "bundleId", type: "text", required: true }],
	outputSchema: [{ name: "deprecated", type: "checkbox", required: true }],
	handler: async () => {
		throw new Error(
			"buildBundle task is deprecated. Evidence bundles are now built as part of `publishIntervention` via the SDK's finalizeIntervention flow. Remove this queue call.",
		);
	},
};
