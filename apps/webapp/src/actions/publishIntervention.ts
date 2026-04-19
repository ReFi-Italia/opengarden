"use server";

import { type ActionResult, queueTaskAction } from "./actionHelpers";

type PublishInterventionActionResult = ActionResult;

export async function publishInterventionAction(
	interventionId: string,
): Promise<PublishInterventionActionResult> {
	return queueTaskAction(
		"publishIntervention",
		{ interventionId },
		["admin", "manager"],
	);
}
