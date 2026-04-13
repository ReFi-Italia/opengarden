import type { Field } from 'payload'

/**
 * Field factory for the `interventions.commissioning` group. Returns the
 * relationship to the sponsor and the snapshot slot for the derived
 * `commissionRef` hash at schedule time.
 *
 * Important constraint: the snapshot + sponsor freeze are NOT performed in a
 * hook. They happen inside the `schedule-intervention` server action handler,
 * in the same Payload transaction as the SDK `client.scheduleIntervention`
 * call. Keeping side effects in handlers (not hooks) guarantees that `Save`
 * on the form can never mint attestations or cascade writes — only a
 * deliberate action-button click can.
 */
export const commissioningFields = (): Field[] => [
  {
    name: 'sponsor',
    type: 'relationship',
    relationTo: 'sponsors',
    required: true,
  },
  {
    name: 'commissionRefHashAtSchedule',
    type: 'text',
    admin: {
      readOnly: true,
      description:
        'Snapshotted from sponsor.commissionRefHash the moment the intervention is scheduled. Populated by the schedule-intervention server action.',
    },
    index: true,
  },
]
