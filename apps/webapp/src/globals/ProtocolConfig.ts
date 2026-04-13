import type { GlobalBeforeChangeHook, GlobalConfig } from 'payload'
import { APIError } from 'payload'
import {
  BASE_MAINNET,
  BASE_SEPOLIA,
  CELO_ALFAJORES,
  CELO_MAINNET,
  OPTIMISM_MAINNET,
  OPTIMISM_SEPOLIA,
  type ChainConfig,
  type SchemaName,
} from '@refi-italia/opengarden/helpers'
import { isAdmin } from '../access/isAdmin'
import { authenticated } from '../access/authenticated'

const CHAIN_KEYS = [
  'celo-mainnet',
  'celo-alfajores',
  'optimism-mainnet',
  'optimism-sepolia',
  'base-mainnet',
  'base-sepolia',
] as const

type ChainKey = (typeof CHAIN_KEYS)[number]

const CHAIN_CONFIG: Record<ChainKey, ChainConfig> = {
  'celo-mainnet': CELO_MAINNET,
  'celo-alfajores': CELO_ALFAJORES,
  'optimism-mainnet': OPTIMISM_MAINNET,
  'optimism-sepolia': OPTIMISM_SEPOLIA,
  'base-mainnet': BASE_MAINNET,
  'base-sepolia': BASE_SEPOLIA,
}

const SCHEMA_NAMES: readonly SchemaName[] = [
  'AreaRegistration',
  'PublishedIntervention',
  'GardenerMilestone',
  'ScheduledIntervention',
  'GardenerCheckin',
  'GardenerCheckout',
  'GardenerReport',
  'AdminValidation',
  'CitizenFeedback',
  'Healthcheck',
]

const STORAGE_PROVIDERS = ['inMemory', 'ipfs', 's3'] as const

/**
 * Populates the read-only derived fields (chainIdSnapshot, easAddress,
 * schemaRegistryAddress) from the chosen `chain`. Also enforces the chain-
 * switch safety gate: if any successful `chainTransactions` row exists for
 * the prior chain, the admin must explicitly set `confirmChainSwitch: true`
 * in the same update to acknowledge that historical activity won't be
 * comparable against the new chain.
 *
 * `confirmChainSwitch` is a one-shot flag — the hook resets it to false
 * before the write lands so a later unintentional chain change doesn't
 * inherit consent.
 */
const deriveChainFields: GlobalBeforeChangeHook = async ({
  data,
  originalDoc,
  req,
}) => {
  const chainKey = data.chain as ChainKey | undefined
  if (!chainKey || !(chainKey in CHAIN_CONFIG)) {
    throw new APIError(`Unknown chain "${chainKey}".`, 400)
  }
  const config = CHAIN_CONFIG[chainKey]

  const previousChain = (originalDoc?.chain as ChainKey | undefined) ?? null
  if (previousChain && previousChain !== chainKey) {
    const previousConfig = CHAIN_CONFIG[previousChain]
    const existing = await req.payload.find({
      collection: 'chainTransactions',
      where: {
        and: [
          { status: { equals: 'success' } },
          { chainId: { equals: Number(previousConfig.chainId) } },
        ],
      },
      limit: 1,
      depth: 0,
      req,
    })
    if (existing.totalDocs > 0 && !data.confirmChainSwitch) {
      throw new APIError(
        'Successful chainTransactions exist for the previous chain. Set `confirmChainSwitch: true` in the same update to acknowledge historical-data implications.',
        400,
      )
    }
  }

  return {
    ...data,
    chainIdSnapshot: Number(config.chainId),
    easAddress: config.easAddress,
    schemaRegistryAddress: config.schemaRegistryAddress,
    confirmChainSwitch: false,
  }
}

export const ProtocolConfig: GlobalConfig = {
  slug: 'protocolConfig',
  admin: {
    group: 'System',
  },
  access: {
    read: authenticated,
    update: isAdmin,
  },
  hooks: {
    beforeChange: [deriveChainFields],
  },
  fields: [
    {
      name: 'chain',
      type: 'select',
      required: true,
      defaultValue: 'celo-alfajores',
      options: CHAIN_KEYS.map((value) => ({ label: value, value })),
    },
    {
      name: 'chainIdSnapshot',
      type: 'number',
      admin: { readOnly: true },
    },
    {
      name: 'easAddress',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'schemaRegistryAddress',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'schemaUIDs',
      type: 'group',
      admin: {
        description:
          'Operator flow: run `packages/sdk/scripts/register-schemas.ts` against the chain, copy the 10 UIDs from stdout, paste them here.',
      },
      fields: SCHEMA_NAMES.map((name) => ({
        name,
        type: 'text' as const,
      })),
    },
    {
      name: 'signerWalletPublic',
      type: 'text',
      admin: {
        readOnly: true,
        description:
          'Display only — the private key lives in OPENGARDEN_SIGNER_PRIVATE_KEY.',
      },
    },
    {
      name: 'storage',
      type: 'group',
      fields: [
        {
          name: 'provider',
          type: 'select',
          required: true,
          defaultValue: 'inMemory',
          options: STORAGE_PROVIDERS.map((value) => ({ label: value, value })),
        },
        { name: 'gatewayUrl', type: 'text' },
      ],
    },
    { name: 'graphqlUrl', type: 'text' },
    { name: 'storeUrl', type: 'text' },
    {
      name: 'mvpMode',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        description:
          'When true, only ScheduledIntervention is on-chain-timestamped (matches spec §4.4).',
      },
    },
    {
      name: 'confirmChainSwitch',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description:
          'One-shot acknowledgement required when switching to a new chain after historical activity.',
      },
    },
  ],
}
