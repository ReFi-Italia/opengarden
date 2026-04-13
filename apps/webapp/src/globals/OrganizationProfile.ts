import type { GlobalConfig } from "payload";
import { isAdmin } from "../access/isAdmin";

export const OrganizationProfile: GlobalConfig = {
	slug: "organizationProfile",
	admin: {
		group: "System",
	},
	access: {
		read: () => true,
		update: isAdmin,
	},
	fields: [
		{ name: "name", type: "text", required: true },
		{ name: "legalEntity", type: "text" },
		{ name: "description", type: "textarea" },
		{ name: "website", type: "text" },
		{ name: "logo", type: "upload", relationTo: "media" },
		{ name: "attesterWalletPublic", type: "text" },
	],
};
