import type {
  CollectionAfterReadHook,
  CollectionBeforeValidateHook,
  CollectionConfig,
  Field,
} from 'payload'
import { APIError } from 'payload'
import { InterventionType } from '@refi-italia/opengarden/helpers'
import { authenticated } from '../access/authenticated'
import { isAuthoringOrAbove } from '../access/isAuthoringOrAbove'
import { chainMirror } from '../fields/chainMirror'
import {
  INTERVENTION_LIFECYCLE_STATUSES,
  lifecycleStatusField,
} from '../fields/lifecycleStatus'
import { commissioningFields } from '../fields/sponsorRef'
import { validateInterventionTransition } from '../hooks/validateInterventionTransition'

/**
 * InterventionType enum values are stored as string-encoded integers
 * ("0".."5") to round-trip through Payload's string-based select. Server
 * actions parse them back to the numeric enum before calling the SDK.
 */
const INTERVENTION_TYPE_OPTIONS = [
  { label: 'Unspecified', value: String(InterventionType.Unspecified) },
  { label: 'Routine maintenance', value: String(InterventionType.RoutineMaintenance) },
  { label: 'Restoration', value: String(InterventionType.Restoration) },
  { label: 'Emergency', value: String(InterventionType.Emergency) },
  { label: 'Seasonal', value: String(InterventionType.Seasonal) },
  { label: 'New planting', value: String(InterventionType.NewPlanting) },
]

/**
 * Stage groups (scheduling / validation / execution / revocation) are
 * populated only by server actions that pass
 * `req.context.skipLifecycleHooks: true`. Form-based updates have their
 * changes to these groups silently reset to the original value — the admin
 * UI hides them via `admin.readOnly: true`, this hook is defense-in-depth
 * against direct REST writes.
 */
const STAGE_GROUPS = ['scheduling', 'validation', 'execution', 'revocation'] as const

const guardInterventionInvariants: CollectionBeforeValidateHook = async ({
  data,
  originalDoc,
  operation,
  context,
}) => {
  if (!data) return data

  if (Array.isArray(data.crew)) {
    const leadCount = data.crew.filter(
      (row: { isCrewLead?: boolean }) => row?.isCrewLead === true,
    ).length
    if (leadCount > 1) {
      throw new APIError(
        'At most one crew member can be marked as crew lead.',
        400,
      )
    }
  }

  if (context?.skipLifecycleHooks) return data
  if (operation !== 'update' || !originalDoc) return data

  const guarded: Record<string, unknown> = { ...data }
  for (const group of STAGE_GROUPS) {
    guarded[group] = (originalDoc as Record<string, unknown>)[group]
  }
  return guarded
}

const deriveCrewSize: CollectionAfterReadHook = async ({ doc }) => {
  const crew = (doc as { crew?: unknown[] }).crew
  ;(doc as Record<string, unknown>).crewSize = Array.isArray(crew) ? crew.length : 0
  return doc
}

const schedulingGroup: Field = {
  name: 'scheduling',
  type: 'group',
  admin: {
    readOnly: true,
    description:
      'Populated by the schedule-intervention server action. Frozen once populated.',
  },
  fields: [
    { name: 'scheduledDate', type: 'date' },
    { name: 'estimatedMinutes', type: 'number' },
    ...chainMirror(),
  ],
}

const validationGroup: Field = {
  name: 'validation',
  type: 'group',
  admin: {
    readOnly: true,
    description:
      'Populated by the validate-intervention server action. Wiped by revoke-validation before re-validation.',
  },
  fields: [
    {
      name: 'validator',
      type: 'relationship',
      relationTo: 'staff',
      filterOptions: {
        capabilities: { contains: 'validator' },
      },
    },
    { name: 'approved', type: 'checkbox' },
    { name: 'qualityScore', type: 'number', min: 0, max: 10 },
    { name: 'feedback', type: 'textarea' },
    {
      name: 'validatorIdHashAtValidation',
      type: 'text',
      admin: {
        description:
          'Snapshotted from staff.staffIdHash at validate time; ZERO_BYTES32 for null validators.',
      },
    },
    {
      name: 'currentAttestation',
      type: 'relationship',
      relationTo: 'adminValidations',
      admin: {
        description: 'Points at the current non-revoked adminValidations row.',
      },
    },
    ...chainMirror(),
  ],
}

const executionGroup: Field = {
  name: 'execution',
  type: 'group',
  admin: {
    readOnly: true,
    description:
      'Populated by the publish-intervention server action. Immutable once published.',
  },
  fields: [
    { name: 'executionDate', type: 'date' },
    { name: 'healthBefore', type: 'number', min: 0, max: 10 },
    { name: 'healthAfter', type: 'number', min: 0, max: 10 },
    {
      name: 'evidenceBundle',
      type: 'relationship',
      relationTo: 'evidenceBundles',
      admin: {
        description:
          'Denormalized back-reference — maintained by publish-intervention, not by hooks. Source of truth is evidenceBundles.intervention.',
      },
    },
    {
      name: 'offchainCount',
      type: 'number',
      admin: { readOnly: true },
    },
    ...chainMirror(),
  ],
}

const revocationGroup: Field = {
  name: 'revocation',
  type: 'group',
  admin: {
    readOnly: true,
    description:
      'Holds revocation details (when lifecycleStatus === "revoked") and transient failure details (when lifecycleStatus === "failed").',
  },
  fields: [
    { name: 'reason', type: 'textarea' },
    { name: 'revokedAt', type: 'date' },
    { name: 'revokedScheduleUID', type: 'text' },
    {
      name: 'failedFrom',
      type: 'select',
      options: INTERVENTION_LIFECYCLE_STATUSES.filter(
        (s) => s === 'draft' || s === 'scheduled' || s === 'in_progress' || s === 'validated',
      ).map((value) => ({ label: value, value })),
      admin: {
        description:
          'Snapshot of the prior state when an SDK error flipped the row to "failed". Cleared on successful admin-recover.',
      },
    },
  ],
}

export const Interventions: CollectionConfig = {
  slug: 'interventions',
  admin: {
    useAsTitle: 'interventionId',
    group: 'Lifecycle',
    defaultColumns: [
      'interventionId',
      'area',
      'lifecycleStatus',
      'scheduling.scheduledDate',
    ],
  },
  access: {
    read: authenticated,
    create: isAuthoringOrAbove,
    update: isAuthoringOrAbove,
    delete: isAuthoringOrAbove,
  },
  versions: {
    drafts: true,
    maxPerDoc: 200,
  },
  hooks: {
    beforeValidate: [guardInterventionInvariants],
    beforeChange: [validateInterventionTransition],
    afterRead: [deriveCrewSize],
  },
  fields: [
    {
      name: 'interventionId',
      type: 'text',
      required: true,
      unique: true,
      index: true,
    },
    {
      name: 'area',
      type: 'relationship',
      relationTo: 'areas',
      required: true,
      filterOptions: {
        lifecycleStatus: { equals: 'registered' },
      },
    },
    {
      name: 'interventionType',
      type: 'select',
      required: true,
      options: INTERVENTION_TYPE_OPTIONS,
    },
    {
      name: 'description',
      type: 'textarea',
      required: true,
    },
    {
      name: 'commissioning',
      type: 'group',
      fields: commissioningFields(),
    },
    {
      name: 'crew',
      type: 'array',
      required: true,
      minRows: 0,
      fields: [
        {
          name: 'gardener',
          type: 'relationship',
          relationTo: 'gardeners',
          required: true,
          filterOptions: {
            status: { equals: 'active' },
          },
        },
        {
          name: 'isCrewLead',
          type: 'checkbox',
          defaultValue: false,
        },
      ],
    },
    {
      name: 'crewSize',
      type: 'number',
      virtual: true,
      admin: {
        readOnly: true,
        description: 'Derived from crew.length at read time.',
      },
    },
    schedulingGroup,
    validationGroup,
    executionGroup,
    revocationGroup,
    lifecycleStatusField(),
  ],
}
