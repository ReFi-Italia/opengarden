import type { TransactionReceipt } from "ethers";
import { describe, expect, it } from "vitest";
import { buildEvidenceBundle } from "../src/evidence";
import type { EvidenceBundleBuilderInput } from "../src/types/evidence";
import type { TimestampedOffChainResult } from "../src/types/results";

function mockTimestampedResult(
	uid: string,
	time: number,
	onchainTimestamp: bigint,
): TimestampedOffChainResult {
	return {
		uid,
		signedAttestation: {
			message: { time: BigInt(time) },
			uid,
		},
		timestampTxHash: `0xtx${uid}`,
		onchainTimestamp,
		timestampReceipt: {} as TransactionReceipt,
	};
}

describe("buildEvidenceBundle", () => {
	const input: EvidenceBundleBuilderInput = {
		interventionId: "INT-2026-0001",
		areaUID: "0xarea123",
		scheduled: mockTimestampedResult("0xsched", 1000, 1015n),
		checkin: mockTimestampedResult("0xcheckin", 2000, 2018n),
		checkout: mockTimestampedResult("0xcheckout", 3000, 3012n),
		report: mockTimestampedResult("0xreport", 3100, 3120n),
		validation: {
			...mockTimestampedResult("0xvalidation", 4000, 4025n),
			approved: true,
			qualityScore: 8,
		},
		photos: {
			checkinPhoto: "ipfs://Qm.../arrival.jpg",
			reportPhotos: "ipfs://Qm.../work/",
		},
	};

	it("sets bundleVersion to 1.0", () => {
		const bundle = buildEvidenceBundle(input);
		expect(bundle.bundleVersion).toBe("1.0");
	});

	it("includes interventionId and areaUID", () => {
		const bundle = buildEvidenceBundle(input);
		expect(bundle.interventionId).toBe("INT-2026-0001");
		expect(bundle.areaUID).toBe("0xarea123");
	});

	it("includes all 5 core attestations", () => {
		const bundle = buildEvidenceBundle(input);
		expect(bundle.attestations.scheduled.uid).toBe("0xsched");
		expect(bundle.attestations.checkin.uid).toBe("0xcheckin");
		expect(bundle.attestations.checkout.uid).toBe("0xcheckout");
		expect(bundle.attestations.report.uid).toBe("0xreport");
		expect(bundle.attestations.validation.uid).toBe("0xvalidation");
	});

	it("converts onchainTimestamp from bigint to number", () => {
		const bundle = buildEvidenceBundle(input);
		expect(bundle.attestations.scheduled.onchainTimestamp).toBe(1015);
		expect(bundle.attestations.checkin.onchainTimestamp).toBe(2018);
	});

	it("includes validation-specific fields", () => {
		const bundle = buildEvidenceBundle(input);
		expect(bundle.attestations.validation.approved).toBe(true);
		expect(bundle.attestations.validation.qualityScore).toBe(8);
	});

	it("includes photo references", () => {
		const bundle = buildEvidenceBundle(input);
		expect(bundle.photos.checkinPhoto).toBe("ipfs://Qm.../arrival.jpg");
		expect(bundle.photos.reportPhotos).toBe("ipfs://Qm.../work/");
		expect(bundle.photos.afterPhotos).toBeUndefined();
	});

	it("omits healthchecks when not provided", () => {
		const bundle = buildEvidenceBundle(input);
		expect(bundle.attestations.healthcheckBefore).toBeUndefined();
		expect(bundle.attestations.healthcheckAfter).toBeUndefined();
	});

	it("includes healthchecks when provided", () => {
		const withHealth: EvidenceBundleBuilderInput = {
			...input,
			healthcheckBefore: {
				uid: "0xhcbefore",
				score: 3,
				onchainTimestamp: 500n,
			},
			healthcheckAfter: { uid: "0xhcafter", score: 8, onchainTimestamp: 5000n },
		};
		const bundle = buildEvidenceBundle(withHealth);
		expect(bundle.attestations.healthcheckBefore).toEqual({
			uid: "0xhcbefore",
			score: 3,
			onchainTimestamp: 500,
		});
		expect(bundle.attestations.healthcheckAfter).toEqual({
			uid: "0xhcafter",
			score: 8,
			onchainTimestamp: 5000,
		});
	});
});
