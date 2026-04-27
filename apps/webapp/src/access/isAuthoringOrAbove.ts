import type { Access } from "payload";

export const isAuthoringOrAbove: Access = ({ req: { user } }) => {
	const roles = user?.roles ?? [];
	return (
		roles.includes("admin") ||
		roles.includes("manager") ||
		roles.includes("authoring")
	);
};
