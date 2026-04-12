import { describe, expect, it } from "vitest";
import { EVIDENCE_BUNDLE_VERSION } from "../src/constants";
import type { EvidenceBundle } from "../src/types/evidence";
import {
	VerificationCheckCode,
	verifyBundleCompleteness,
	verifyBundleExecutionDateBracket,
	verifyBundleHealthcheckBracket,
	verifyBundleOnChainTimestamps,
	verifyBundleTemporalOrder,
	verifyBundleValidationApproved,
	verifyBundleVersion,
} from "../src/verification";

function makeBundle(
	overrides: {
		crewCount?: number;
		scheduledTs?: number;
		validationTs?: number;
		bundleVersion?: string;
		approved?: boolean;
		healthcheckBeforeTs?: number;
		healthcheckAfterTs?: number;
		mismatchCrew?: { checkouts?: number; reports?: number };
	} = {},
): EvidenceBundle {
	const crewCount = overrides.crewCount ?? 1;
	const scheduledTs = overrides.scheduledTs ?? 100;
	const validationTs = overrides.validationTs ?? 500;

	const checkins = Array.from({ length: crewCount }, (_, i) => ({
		uid: `0xcheckin${i}`,
		contentHash: `0xcheckin${i}`,
		attester: `0xAttester${i}`,
		claimedTimestamp: 200 + i,
		onchainTimestamp: 200 + i,
	}));
	const checkouts = Array.from(
		{ length: overrides.mismatchCrew?.checkouts ?? crewCount },
		(_, i) => ({
			uid: `0xcheckout${i}`,
			contentHash: `0xcheckout${i}`,
			attester: `0xAttester${i}`,
			claimedTimestamp: 300 + i,
			onchainTimestamp: 300 + i,
		}),
	);
	const reports = Array.from(
		{ length: overrides.mismatchCrew?.reports ?? crewCount },
		(_, i) => ({
			uid: `0xreport${i}`,
			contentHash: `0xreport${i}`,
			attester: `0xAttester${i}`,
			claimedTimestamp: 400 + i,
			onchainTimestamp: 400 + i,
		}),
	);

	const bundle: EvidenceBundle = {
		interventionId: "INT-001",
		areaUID: "0xarea",
		attestations: {
			scheduled: {
				uid: "0xsched",
				contentHash: "0xsched",
				claimedTimestamp: scheduledTs,
				onchainTimestamp: scheduledTs,
			},
			checkins,
			checkouts,
			reports,
			validation: {
				uid: "0xvalidation",
				contentHash: "0xvalidation",
				claimedTimestamp: validationTs,
				onchainTimestamp: validationTs,
				approved: overrides.approved ?? true,
				qualityScore: 8,
			},
		},
		photos: {},
		bundleVersion: (overrides.bundleVersion ??
			EVIDENCE_BUNDLE_VERSION) as typeof EVIDENCE_BUNDLE_VERSION,
	};

	if (overrides.healthcheckBeforeTs != null) {
		bundle.attestations.healthcheckBefore = {
			uid: "0xhcbefore",
			score: 3,
			onchainTimestamp: overrides.healthcheckBeforeTs,
		};
	}
	if (overrides.healthcheckAfterTs != null) {
		bundle.attestations.healthcheckAfter = {
			uid: "0xhcafter",
			score: 8,
			onchainTimestamp: overrides.healthcheckAfterTs,
		};
	}

	return bundle;
}

describe("verifyBundleVersion", () => {
	it("passes for current version", () => {
		const result = verifyBundleVersion(makeBundle());
		expect(result).toEqual({
			code: VerificationCheckCode.BUNDLE_VERSION,
			valid: true,
		});
	});

	it("fails for unknown version", () => {
		const result = verifyBundleVersion(makeBundle({ bundleVersion: "99.9.9" }));
		expect(result.valid).toBe(false);
		expect(result.message).toContain("99.9.9");
	});
});

describe("verifyBundleCompleteness", () => {
	it("passes when attestation count matches expected", () => {
		const bundle = makeBundle({ crewCount: 1 });
		const result = verifyBundleCompleteness(bundle, 5);
		expect(result.valid).toBe(true);
		expect(result.attestationCount).toBe(5);
		expect(result.expectedCount).toBe(5);
	});

	it("counts healthchecks toward the total", () => {
		const bundle = makeBundle({
			crewCount: 1,
			healthcheckBeforeTs: 50,
			healthcheckAfterTs: 450,
		});
		const result = verifyBundleCompleteness(bundle, 7);
		expect(result.valid).toBe(true);
		expect(result.attestationCount).toBe(7);
	});

	it("fails when counts disagree", () => {
		const bundle = makeBundle({ crewCount: 1 });
		const result = verifyBundleCompleteness(bundle, 7);
		expect(result.valid).toBe(false);
		expect(result.attestationCount).toBe(5);
		expect(result.expectedCount).toBe(7);
	});
});

describe("verifyBundleTemporalOrder", () => {
	it("passes for a valid solo crew", () => {
		expect(verifyBundleTemporalOrder(makeBundle()).valid).toBe(true);
	});

	it("passes for a valid multi-crew bundle", () => {
		expect(verifyBundleTemporalOrder(makeBundle({ crewCount: 3 })).valid).toBe(
			true,
		);
	});

	it("fails when crew arrays have mismatched lengths", () => {
		const bundle = makeBundle({
			crewCount: 2,
			mismatchCrew: { checkouts: 1 },
		});
		const result = verifyBundleTemporalOrder(bundle);
		expect(result.valid).toBe(false);
		expect(result.message).toContain("inconsistent crew arrays");
	});

	it("fails when scheduled is not strictly before first checkin", () => {
		const bundle = makeBundle({ scheduledTs: 200 });
		const result = verifyBundleTemporalOrder(bundle);
		expect(result.valid).toBe(false);
		expect(result.message).toContain("precede the earliest checkin");
	});

	it("fails when last report is not strictly before validation", () => {
		const bundle = makeBundle({ validationTs: 400 });
		const result = verifyBundleTemporalOrder(bundle);
		expect(result.valid).toBe(false);
		expect(result.message).toContain("precede validation");
	});

	it("fails when an individual crew member has out-of-order timestamps", () => {
		const bundle = makeBundle({ crewCount: 1 });
		bundle.attestations.reports[0].onchainTimestamp = 250; // before checkout
		const result = verifyBundleTemporalOrder(bundle);
		expect(result.valid).toBe(false);
		expect(result.message).toContain("Crew member 0");
	});
});

describe("verifyBundleHealthcheckBracket", () => {
	it("passes when healthchecks are absent", () => {
		expect(verifyBundleHealthcheckBracket(makeBundle()).valid).toBe(true);
	});

	it("passes when healthchecks bracket the work", () => {
		const bundle = makeBundle({
			healthcheckBeforeTs: 50,
			healthcheckAfterTs: 450,
		});
		expect(verifyBundleHealthcheckBracket(bundle).valid).toBe(true);
	});

	it("fails when healthcheckBefore is not before the first checkin", () => {
		const bundle = makeBundle({ healthcheckBeforeTs: 250 });
		const result = verifyBundleHealthcheckBracket(bundle);
		expect(result.valid).toBe(false);
		expect(result.message).toContain("Healthcheck-before");
	});

	it("fails when healthcheckAfter is not after the last checkout", () => {
		const bundle = makeBundle({ healthcheckAfterTs: 250 });
		const result = verifyBundleHealthcheckBracket(bundle);
		expect(result.valid).toBe(false);
		expect(result.message).toContain("Healthcheck-after");
	});
});

describe("verifyBundleExecutionDateBracket", () => {
	it("passes when executionDate sits between schedule and publication", () => {
		const result = verifyBundleExecutionDateBracket(makeBundle(), {
			executionDate: 300n,
			time: 600n,
		});
		expect(result.valid).toBe(true);
	});

	it("fails when executionDate predates schedule", () => {
		const result = verifyBundleExecutionDateBracket(makeBundle(), {
			executionDate: 50n,
			time: 600n,
		});
		expect(result.valid).toBe(false);
	});

	it("fails when executionDate postdates publication", () => {
		const result = verifyBundleExecutionDateBracket(makeBundle(), {
			executionDate: 700n,
			time: 600n,
		});
		expect(result.valid).toBe(false);
	});
});

describe("verifyBundleValidationApproved", () => {
	it("passes when validation is approved", () => {
		expect(verifyBundleValidationApproved(makeBundle()).valid).toBe(true);
	});

	it("fails when validation is not approved", () => {
		expect(
			verifyBundleValidationApproved(makeBundle({ approved: false })).valid,
		).toBe(false);
	});
});

describe("verifyBundleOnChainTimestamps", () => {
	it("passes when every fetcher result matches the bundle", async () => {
		const bundle = makeBundle({ crewCount: 1 });
		const fetcher = async (_uid: string) => {
			const all = [
				...bundle.attestations.checkins,
				...bundle.attestations.checkouts,
				...bundle.attestations.reports,
				bundle.attestations.scheduled,
				bundle.attestations.validation,
			];
			const match = all.find((a) => a.uid === _uid);
			return match ? BigInt(match.onchainTimestamp) : null;
		};
		const result = await verifyBundleOnChainTimestamps(bundle, fetcher);
		expect(result.valid).toBe(true);
	});

	it("fails when a fetched timestamp does not match", async () => {
		const bundle = makeBundle({ crewCount: 1 });
		const fetcher = async (uid: string) => {
			if (uid === "0xcheckin0") return 999n; // wrong
			const all = [
				...bundle.attestations.checkouts,
				...bundle.attestations.reports,
				bundle.attestations.scheduled,
				bundle.attestations.validation,
			];
			const match = all.find((a) => a.uid === uid);
			return match ? BigInt(match.onchainTimestamp) : null;
		};
		const result = await verifyBundleOnChainTimestamps(bundle, fetcher);
		expect(result.valid).toBe(false);
		expect(result.message).toContain("0xcheckin0");
	});

	it("fails gracefully when a fetcher throws", async () => {
		const bundle = makeBundle({ crewCount: 1 });
		const fetcher = async (_uid: string) => {
			throw new Error("network down");
		};
		const result = await verifyBundleOnChainTimestamps(bundle, fetcher);
		expect(result.valid).toBe(false);
	});
});
