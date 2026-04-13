import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Sponsors } from './collections/Sponsors'
import { Staff } from './collections/Staff'
import { Gardeners } from './collections/Gardeners'
import { Areas } from './collections/Areas'
import { Interventions } from './collections/Interventions'
import { GardenerCheckins } from './collections/GardenerCheckins'
import { GardenerCheckouts } from './collections/GardenerCheckouts'
import { GardenerReports } from './collections/GardenerReports'
import { AdminValidations } from './collections/AdminValidations'
import { Healthchecks } from './collections/Healthchecks'
import { EvidenceBundles } from './collections/EvidenceBundles'
import { ChainTransactions } from './collections/ChainTransactions'
import { ProtocolConfig } from './globals/ProtocolConfig'
import { OrganizationProfile } from './globals/OrganizationProfile'
import { TaskCatalog } from './globals/TaskCatalog'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
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
    GardenerCheckins,
    GardenerCheckouts,
    GardenerReports,
    AdminValidations,
    Healthchecks,
    EvidenceBundles,
    ChainTransactions,
  ],
  globals: [ProtocolConfig, OrganizationProfile, TaskCatalog],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: sqliteAdapter({
    client: {
      url: process.env.DATABASE_URL || '',
    },
  }),
  sharp,
  plugins: [],
})
