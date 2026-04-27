"use server";

import { type ActionResult, queueTaskAction } from "./actionHelpers";

type VerifyBundleActionResult = ActionResult;

export async function verifyBundleAction(
	bundleId: string,
): Promise<VerifyBundleActionResult> {
	return queueTaskAction("verifyBundle", { bundleId }, ["admin", "manager"]);
}
