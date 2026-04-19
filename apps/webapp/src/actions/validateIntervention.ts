"use server";

import { type ActionResult, queueTaskAction } from "./actionHelpers";

type ValidateInterventionActionResult = ActionResult;

export async function validateInterventionAction(
	interventionId: string,
): Promise<ValidateInterventionActionResult> {
	return queueTaskAction(
		"validateIntervention",
		{ interventionId },
		["admin", "manager", "validator"],
	);
}
