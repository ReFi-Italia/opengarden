import type { CollectionConfig } from 'payload'
import { authenticated } from '../access/authenticated'
import { isManagerOrAdmin } from '../access/isManagerOrAdmin'
import { computeSponsorHash } from '../hooks/computeSponsorHash'
import { freezeOnFirstUse } from '../hooks/freezeOnFirstUse'

export const SPONSOR_KINDS = [
  'corporate',
  'municipal',
  'grant',
  'volunteer',
] as const

export const Sponsors: CollectionConfig = {
  slug: 'sponsors',
  admin: {
    useAsTitle: 'displayName',
    group: 'Registry',
    defaultColumns: ['displayName', 'kind', 'frozen', 'archived'],
  },
  access: {
    read: authenticated,
    create: isManagerOrAdmin,
    update: isManagerOrAdmin,
    delete: isManagerOrAdmin,
  },
  versions: {
    drafts: false,
    maxPerDoc: 50,
  },
  hooks: {
    beforeChange: [
      computeSponsorHash,
      freezeOnFirstUse({ hashInputFields: ['canonicalJson'] }),
    ],
  },
  fields: [
    {
      name: 'displayName',
      type: 'text',
      required: true,
    },
    {
      name: 'kind',
      type: 'select',
      required: true,
      options: SPONSOR_KINDS.map((value) => ({ label: value, value })),
    },
    {
      name: 'canonicalKey',
      type: 'group',
      admin: {
        description:
          'Fields contributing to the canonical JSON hash. Exactly one sub-field is populated depending on `kind`.',
      },
      fields: [
        {
          name: 'sponsorId',
          type: 'text',
          admin: {
            condition: (data) => data?.kind === 'corporate',
            description: 'Corporate sponsor identifier.',
          },
        },
        {
          name: 'contractNumber',
          type: 'text',
          admin: {
            condition: (data) => data?.kind === 'municipal',
            description: 'Municipal contract number.',
          },
        },
        {
          name: 'grantId',
          type: 'text',
          admin: {
            condition: (data) => data?.kind === 'grant',
            description: 'Grant identifier.',
          },
        },
      ],
    },
    {
      name: 'canonicalJson',
      type: 'text',
      index: true,
      admin: {
        readOnly: true,
        description:
          'Literal JSON bytes used for hashing (spec §9.1). Derived automatically — never edit by hand.',
      },
    },
    {
      name: 'commissionRefHash',
      type: 'text',
      index: true,
      admin: {
        readOnly: true,
        description:
          'keccak256(canonicalJson) — matches the on-chain commissionRef. ZERO_BYTES32 for volunteer.',
      },
    },
    {
      name: 'frozen',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        readOnly: true,
        description:
          'Flipped true on first reference from a scheduled-or-later intervention. Once frozen, hash-affecting fields cannot change.',
      },
    },
    {
      name: 'notes',
      type: 'textarea',
    },
    {
      name: 'archived',
      type: 'checkbox',
      defaultValue: false,
    },
  ],
}
