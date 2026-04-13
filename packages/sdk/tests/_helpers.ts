import type { TransactionReceipt } from "ethers";
import { OpenGardenClient } from "../src/client";
import { OPTIMISM_MAINNET } from "../src/constants";
import type { ChainConfig, OpenGardenConfig } from "../src/types/config";
import type { TimestampedOffChainResult } from "../src/types/results";

export const MOCK_SIGNER_ADDRESS = "0x0000000000000000000000000000000000000001";

export const FAKE_TX_RECEIPT = {
	hash: "0xtxhash",
} as unknown as TransactionReceipt;

export const DEFAULT_TEST_CHAIN: ChainConfig = OPTIMISM_MAINNET;

// Inert stubs for the injected eas-sdk dependencies. Tests that exercise
// chain paths override these via createTestClient({ eas: {...}, registry:
// {...} }); tests that don't touch the chain at all get these no-op
// defaults so construction succeeds without loading eas-sdk.
// biome-ignore lint/suspicious/noExplicitAny: test stub cast
export const DEFAULT_EAS_STUB: any = {};
// biome-ignore lint/suspicious/noExplicitAny: test stub cast
export const DEFAULT_REGISTRY_STUB: any = {};

export function createMockSigner() {
	const provider = {
		resolveName: async () => null,
		getNetwork: async () => ({ chainId: 10n, name: "optimism" }),
	};
	return {
		getAddress: async () => MOCK_SIGNER_ADDRESS,
		signTransaction: async () => "0x",
		signMessage: async () => "0x",
		provider,
		estimateGas: async () => 0n,
		call: async () => "0x",
		resolveName: async () => null,
		sendTransaction: async () => ({}),
		// biome-ignore lint/suspicious/noExplicitAny: mock signer cast
	} as any;
}

/**
 * Builds a fully-populated `OpenGardenConfig` with default mocks for the
 * injected eas/registry deps. Callers can spread overrides on top — the
 * whole point is that tests don't have to repeat the stub wiring for
 * every construction site.
 */
export function createTestConfig(
	overrides: Partial<OpenGardenConfig> = {},
): OpenGardenConfig {
	return {
		signer: createMockSigner(),
		chain: DEFAULT_TEST_CHAIN,
		eas: DEFAULT_EAS_STUB,
		registry: DEFAULT_REGISTRY_STUB,
		...overrides,
	};
}

export function createTestClient(
	overrides: Partial<OpenGardenConfig> = {},
): OpenGardenClient {
	return new OpenGardenClient(createTestConfig(overrides));
}

export interface FakeResultOptions {
	time?: bigint;
	onchainTimestamp?: bigint;
	attester?: string;
	refUID?: string;
}

export function makeFakeTimestampedResult(
	uid: string,
	opts: FakeResultOptions = {},
): TimestampedOffChainResult {
	const message: Record<string, unknown> = { time: opts.time ?? 1000000n };
	if (opts.refUID !== undefined) message.refUID = opts.refUID;
	return {
		uid,
		signedAttestation: {
			uid,
			signer: opts.attester ?? MOCK_SIGNER_ADDRESS,
			message,
		},
		timestampTxHash: "0xtimestamp",
		onchainTimestamp: opts.onchainTimestamp ?? 123456n,
		timestampReceipt: FAKE_TX_RECEIPT,
	};
}
