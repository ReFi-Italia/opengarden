"use client";

import { verifyBundleAction } from "@/actions/verifyBundle";
import { TaskActionButton } from "./TaskActionButton";

export default function VerifyBundleButton() {
	return (
		<TaskActionButton
			label="Verify bundle"
			action={verifyBundleAction}
			hint="Re-downloads the bundle from storage and cross-checks every attestation against the chain. Populates verification.* with the structured results."
		/>
	);
}
