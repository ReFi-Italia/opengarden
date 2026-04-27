import type { TaskConfig } from "payload";

import { buildBundleTask } from "./buildBundle";
import { commitActivityChainTask } from "./commitActivityChain";
import { publishInterventionTask } from "./publishIntervention";
import { registerAreaTask } from "./registerArea";
import { scheduleInterventionTask } from "./scheduleIntervention";
import { validateInterventionTask } from "./validateIntervention";
import { verifyBundleTask } from "./verifyBundle";

/**
 * All Payload job tasks registered by the webapp. Each handler is the
 * only place that calls the SDK / writes chain mirror fields —
 * collection hooks stay pure.
 */
// biome-ignore lint/suspicious/noExplicitAny: mixed input/output task types
export const tasks: TaskConfig<any>[] = [
	registerAreaTask,
	scheduleInterventionTask,
	commitActivityChainTask,
	validateInterventionTask,
	publishInterventionTask,
	buildBundleTask,
	verifyBundleTask,
];
