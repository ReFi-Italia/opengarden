import type { Access, FieldAccess } from "payload";

export const isAdmin: Access = ({ req: { user } }) =>
	Boolean(user?.roles?.includes("admin"));

export const isAdminField: FieldAccess = ({ req: { user } }) =>
	Boolean(user?.roles?.includes("admin"));
