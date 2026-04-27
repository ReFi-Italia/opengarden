"use server";

import { type ActionResult, queueTaskAction } from "./actionHelpers";

type BuildBundleActionResult = ActionResult;

export async function buildBundleAction(
	bundleId: string,
): Promise<BuildBundleActionResult> {
	return queueTaskAction("buildBundle", { bundleId }, ["admin", "manager"]);
}
