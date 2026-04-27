"use client";

import { startWorkAction } from "@/actions/startWork";
import { TaskActionButton } from "./TaskActionButton";

export default function StartWorkButton() {
	return (
		<TaskActionButton
			label="Start work"
			action={startWorkAction}
			hint="Flips lifecycleStatus from scheduled to in_progress. No chain call."
		/>
	);
}
