import { describe, it, expect } from 'vitest';
import { OpenGardenClient } from '../src/client';
import { OPTIMISM_MAINNET } from '../src/constants';
import { OpenGardenError, OpenGardenErrorCode } from '../src/errors';
import type { ChainConfig } from '../src/types/config';

const TEST_CHAIN: ChainConfig = OPTIMISM_MAINNET;

function createMockSigner() {
  const provider = {
    resolveName: async () => null,
    getNetwork: async () => ({ chainId: 10n, name: 'optimism' }),
  };
  return {
    getAddress: async () => '0x0000000000000000000000000000000000000001',
    signTransaction: async () => '0x',
    signMessage: async () => '0x',
    provider,
    estimateGas: async () => 0n,
    call: async () => '0x',
    resolveName: async () => null,
    sendTransaction: async () => ({}),
  } as any;
}

describe('OpenGardenClient construction', () => {
  it('throws SIGNER_ERROR when signer is missing', () => {
    expect(
      () =>
        new OpenGardenClient({
          signer: undefined as any,
          chain: TEST_CHAIN,
        }),
    ).toThrow(OpenGardenError);

    try {
      new OpenGardenClient({ signer: undefined as any, chain: TEST_CHAIN });
    } catch (e) {
      expect(e).toBeInstanceOf(OpenGardenError);
      expect((e as OpenGardenError).code).toBe(OpenGardenErrorCode.SIGNER_ERROR);
    }
  });

  it('constructs with valid config', () => {
    const client = new OpenGardenClient({
      signer: createMockSigner(),
      chain: TEST_CHAIN,
    });

    expect(client).toBeInstanceOf(OpenGardenClient);
  });

  it('accepts pre-registered schema UIDs', () => {
    const client = new OpenGardenClient({
      signer: createMockSigner(),
      chain: TEST_CHAIN,
      schemaUIDs: {
        AreaRegistration: '0xschema123',
      },
    });

    const uids = client.getSchemaUIDs();
    expect(uids.AreaRegistration).toBe('0xschema123');
  });
});

describe('OpenGardenClient schema validation', () => {
  it('throws SCHEMA_NOT_REGISTERED when calling write without registration', async () => {
    const client = new OpenGardenClient({
      signer: createMockSigner(),
      chain: TEST_CHAIN,
    });

    await expect(
      client.registerArea({
        areaId: 'RM-PIGN-042',
        latitude: 41.89,
        longitude: 12.4964,
        areaType: 0,
        name: 'Test',
        municipality: 'RM',
        metadataHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      }),
    ).rejects.toThrow(OpenGardenError);

    try {
      await client.registerArea({
        areaId: 'RM-PIGN-042',
        latitude: 41.89,
        longitude: 12.4964,
        areaType: 0,
        name: 'Test',
        municipality: 'RM',
        metadataHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      });
    } catch (e) {
      expect((e as OpenGardenError).code).toBe(OpenGardenErrorCode.SCHEMA_NOT_REGISTERED);
    }
  });
});

describe('OpenGardenClient storage validation', () => {
  it('throws STORAGE_NOT_CONFIGURED when uploading without adapter', async () => {
    const client = new OpenGardenClient({
      signer: createMockSigner(),
      chain: TEST_CHAIN,
    });

    await expect(client.uploadEvidenceBundle({} as any)).rejects.toThrow(OpenGardenError);

    try {
      await client.uploadEvidenceBundle({} as any);
    } catch (e) {
      expect((e as OpenGardenError).code).toBe(OpenGardenErrorCode.STORAGE_NOT_CONFIGURED);
    }
  });
});
