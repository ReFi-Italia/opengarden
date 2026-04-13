import type { GlobalBeforeValidateHook, GlobalConfig } from 'payload'
import { APIError } from 'payload'
import { isAdmin } from '../access/isAdmin'
import { authenticated } from '../access/authenticated'

/**
 * Rejects duplicate `code` values within the `tasks` array. Task codes are
 * the unique keys referenced by `gardenerReports.tasksCompleted` — duplicate
 * codes would silently collide and make the validation hook in that
 * collection non-deterministic about which task a code refers to.
 */
const enforceUniqueTaskCodes: GlobalBeforeValidateHook = async ({ data }) => {
  const tasks = (data?.tasks ?? []) as { code?: string }[]
  const seen = new Set<string>()
  for (const t of tasks) {
    const code = t?.code
    if (!code) continue
    if (seen.has(code)) {
      throw new APIError(`Duplicate task code "${code}" in catalog.`, 400)
    }
    seen.add(code)
  }
  return data
}

export const TaskCatalog: GlobalConfig = {
  slug: 'taskCatalog',
  admin: {
    group: 'System',
  },
  access: {
    read: authenticated,
    update: isAdmin,
  },
  hooks: {
    beforeValidate: [enforceUniqueTaskCodes],
  },
  fields: [
    {
      name: 'tasks',
      type: 'array',
      fields: [
        { name: 'code', type: 'text', required: true },
        { name: 'label', type: 'text', required: true },
        { name: 'description', type: 'textarea' },
      ],
    },
  ],
}
