"use client";

import { buildBundleAction } from "@/actions/buildBundle";
import { TaskActionButton } from "./TaskActionButton";

export default function BuildBundleButton() {
	return (
		<TaskActionButton
			label="Build bundle"
			action={buildBundleAction}
			hint="Reads every gardener attestation row for the linked intervention, builds the evidence bundle JSON, and uploads it to the configured storage adapter."
		/>
	);
}
