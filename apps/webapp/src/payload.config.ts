import path from "node:path";
import { fileURLToPath } from "node:url";
import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import { buildConfig } from "payload";
import sharp from "sharp";
import { Activities } from "./collections/Activities";

import { Areas } from "./collections/Areas";
import { Attestations } from "./collections/Attestations";
import { EvidenceBundles } from "./collections/EvidenceBundles";
import { Gardeners } from "./collections/Gardeners";
import { Interventions } from "./collections/Interventions";
import { Media } from "./collections/Media";
import { Sponsors } from "./collections/Sponsors";
import { Staff } from "./collections/Staff";
import { Users } from "./collections/Users";
import { OrganizationProfile } from "./globals/OrganizationProfile";
import { TaskCatalog } from "./globals/TaskCatalog";
import { tasks } from "./tasks";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export default buildConfig({
	admin: {
		user: Users.slug,
		importMap: {
			baseDir: path.resolve(dirname),
		},
		components: {
			views: {
				dashboard: {
					Component: "@/components/dashboard/DashboardHome#default",
				},
			},
		},
	},
	collections: [
		Users,
		Media,
		Sponsors,
		Staff,
		Gardeners,
		Areas,
		Interventions,
		Activities,
		EvidenceBundles,
		Attestations,
	],
	globals: [OrganizationProfile, TaskCatalog],
	editor: lexicalEditor(),
	secret: process.env.PAYLOAD_SECRET || "",
	typescript: {
		outputFile: path.resolve(dirname, "payload-types.ts"),
	},
	db: sqliteAdapter({
		client: {
			url: process.env.DATABASE_URL || "",
		},
		idType: "uuid",
	}),
	sharp,
	plugins: [],
	jobs: {
		tasks,
		/**
		 * Gate the background runner so Vercel deployments never try to spin an
		 * always-on clock inside a serverless function. On Vercel, a
		 * `vercel.json` cron hits `/api/payload-jobs/run` every 5 min as the
		 * production runner. Locally, set `ENABLE_PAYLOAD_AUTORUN=true` to
		 * exercise the same endpoint automatically during dev.
		 */
		autoRun:
			process.env.ENABLE_PAYLOAD_AUTORUN === "true"
				? [{ queue: "default", cron: "* * * * *" }]
				: undefined,
		access: {
			/**
			 * The `/api/payload-jobs/run` endpoint accepts either:
			 *   1. A Vercel Cron request with `Authorization: Bearer $CRON_SECRET`
			 *   2. A logged-in admin or manager (for manual drain from the admin UI)
			 * Any other caller is rejected so an anonymous fetch of the endpoint
			 * cannot drain the queue.
			 */
			run: ({ req }) => {
				const cronSecret = process.env.CRON_SECRET;
				if (cronSecret) {
					const auth = req.headers?.get?.("authorization");
					if (auth === `Bearer ${cronSecret}`) return true;
				}
				const roles = req.user?.roles ?? [];
				return roles.includes("admin") || roles.includes("manager");
			},
		},
	},
});
