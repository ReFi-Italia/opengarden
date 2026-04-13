import { getPayload } from 'payload'
import config from '../src/payload.config'

const email = process.env.ADMIN_EMAIL
const password = process.env.ADMIN_PASSWORD
const displayName = process.env.ADMIN_DISPLAY_NAME ?? 'Admin'

if (!email || !password) {
  console.error(
    'Missing required env vars. Set ADMIN_EMAIL and ADMIN_PASSWORD (and optionally ADMIN_DISPLAY_NAME) before running this script.',
  )
  process.exit(1)
}

const payload = await getPayload({ config: await config })

const existing = await payload.find({
  collection: 'users',
  where: { email: { equals: email } },
  limit: 1,
  depth: 0,
})

if (existing.totalDocs > 0) {
  const user = existing.docs[0]
  const roles = new Set<string>([...(user.roles ?? []), 'admin'])
  await payload.update({
    collection: 'users',
    id: user.id,
    data: {
      password,
      displayName,
      roles: Array.from(roles) as ('admin' | 'manager' | 'validator' | 'assessor' | 'authoring' | 'viewer')[],
    },
  })
  console.log(`Updated existing user ${email} → roles=${Array.from(roles).join(',')}`)
} else {
  await payload.create({
    collection: 'users',
    data: {
      email,
      password,
      displayName,
      roles: ['admin'],
    },
  })
  console.log(`Created admin user ${email}`)
}

console.log('Login at http://localhost:3000/admin/login')
process.exit(0)
