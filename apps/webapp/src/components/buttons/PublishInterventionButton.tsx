"use client";

import { publishInterventionAction } from "@/actions/publishIntervention";
import { TaskActionButton } from "./TaskActionButton";

export default function PublishInterventionButton() {
	return (
		<TaskActionButton
			label="Publish"
			action={publishInterventionAction}
			hint="Set execution.executionDate, healthBefore and healthAfter above, ensure the linked evidence bundle is in `uploaded` state, then click to publish the intervention on-chain."
		/>
	);
}
