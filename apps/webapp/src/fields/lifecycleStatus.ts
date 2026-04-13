import type { Field } from 'payload'

export const INTERVENTION_LIFECYCLE_STATUSES = [
  'draft',
  'scheduled',
  'in_progress',
  'validated',
  'published',
  'revoked',
  'failed',
] as const

export type InterventionLifecycleStatus =
  (typeof INTERVENTION_LIFECYCLE_STATUSES)[number]

/**
 * Central state machine field for the interventions collection. Mutated only
 * by server actions; the `validateInterventionTransition` beforeChange hook
 * rejects any non-listed edge, and form writes cannot reach it because
 * `admin.readOnly: true` hides the field from the edit view.
 */
export const lifecycleStatusField = (): Field => ({
  name: 'lifecycleStatus',
  type: 'select',
  required: true,
  defaultValue: 'draft',
  admin: {
    readOnly: true,
    position: 'sidebar',
    description:
      'Lifecycle state — mutated only by server actions, never directly editable.',
  },
  options: INTERVENTION_LIFECYCLE_STATUSES.map((value) => ({
    label: value,
    value,
  })),
  index: true,
})
