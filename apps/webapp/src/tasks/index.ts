import type { TaskConfig } from "payload";

import { registerAreaTask } from "./registerArea";

/**
 * All Payload job tasks registered by the webapp. Each task handler is the
 * only place that calls the SDK / writes `chain.*` mirror fields — collection
 * hooks stay pure.
 *
 * Task files are imported eagerly here, but any SDK root-entry import lives
 * inside the handler body (see `lib/openGardenClient.ts`) so loading this
 * module from the Payload CLI does not trigger the `eas-sdk` ESM crash.
 */
export const tasks: TaskConfig<any>[] = [registerAreaTask];
