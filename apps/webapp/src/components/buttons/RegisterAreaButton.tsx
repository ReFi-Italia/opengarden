"use client";

import { registerAreaAction } from "@/actions/registerArea";
import { TaskActionButton } from "./TaskActionButton";

export default function RegisterAreaButton() {
	return (
		<TaskActionButton
			label="Register area"
			action={registerAreaAction}
			hint="Commits the area on-chain via OpenGardenClient.registerArea. After success the row's chain.* mirror is populated and the area becomes available for interventions."
		/>
	);
}
