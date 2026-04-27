"use server";

import { type ActionResult, queueTaskAction } from "./actionHelpers";

type ScheduleInterventionActionResult = ActionResult;

export async function scheduleInterventionAction(
	interventionId: string,
): Promise<ScheduleInterventionActionResult> {
	return queueTaskAction(
		"scheduleIntervention",
		{ interventionId },
		["admin", "manager"],
	);
}
