import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenGardenClient } from '../src/client';
import { OPTIMISM_MAINNET, SCHEMA_NAME_UID } from '../src/constants';
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

describe('OpenGardenClient schema naming', () => {
  const FAKE_SCHEMA_UID = '0x0000000000000000000000000000000000000000000000000000000000000abc';
  const FAKE_TX_RECEIPT = { hash: '0xtxhash' };

  function createSchemaClient() {
    const attestCalls: any[] = [];
    const client = new OpenGardenClient({
      signer: createMockSigner(),
      chain: TEST_CHAIN,
    });

    (client as any).registry = {
      register: async () => ({
        wait: async () => FAKE_SCHEMA_UID,
        receipt: FAKE_TX_RECEIPT,
      }),
    };

    (client as any).eas = {
      attest: async (params: any) => {
        attestCalls.push(params);
        return { wait: async () => '0xnameuid', receipt: FAKE_TX_RECEIPT };
      },
    };

    return { client, attestCalls };
  }

  it('attests schema name using SCHEMA_NAME_UID after registration', async () => {
    const { client, attestCalls } = createSchemaClient();

    await client.registerSchema('AreaRegistration');

    expect(attestCalls).toHaveLength(1);
    expect(attestCalls[0].schema).toBe(SCHEMA_NAME_UID);
    expect(attestCalls[0].data.refUID).toBe('0x0000000000000000000000000000000000000000000000000000000000000000');
    expect(attestCalls[0].data.revocable).toBe(true);
  });

  it('stores the schema UID after registration', async () => {
    const { client } = createSchemaClient();

    const result = await client.registerSchema('GardenerCheckin');

    expect(result.uid).toBe(FAKE_SCHEMA_UID);
    expect(result.name).toBe('GardenerCheckin');
    expect(result.txHash).toBe('0xtxhash');
    expect(client.getSchemaUIDs().GardenerCheckin).toBe(FAKE_SCHEMA_UID);
  });

  it('names each schema in registerAllSchemas', async () => {
    const { client, attestCalls } = createSchemaClient();

    const results = await client.registerAllSchemas();

    // 10 schemas total
    expect(results).toHaveLength(10);
    expect(attestCalls).toHaveLength(10);

    const names = results.map((r) => r.name);
    expect(names).toContain('AreaRegistration');
    expect(names).toContain('CitizenFeedback');
    expect(names).toContain('Healthcheck');
  });

  it('skips already-registered schemas but names new ones', async () => {
    const attestCalls: any[] = [];
    const client = new OpenGardenClient({
      signer: createMockSigner(),
      chain: TEST_CHAIN,
      schemaUIDs: {
        AreaRegistration: '0xexisting',
        PublishedIntervention: '0xexisting2',
        GardenerMilestone: '0xexisting3',
        ScheduledIntervention: '0xexisting4',
        GardenerCheckin: '0xexisting5',
        GardenerCheckout: '0xexisting6',
        GardenerReport: '0xexisting7',
        AdminValidation: '0xexisting8',
        CitizenFeedback: '0xexisting9',
      },
    });

    (client as any).registry = {
      register: async () => ({
        wait: async () => FAKE_SCHEMA_UID,
        receipt: FAKE_TX_RECEIPT,
      }),
    };

    (client as any).eas = {
      attest: async (params: any) => {
        attestCalls.push(params);
        return { wait: async () => '0xnameuid', receipt: FAKE_TX_RECEIPT };
      },
    };

    const results = await client.registerAllSchemas();

    // Only Healthcheck is missing
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Healthcheck');
    expect(attestCalls).toHaveLength(1);
  });

  it('still registers schema when naming schema is unavailable on chain', async () => {
    const client = new OpenGardenClient({
      signer: createMockSigner(),
      chain: TEST_CHAIN,
    });

    (client as any).registry = {
      register: async () => ({
        wait: async () => FAKE_SCHEMA_UID,
        receipt: FAKE_TX_RECEIPT,
      }),
    };

    (client as any).eas = {
      attest: async () => { throw new Error('NotFound'); },
    };

    const result = await client.registerSchema('AreaRegistration');

    expect(result.uid).toBe(FAKE_SCHEMA_UID);
    expect(result.name).toBe('AreaRegistration');
  });
});

describe('OpenGardenClient indexer', () => {
  const FAKE_SIGNED_ATTESTATION = { uid: '0xabc', message: { time: 1000000n } };
  const FAKE_TX_RECEIPT = { hash: '0xtxhash' };

  function createMockEas() {
    return {
      getOffchain: async () => ({
        signOffchainAttestation: async () => FAKE_SIGNED_ATTESTATION,
      }),
      timestamp: async () => ({
        wait: async () => 123456n,
        receipt: FAKE_TX_RECEIPT,
      }),
      attest: async () => ({
        wait: async () => '0xinterventionuid',
        receipt: FAKE_TX_RECEIPT,
      }),
    };
  }

  function createIndexerClient(opts: { indexOffchain?: boolean; chain?: ChainConfig } = {}) {
    const client = new OpenGardenClient({
      signer: createMockSigner(),
      chain: opts.chain ?? TEST_CHAIN,
      indexOffchain: opts.indexOffchain,
      schemaUIDs: {
        ScheduledIntervention: '0xschema1',
        PublishedIntervention: '0xschema2',
      },
    });
    (client as any).eas = createMockEas();
    return client;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts indexOffchain: true without throwing', () => {
    const client = new OpenGardenClient({
      signer: createMockSigner(),
      chain: TEST_CHAIN,
      indexOffchain: true,
    });
    expect(client).toBeInstanceOf(OpenGardenClient);
  });

  it('does not call fetch when indexOffchain is unset', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = createIndexerClient();

    await client.scheduleIntervention({
      areaUID: '0xarea',
      interventionId: 'INT-001',
      interventionType: 1,
      assignedGardener: '0x0000000000000000000000000000000000000001',
      crewSize: 2,
      scheduledDate: 1000000n,
      estimatedMinutes: 120,
      description: 'Test',
      commissionRef: '0x0000000000000000000000000000000000000000000000000000000000000000',
    });

    await client.publishIntervention({
      areaUID: '0xarea',
      interventionId: 'INT-001',
      gardener: '0x0000000000000000000000000000000000000001',
      interventionType: 1,
      executionDate: 1000000n,
      healthBefore: 3,
      healthAfter: 8,
      commissionRef: '0x0000000000000000000000000000000000000000000000000000000000000000',
      evidenceBundleHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      offchainCount: 1,
      crewSize: 2,
      isLead: true,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('submits pending attestations to indexer on publishIntervention', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const client = createIndexerClient({ indexOffchain: true });

    await client.scheduleIntervention({
      areaUID: '0xarea',
      interventionId: 'INT-001',
      interventionType: 1,
      assignedGardener: '0x0000000000000000000000000000000000000001',
      crewSize: 2,
      scheduledDate: 1000000n,
      estimatedMinutes: 120,
      description: 'Test',
      commissionRef: '0x0000000000000000000000000000000000000000000000000000000000000000',
    });

    // fetch should NOT have been called yet (queued, not submitted)
    expect(fetchMock).not.toHaveBeenCalled();

    const result = await client.publishIntervention({
      areaUID: '0xarea',
      interventionId: 'INT-001',
      gardener: '0x0000000000000000000000000000000000000001',
      interventionType: 1,
      executionDate: 1000000n,
      healthBefore: 3,
      healthAfter: 8,
      commissionRef: '0x0000000000000000000000000000000000000000000000000000000000000000',
      evidenceBundleHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      offchainCount: 1,
      crewSize: 2,
      isLead: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.indexedCount).toBe(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://optimism.easscan.org/offchain/store');
    expect(init.method).toBe('POST');

    const envelope = JSON.parse(init.body);
    expect(envelope.filename).toBe('eas.txt');
    const pkg = JSON.parse(envelope.textJson);
    expect(pkg.signer).toBe('0x0000000000000000000000000000000000000001');
    expect(pkg.sig).toBeDefined();

    vi.unstubAllGlobals();
  });

  it('serializes BigInt values as strings in indexer payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const client = createIndexerClient({ indexOffchain: true });

    await client.scheduleIntervention({
      areaUID: '0xarea',
      interventionId: 'INT-001',
      interventionType: 1,
      assignedGardener: '0x0000000000000000000000000000000000000001',
      crewSize: 2,
      scheduledDate: 1000000n,
      estimatedMinutes: 120,
      description: 'Test',
      commissionRef: '0x0000000000000000000000000000000000000000000000000000000000000000',
    });

    await client.publishIntervention({
      areaUID: '0xarea',
      interventionId: 'INT-001',
      gardener: '0x0000000000000000000000000000000000000001',
      interventionType: 1,
      executionDate: 1000000n,
      healthBefore: 3,
      healthAfter: 8,
      commissionRef: '0x0000000000000000000000000000000000000000000000000000000000000000',
      evidenceBundleHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      offchainCount: 1,
      crewSize: 2,
      isLead: true,
    });

    const envelope = JSON.parse(fetchMock.mock.calls[0][1].body);
    // textJson should be valid JSON
    expect(() => JSON.parse(envelope.textJson)).not.toThrow();
    const pkg = JSON.parse(envelope.textJson);
    // The fake attestation has time: 1000000n which should become "1000000"
    expect(pkg.sig.message.time).toBe('1000000');

    vi.unstubAllGlobals();
  });

  it('returns indexedCount: 0 and warns on non-200 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'Server Error' });
    vi.stubGlobal('fetch', fetchMock);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const client = createIndexerClient({ indexOffchain: true });

    await client.scheduleIntervention({
      areaUID: '0xarea',
      interventionId: 'INT-001',
      interventionType: 1,
      assignedGardener: '0x0000000000000000000000000000000000000001',
      crewSize: 2,
      scheduledDate: 1000000n,
      estimatedMinutes: 120,
      description: 'Test',
      commissionRef: '0x0000000000000000000000000000000000000000000000000000000000000000',
    });

    const result = await client.publishIntervention({
      areaUID: '0xarea',
      interventionId: 'INT-001',
      gardener: '0x0000000000000000000000000000000000000001',
      interventionType: 1,
      executionDate: 1000000n,
      healthBefore: 3,
      healthAfter: 8,
      commissionRef: '0x0000000000000000000000000000000000000000000000000000000000000000',
      evidenceBundleHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      offchainCount: 1,
      crewSize: 2,
      isLead: true,
    });

    expect(result.indexedCount).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('500'));

    vi.unstubAllGlobals();
  });

  it('returns indexedCount: 0 and warns on fetch error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const client = createIndexerClient({ indexOffchain: true });

    await client.scheduleIntervention({
      areaUID: '0xarea',
      interventionId: 'INT-001',
      interventionType: 1,
      assignedGardener: '0x0000000000000000000000000000000000000001',
      crewSize: 2,
      scheduledDate: 1000000n,
      estimatedMinutes: 120,
      description: 'Test',
      commissionRef: '0x0000000000000000000000000000000000000000000000000000000000000000',
    });

    const result = await client.publishIntervention({
      areaUID: '0xarea',
      interventionId: 'INT-001',
      gardener: '0x0000000000000000000000000000000000000001',
      interventionType: 1,
      executionDate: 1000000n,
      healthBefore: 3,
      healthAfter: 8,
      commissionRef: '0x0000000000000000000000000000000000000000000000000000000000000000',
      evidenceBundleHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      offchainCount: 1,
      crewSize: 2,
      isLead: true,
    });

    expect(result.indexedCount).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith('easscan indexer submission failed', expect.any(Error));

    vi.unstubAllGlobals();
  });

  it('skips indexing when chain has no easscan store endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const unknownChain: ChainConfig = {
      chainId: 99999n,
      easAddress: '0x4200000000000000000000000000000000000021',
      schemaRegistryAddress: '0x4200000000000000000000000000000000000020',
    };

    const client = createIndexerClient({ indexOffchain: true, chain: unknownChain });

    await client.scheduleIntervention({
      areaUID: '0xarea',
      interventionId: 'INT-001',
      interventionType: 1,
      assignedGardener: '0x0000000000000000000000000000000000000001',
      crewSize: 2,
      scheduledDate: 1000000n,
      estimatedMinutes: 120,
      description: 'Test',
      commissionRef: '0x0000000000000000000000000000000000000000000000000000000000000000',
    });

    const result = await client.publishIntervention({
      areaUID: '0xarea',
      interventionId: 'INT-001',
      gardener: '0x0000000000000000000000000000000000000001',
      interventionType: 1,
      executionDate: 1000000n,
      healthBefore: 3,
      healthAfter: 8,
      commissionRef: '0x0000000000000000000000000000000000000000000000000000000000000000',
      evidenceBundleHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      offchainCount: 1,
      crewSize: 2,
      isLead: true,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.indexedCount).toBe(0);

    vi.unstubAllGlobals();
  });

  it('clears pending queue after publishIntervention', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const client = createIndexerClient({ indexOffchain: true });

    await client.scheduleIntervention({
      areaUID: '0xarea',
      interventionId: 'INT-001',
      interventionType: 1,
      assignedGardener: '0x0000000000000000000000000000000000000001',
      crewSize: 2,
      scheduledDate: 1000000n,
      estimatedMinutes: 120,
      description: 'Test',
      commissionRef: '0x0000000000000000000000000000000000000000000000000000000000000000',
    });

    await client.publishIntervention({
      areaUID: '0xarea',
      interventionId: 'INT-001',
      gardener: '0x0000000000000000000000000000000000000001',
      interventionType: 1,
      executionDate: 1000000n,
      healthBefore: 3,
      healthAfter: 8,
      commissionRef: '0x0000000000000000000000000000000000000000000000000000000000000000',
      evidenceBundleHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      offchainCount: 1,
      crewSize: 2,
      isLead: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second publish should not re-submit the same attestation
    fetchMock.mockClear();
    const result2 = await client.publishIntervention({
      areaUID: '0xarea',
      interventionId: 'INT-002',
      gardener: '0x0000000000000000000000000000000000000001',
      interventionType: 1,
      executionDate: 1000000n,
      healthBefore: 3,
      healthAfter: 8,
      commissionRef: '0x0000000000000000000000000000000000000000000000000000000000000000',
      evidenceBundleHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      offchainCount: 0,
      crewSize: 2,
      isLead: true,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result2.indexedCount).toBe(0);

    vi.unstubAllGlobals();
  });
});
