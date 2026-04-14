"use client";

import { validateInterventionAction } from "@/actions/validateIntervention";
import { TaskActionButton } from "./TaskActionButton";

export default function ValidateButton() {
	return (
		<TaskActionButton
			label="Validate"
			action={validateInterventionAction}
			hint="Set validation.validator, approved, qualityScore and feedback above, then click to commit the off-chain attestation."
		/>
	);
}
