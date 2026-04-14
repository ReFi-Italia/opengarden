"use client";

import { scheduleInterventionAction } from "@/actions/scheduleIntervention";
import { TaskActionButton } from "./TaskActionButton";

export default function ScheduleButton() {
	return (
		<TaskActionButton
			label="Schedule"
			action={scheduleInterventionAction}
			hint="Set scheduling.scheduledDate and estimatedMinutes above, then click to commit the off-chain attestation."
		/>
	);
}
