import { beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'

let payload: Payload

const uniqueId = () => `acme-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

describe('Sponsor freeze semantics', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  it('refuses kind changes on a frozen sponsor while allowing displayName edits', async () => {
    const sponsorId = uniqueId()

    const created = await payload.create({
      collection: 'sponsors',
      data: {
        displayName: 'ACME Corp',
        kind: 'corporate',
        canonicalKey: { sponsorId },
      },
    })

    expect(created.canonicalJson).toBe(
      JSON.stringify({ kind: 'corporate', sponsorId }),
    )
    expect(created.commissionRefHash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(created.frozen).toBe(false)

    // Simulate first-use freeze (server actions normally do this)
    const frozen = await payload.update({
      collection: 'sponsors',
      id: created.id,
      data: { frozen: true },
    })
    expect(frozen.frozen).toBe(true)

    // displayName edit is fine — no hash impact.
    const renamed = await payload.update({
      collection: 'sponsors',
      id: created.id,
      data: { displayName: 'ACME Corporation Inc.' },
    })
    expect(renamed.displayName).toBe('ACME Corporation Inc.')

    // kind change must be refused — it would re-derive the hash.
    await expect(
      payload.update({
        collection: 'sponsors',
        id: created.id,
        data: { kind: 'volunteer', canonicalKey: {} },
      }),
    ).rejects.toThrow(/frozen/i)
  })

  it('rejects duplicate non-volunteer canonicalJson', async () => {
    const grantId = uniqueId()

    await payload.create({
      collection: 'sponsors',
      data: {
        displayName: 'EU LIFE 2024',
        kind: 'grant',
        canonicalKey: { grantId },
      },
    })

    await expect(
      payload.create({
        collection: 'sponsors',
        data: {
          displayName: 'EU LIFE Duplicate',
          kind: 'grant',
          canonicalKey: { grantId },
        },
      }),
    ).rejects.toThrow(/already exists/i)
  })

  it('allows multiple volunteer sponsors (canonicalJson collisions are intentional)', async () => {
    const a = await payload.create({
      collection: 'sponsors',
      data: { displayName: 'Volunteer A', kind: 'volunteer' },
    })
    const b = await payload.create({
      collection: 'sponsors',
      data: { displayName: 'Volunteer B', kind: 'volunteer' },
    })
    expect(a.canonicalJson).toBe('null')
    expect(b.canonicalJson).toBe('null')
    expect(a.commissionRefHash).toBe(b.commissionRefHash)
  })
})
