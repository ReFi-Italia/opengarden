import type { CollectionConfig } from 'payload'
import { authenticated } from '../access/authenticated'
import { isManagerOrAdmin } from '../access/isManagerOrAdmin'
import { computeStaffHash } from '../hooks/computeStaffHash'
import { freezeOnFirstUse } from '../hooks/freezeOnFirstUse'

export const STAFF_CAPABILITIES = ['validator', 'assessor', 'crewLead'] as const

export const Staff: CollectionConfig = {
  slug: 'staff',
  admin: {
    useAsTitle: 'displayName',
    group: 'Registry',
    defaultColumns: ['displayName', 'staffId', 'capabilities', 'frozen'],
  },
  access: {
    read: authenticated,
    create: isManagerOrAdmin,
    update: isManagerOrAdmin,
    delete: isManagerOrAdmin,
  },
  hooks: {
    beforeChange: [
      computeStaffHash,
      freezeOnFirstUse({ hashInputFields: ['staffId'] }),
    ],
  },
  fields: [
    {
      name: 'displayName',
      type: 'text',
      required: true,
    },
    {
      name: 'staffId',
      type: 'text',
      required: true,
      unique: true,
      admin: {
        description:
          'Org-supplied stable string (NOT email). Hashed per spec §9.1.',
      },
    },
    {
      name: 'staffIdHash',
      type: 'text',
      index: true,
      admin: {
        readOnly: true,
        description: 'keccak256(utf8Bytes(staffId)) — derived automatically.',
      },
    },
    {
      name: 'frozen',
      type: 'checkbox',
      defaultValue: false,
      admin: { readOnly: true },
    },
    {
      name: 'linkedUser',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        description: 'Optional 1:1 link to a Payload admin user.',
      },
    },
    {
      name: 'capabilities',
      type: 'select',
      hasMany: true,
      options: STAFF_CAPABILITIES.map((value) => ({ label: value, value })),
      admin: {
        description:
          'Filters the dropdowns on validations, healthchecks, and crew lead selection.',
      },
    },
  ],
}
