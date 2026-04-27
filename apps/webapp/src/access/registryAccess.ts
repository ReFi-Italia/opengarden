import type { CollectionConfig } from "payload";
import { authenticated } from "./authenticated";
import { isManagerOrAdmin } from "./isManagerOrAdmin";

export const registryAccess: CollectionConfig["access"] = {
	read: authenticated,
	create: isManagerOrAdmin,
	update: isManagerOrAdmin,
	delete: isManagerOrAdmin,
};
