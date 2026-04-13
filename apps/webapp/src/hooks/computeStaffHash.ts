import type { CollectionBeforeChangeHook } from 'payload'
import { APIError } from 'payload'
import { hashIdentifier } from '@refi-italia/opengarden/helpers'

/**
 * Derives `staffIdHash` from the staff row's `staffId` at save time. Pure
 * derivation — matches spec §9.1 (`keccak256(utf8Bytes(staffId))`) via the
 * SDK's `hashIdentifier` helper so the same hash can be reproduced from any
 * other consumer of the SDK.
 */
export const computeStaffHash: CollectionBeforeChangeHook = async ({ data }) => {
  const staffId = data.staffId as string | undefined
  if (!staffId) {
    throw new APIError('Staff row requires staffId.', 400)
  }
  return {
    ...data,
    staffIdHash: hashIdentifier(staffId),
  }
}
