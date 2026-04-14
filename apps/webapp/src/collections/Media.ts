import type { CollectionConfig } from "payload";
import { authenticated } from "../access/authenticated";
import { isAuthoringOrAbove } from "../access/isAuthoringOrAbove";

export const MEDIA_PURPOSES = [
	"area-metadata",
	"checkin",
	"report",
	"healthcheck",
	"misc",
] as const;

export const Media: CollectionConfig = {
	slug: "media",
	admin: {
		group: "System",
		hidden: true,
	},
	access: {
		read: authenticated,
		create: isAuthoringOrAbove,
		update: isAuthoringOrAbove,
		delete: isAuthoringOrAbove,
	},
	upload: true,
	fields: [
		{
			name: "alt",
			type: "text",
			required: true,
		},
		{
			name: "caption",
			type: "text",
		},
		{
			name: "purpose",
			type: "select",
			options: MEDIA_PURPOSES.map((value) => ({ label: value, value })),
		},
		{
			name: "storageHash",
			type: "text",
			index: true,
			admin: {
				readOnly: true,
				description:
					"Content-addressed hash reproducing what the SDK would hash. Set lazily when the media is first referenced from an attestation.",
			},
		},
		{
			name: "pinned",
			type: "checkbox",
			defaultValue: false,
			admin: {
				readOnly: true,
				description: "Flipped true once the file is IPFS-pinned.",
			},
		},
	],
};
