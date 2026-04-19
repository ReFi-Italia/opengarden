"use server";

import { type ActionResult, queueTaskAction } from "./actionHelpers";

type RegisterAreaActionResult = ActionResult;

export async function registerAreaAction(
	areaId: string,
): Promise<RegisterAreaActionResult> {
	return queueTaskAction("registerArea", { areaId }, ["admin", "manager"]);
}
