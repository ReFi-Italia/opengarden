import type { CollectionConfig } from "payload";
import { authenticated } from "../access/authenticated";
import { isAdmin, isAdminField } from "../access/isAdmin";

export const USER_ROLES = [
	"admin",
	"manager",
	"validator",
	"assessor",
	"authoring",
	"viewer",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const Users: CollectionConfig = {
	slug: "users",
	admin: {
		useAsTitle: "displayName",
		group: "System",
		hidden: true,
	},
	auth: true,
	access: {
		read: authenticated,
		create: isAdmin,
		update: ({ req: { user }, id }) => {
			if (!user) return false;
			if (user.roles?.includes("admin")) return true;
			return user.id === id;
		},
		delete: isAdmin,
	},
	fields: [
		{
			name: "displayName",
			type: "text",
			required: true,
		},
		{
			name: "roles",
			type: "select",
			hasMany: true,
			required: true,
			saveToJWT: true,
			defaultValue: ["viewer"],
			options: USER_ROLES.map((value) => ({ label: value, value })),
			access: {
				update: isAdminField,
			},
		},
		{
			name: "staffRecord",
			type: "relationship",
			relationTo: "staff",
			admin: {
				description:
					"Optional link to the hashable staff identifier so users can be archived without losing staff id continuity.",
			},
		},
	],
};
