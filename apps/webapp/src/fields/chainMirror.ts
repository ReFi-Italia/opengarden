import type { Field } from 'payload'

/**
 * Returns the fixed set of plain-named subfields that mirror a single
 * on-chain/off-chain attestation onto a Payload row. The factory is meant to
 * be spread into a parent `group` (or array item) field — the parent group
 * supplies the namespace, so the same subfield names (`chainUID`, `txHash`,
 * etc.) can coexist on one row under different group names (e.g.
 * `interventions.scheduling.chainUID` vs `interventions.validation.chainUID`).
 *
 * All subfields are read-only in the admin UI — they are populated by server
 * action handlers that call the SDK, never by form writes.
 */
export const chainMirror = (): Field[] => [
  {
    name: 'chainUID',
    type: 'text',
    admin: { readOnly: true },
    index: true,
  },
  {
    name: 'txHash',
    type: 'text',
    admin: { readOnly: true },
  },
  {
    name: 'onchainTimestamp',
    type: 'number',
    admin: {
      readOnly: true,
      description: 'Unix seconds as recorded by EAS.timestamp().',
    },
  },
  {
    name: 'attesterWallet',
    type: 'text',
    admin: { readOnly: true },
  },
  {
    name: 'chainIdSnapshot',
    type: 'number',
    admin: {
      readOnly: true,
      description: 'Chain id at attestation time — snapshotted per row for migration safety.',
    },
  },
  {
    name: 'signedAttestation',
    type: 'json',
    admin: { readOnly: true },
  },
]
