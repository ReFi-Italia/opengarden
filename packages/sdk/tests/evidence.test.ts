import { describe, expect, it } from "vitest";
import { EVIDENCE_BUNDLE_VERSION } from "../src/constants";
import { OpenGardenError, OpenGardenErrorCode } from "../src/errors";
import { buildEvidenceBundle } from "../src/evidence";
import type { EvidenceBundleBuilderInput } from "../src/types/evidence";
import type { TimestampedOffChainResult } from "../src/types/results";
import { FAKE_TX_RECEIPT, makeFakeTimestampedResult } from "./_helpers";

function mockTimestampedResult(
	uid: string,
	time: number,
	onchainTimestamp: bigint,
	attester?: string,
): TimestampedOffChainResult {
	return makeFakeTimestampedResult(uid, {
		time: BigInt(time),
		onchainTimestamp,
		attester,
	});
}

function mockHealthcheck(uid: string, score: number, onchainTimestamp: bigint) {
	return {
		...mockTimestampedResult(uid, 0, onchainTimestamp),
		score,
	};
}

describe("buildEvidenceBundle", () => {
	const soloInput: EvidenceBundleBuilderInput = {
		interventionId: "INT-2026-0001",
		areaUID: "0xarea123",
		scheduled: mockTimestampedResult("0xsched", 1000, 1015n),
		crew: [
			{
				checkin: mockTimestampedResult("0xcheckin", 2000, 2018n, "0xAlice"),
				checkout: mockTimestampedResult("0xcheckout", 3000, 3012n, "0xAlice"),
				report: mockTimestampedResult("0xreport", 3100, 3120n, "0xAlice"),
			},
		],
		validation: {
			...mockTimestampedResult("0xvalidation", 4000, 4025n),
			approved: true,
			qualityScore: 8,
		},
		photos: {
			checkinPhotos: ["ipfs://Qm.../arrival.jpg"],
			reportPhotos: "ipfs://Qm.../work/",
		},
	};

	it("sets bundleVersion to the current constant", () => {
		const bundle = buildEvidenceBundle(soloInput);
		expect(bundle.bundleVersion).toBe(EVIDENCE_BUNDLE_VERSION);
	});

	it("includes interventionId and areaUID", () => {
		const bundle = buildEvidenceBundle(soloInput);
		expect(bundle.interventionId).toBe("INT-2026-0001");
		expect(bundle.areaUID).toBe("0xarea123");
	});

	it("includes all core attestations for a solo job", () => {
		const bundle = buildEvidenceBundle(soloInput);
		expect(bundle.attestations.scheduled.uid).toBe("0xsched");
		expect(bundle.attestations.checkins).toHaveLength(1);
		expect(bundle.attestations.checkouts).toHaveLength(1);
		expect(bundle.attestations.reports).toHaveLength(1);
		expect(bundle.attestations.checkins[0].uid).toBe("0xcheckin");
		expect(bundle.attestations.checkouts[0].uid).toBe("0xcheckout");
		expect(bundle.attestations.reports[0].uid).toBe("0xreport");
		expect(bundle.attestations.validation.uid).toBe("0xvalidation");
	});

	it("preserves per-gardener arrays for a crew job", () => {
		const crewInput: EvidenceBundleBuilderInput = {
			...soloInput,
			crew: [
				{
					checkin: mockTimestampedResult("0xciA", 2000, 2018n, "0xAlice"),
					checkout: mockTimestampedResult("0xcoA", 3000, 3012n, "0xAlice"),
					report: mockTimestampedResult("0xrpA", 3100, 3120n, "0xAlice"),
				},
				{
					checkin: mockTimestampedResult("0xciB", 2100, 2118n, "0xBob"),
					checkout: mockTimestampedResult("0xcoB", 3200, 3212n, "0xBob"),
					report: mockTimestampedResult("0xrpB", 3300, 3320n, "0xBob"),
				},
			],
		};
		const bundle = buildEvidenceBundle(crewInput);
		expect(bundle.attestations.checkins).toHaveLength(2);
		expect(bundle.attestations.checkouts).toHaveLength(2);
		expect(bundle.attestations.reports).toHaveLength(2);
		expect(bundle.attestations.reports[0].attester).toBe("0xAlice");
		expect(bundle.attestations.reports[1].attester).toBe("0xBob");
	});

	it("converts onchainTimestamp from bigint to number", () => {
		const bundle = buildEvidenceBundle(soloInput);
		expect(bundle.attestations.scheduled.onchainTimestamp).toBe(1015);
		expect(bundle.attestations.checkins[0].onchainTimestamp).toBe(2018);
	});

	it("includes validation-specific fields", () => {
		const bundle = buildEvidenceBundle(soloInput);
		expect(bundle.attestations.validation.approved).toBe(true);
		expect(bundle.attestations.validation.qualityScore).toBe(8);
	});

	it("includes photo references", () => {
		const bundle = buildEvidenceBundle(soloInput);
		expect(bundle.photos.checkinPhotos).toEqual(["ipfs://Qm.../arrival.jpg"]);
		expect(bundle.photos.reportPhotos).toBe("ipfs://Qm.../work/");
		expect(bundle.photos.afterPhotos).toBeUndefined();
	});

	it("omits healthchecks when not provided", () => {
		const bundle = buildEvidenceBundle(soloInput);
		expect(bundle.attestations.healthcheckBefore).toBeUndefined();
		expect(bundle.attestations.healthcheckAfter).toBeUndefined();
	});

	it("includes healthchecks when provided", () => {
		const withHealth: EvidenceBundleBuilderInput = {
			...soloInput,
			healthcheckBefore: mockHealthcheck("0xhcbefore", 3, 500n),
			healthcheckAfter: mockHealthcheck("0xhcafter", 8, 5000n),
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

	it("throws INVALID_INPUT when a gardener attestation has no signer or attester", () => {
		const resultWithoutAttester: TimestampedOffChainResult = {
			uid: "0xciA",
			signedAttestation: { message: { time: 2000n } },
			timestampTxHash: "0xtx",
			onchainTimestamp: 2018n,
			timestampReceipt: FAKE_TX_RECEIPT,
		};
		const input: EvidenceBundleBuilderInput = {
			...soloInput,
			crew: [
				{
					checkin: resultWithoutAttester,
					checkout: mockTimestampedResult("0xcoA", 3000, 3012n, "0xAlice"),
					report: mockTimestampedResult("0xrpA", 3100, 3120n, "0xAlice"),
				},
			],
		};
		expect(() => buildEvidenceBundle(input)).toThrow(OpenGardenError);
		try {
			buildEvidenceBundle(input);
		} catch (e) {
			expect((e as OpenGardenError).code).toBe(
				OpenGardenErrorCode.INVALID_INPUT,
			);
			expect((e as Error).message).toContain("checkin");
			expect((e as Error).message).toContain("0xciA");
		}
	});

	it("accepts message.attester as a fallback identity source", () => {
		const resultWithMessageAttester: TimestampedOffChainResult = {
			uid: "0xciA",
			signedAttestation: {
				message: { time: 2000n, attester: "0xBobFromMessage" },
			},
			timestampTxHash: "0xtx",
			onchainTimestamp: 2018n,
			timestampReceipt: FAKE_TX_RECEIPT,
		};
		const bundle = buildEvidenceBundle({
			...soloInput,
			crew: [
				{
					checkin: resultWithMessageAttester,
					checkout: mockTimestampedResult("0xcoA", 3000, 3012n, "0xBob"),
					report: mockTimestampedResult("0xrpA", 3100, 3120n, "0xBob"),
				},
			],
		});
		expect(bundle.attestations.checkins[0].attester).toBe("0xBobFromMessage");
	});
});
