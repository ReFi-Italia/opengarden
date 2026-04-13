import type { CollectionBeforeChangeHook } from 'payload'
import { APIError } from 'payload'
import type { SponsorRef } from '@refi-italia/opengarden/helpers'
import { deriveSponsorHash } from '../lib/serializeSponsorRef'

type SponsorKind = 'corporate' | 'municipal' | 'grant' | 'volunteer'

interface SponsorCanonicalKey {
  sponsorId?: string | null
  contractNumber?: string | null
  grantId?: string | null
}

/**
 * Derives `canonicalJson` and `commissionRefHash` from the sponsor's current
 * field values and enforces application-level uniqueness for non-volunteer
 * rows. Pure derivation — no chain calls.
 *
 * Uniqueness is enforced here (not by a DB unique index) because the plan's
 * "unique only when kind != volunteer" constraint is a partial unique index,
 * which Payload's SQLite adapter can't express via field options. A hand-
 * edited migration could add it as defense-in-depth.
 */
export const computeSponsorHash: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  req,
}) => {
  const kind = data.kind as SponsorKind | undefined
  if (!kind) {
    throw new APIError('Sponsor kind is required.', 400)
  }

  const ref = buildSponsorRef(
    kind,
    data.canonicalKey as SponsorCanonicalKey | undefined,
  )
  const { canonicalJson, hash } = deriveSponsorHash(ref)

  if (kind !== 'volunteer') {
    const existing = await req.payload.find({
      collection: 'sponsors',
      where: {
        canonicalJson: { equals: canonicalJson },
      },
      limit: 2,
      depth: 0,
      req,
    })
    const duplicate = existing.docs.find(
      (doc) => !originalDoc || doc.id !== originalDoc.id,
    )
    if (duplicate) {
      throw new APIError(
        `Another sponsor already exists with this canonical key (kind=${kind}).`,
        409,
      )
    }
  }

  return {
    ...data,
    canonicalJson,
    commissionRefHash: hash,
  }
}

const buildSponsorRef = (
  kind: SponsorKind,
  canonicalKey: SponsorCanonicalKey | undefined,
): SponsorRef => {
  switch (kind) {
    case 'volunteer':
      return { kind: 'volunteer' }
    case 'corporate': {
      const sponsorId = canonicalKey?.sponsorId
      if (!sponsorId) {
        throw new APIError('Corporate sponsor requires canonicalKey.sponsorId.', 400)
      }
      return { kind: 'corporate', sponsorId }
    }
    case 'municipal': {
      const contractNumber = canonicalKey?.contractNumber
      if (!contractNumber) {
        throw new APIError(
          'Municipal sponsor requires canonicalKey.contractNumber.',
          400,
        )
      }
      return { kind: 'municipal', contractNumber }
    }
    case 'grant': {
      const grantId = canonicalKey?.grantId
      if (!grantId) {
        throw new APIError('Grant sponsor requires canonicalKey.grantId.', 400)
      }
      return { kind: 'grant', grantId }
    }
  }
}
