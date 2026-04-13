import type { CollectionBeforeChangeHook, Payload } from 'payload'
import { APIError } from 'payload'
import { hashPhotoBundle } from '@refi-italia/opengarden/helpers'

/**
 * Derives the `photosHash` field on a row that holds a `photos:
 * hasMany → media` relationship and a read-only `photosHash: text` slot.
 *
 * For each referenced media id we read the row's `storageHash` and feed the
 * sorted list into the SDK's canonical manifest hash. If any referenced media
 * row is missing its `storageHash`, the save is refused — the media must be
 * uploaded and its content hash persisted before it can participate in an
 * attestation bundle.
 */
export interface ComputePhotoBundleHashOptions {
  relationshipField: string
  hashField: string
}

export const computePhotoBundleHash = (
  options: ComputePhotoBundleHashOptions,
): CollectionBeforeChangeHook => {
  return async ({ data, req }) => {
    const rawIds = (data as Record<string, unknown>)[options.relationshipField]
    const mediaIds = normalizeMediaRefs(rawIds)

    if (mediaIds.length === 0) {
      return data
    }

    const storageHashes = await loadStorageHashes(req.payload, mediaIds, req)

    return {
      ...data,
      [options.hashField]: hashPhotoBundle(storageHashes),
    }
  }
}

const normalizeMediaRefs = (value: unknown): (number | string)[] => {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === 'number' || typeof item === 'string') return item
      if (item && typeof item === 'object' && 'id' in item) {
        const id = (item as { id: unknown }).id
        if (typeof id === 'number' || typeof id === 'string') return id
      }
      return null
    })
    .filter((id): id is number | string => id !== null)
}

const loadStorageHashes = async (
  payload: Payload,
  ids: (number | string)[],
  req: unknown,
): Promise<string[]> => {
  const out: string[] = []
  for (const id of ids) {
    const media = await payload.findByID({
      collection: 'media',
      id,
      depth: 0,
      req: req as never,
    })
    const storageHash = (media as { storageHash?: string | null }).storageHash
    if (!storageHash) {
      throw new APIError(
        `Media ${id} has no storageHash yet — upload and pin the file before referencing it from an attestation.`,
        400,
      )
    }
    out.push(storageHash)
  }
  return out
}
