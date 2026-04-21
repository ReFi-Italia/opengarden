import { describe, expect, it } from "vitest";
import { EVIDENCE_BUNDLE_VERSION } from "../src/constants";
import type { EvidenceBundle } from "../src/types/evidence";
import {
	VerificationCheckCode,
	verifyBundleCrewConsistency,
	verifyBundleCrewDistinctness,
	verifyBundleCrewSize,
	verifyBundleExecutionDateBracket,
	verifyBundleOnChainTimestamps,
	verifyBundleRefUIDs,
	verifyBundleTemporalOrder,
	verifyBundleVersion,
} from "../src/verification";

/**
 * Build a synthetic signed attestation payload. Carries just enough shape for
 * the verification helpers that inspect `message.refUID` and `signer`; not a
 * valid EIP-712 signature.
 */
function makeSignedAttestation(opts: {
	uid: string;
	signer: string;
	refUID: string;
	time: number;
}) {
	return {
		version: 1,
		uid: opts.uid,
		signer: opts.signer,
		message: {
			schema: "0xschema",
			recipient: "0x0000000000000000000000000000000000000000",
			time: opts.time,
			expirationTime: 0,
			revocable: false,
			refUID: opts.refUID,
			data: "0x",
		},
		signature: { r: "0x", s: "0x", v: 0 },
	};
}

const AREA_UID = "0xarea";
const SCHED_UID = "0xsched";

function makeBundle(
	overrides: {
		crewCount?: number;
		scheduledTs?: number;
		bundleVersion?: string;
		mismatchCrew?: { checkouts?: number; reports?: number };
	} = {},
): EvidenceBundle {
	const crewCount = overrides.crewCount ?? 1;
	const scheduledTs = overrides.scheduledTs ?? 100;

	const checkins = Array.from({ length: crewCount }, (_, i) => ({
		uid: `0xcheckin${i}`,
		attester: `0xAttester${i}`,
		claimedTimestamp: 200 + i,
		onchainTimestamp: 200 + i,
		signedAttestation: makeSignedAttestation({
			uid: `0xcheckin${i}`,
			signer: `0xAttester${i}`,
			refUID: SCHED_UID,
			time: 200 + i,
		}),
	}));
	const checkouts = Array.from(
		{ length: overrides.mismatchCrew?.checkouts ?? crewCount },
		(_, i) => ({
			uid: `0xcheckout${i}`,
			attester: `0xAttester${i}`,
			claimedTimestamp: 300 + i,
			onchainTimestamp: 300 + i,
			signedAttestation: makeSignedAttestation({
				uid: `0xcheckout${i}`,
				signer: `0xAttester${i}`,
				refUID: `0xcheckin${i}`,
				time: 300 + i,
			}),
		}),
	);
	const reports = Array.from(
		{ length: overrides.mismatchCrew?.reports ?? crewCount },
		(_, i) => ({
			uid: `0xreport${i}`,
			attester: `0xAttester${i}`,
			claimedTimestamp: 400 + i,
			onchainTimestamp: 400 + i,
			signedAttestation: makeSignedAttestation({
				uid: `0xreport${i}`,
				signer: `0xAttester${i}`,
				refUID: SCHED_UID,
				time: 400 + i,
			}),
		}),
	);

	return {
		interventionId: "INT-001",
		areaUID: AREA_UID,
		attestations: {
			scheduled: {
				uid: SCHED_UID,
				claimedTimestamp: scheduledTs,
				onchainTimestamp: scheduledTs,
				signedAttestation: makeSignedAttestation({
					uid: SCHED_UID,
					signer: "0xOrg",
					refUID: AREA_UID,
					time: scheduledTs,
				}),
			},
			checkins,
			checkouts,
			reports,
		},
		photos: {},
		bundleVersion: (overrides.bundleVersion ??
			EVIDENCE_BUNDLE_VERSION) as typeof EVIDENCE_BUNDLE_VERSION,
	};
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

	it("fails when an individual crew member has out-of-order timestamps", () => {
		const bundle = makeBundle({ crewCount: 1 });
		bundle.attestations.reports[0].onchainTimestamp = 250; // before checkout
		const result = verifyBundleTemporalOrder(bundle);
		expect(result.valid).toBe(false);
		expect(result.message).toContain("Crew member 0");
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

describe("verifyBundleOnChainTimestamps", () => {
	it("passes when every fetcher result matches the bundle", async () => {
		const bundle = makeBundle({ crewCount: 1 });
		const fetcher = async (_uid: string) => {
			const all = [
				...bundle.attestations.checkins,
				...bundle.attestations.checkouts,
				...bundle.attestations.reports,
				bundle.attestations.scheduled,
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

describe("verifyBundleRefUIDs", () => {
	it("passes when every entry's refUID points at the expected parent", () => {
		const bundle = makeBundle({ crewCount: 2 });
		const result = verifyBundleRefUIDs(bundle);
		expect(result).toEqual({
			code: VerificationCheckCode.REFUID_WIRING,
			valid: true,
		});
	});

	it("fails when scheduled refUID does not match the bundle areaUID", () => {
		const bundle = makeBundle({ crewCount: 1 });
		(
			bundle.attestations.scheduled.signedAttestation as {
				message: { refUID: string };
			}
		).message.refUID = "0xwrong";
		const result = verifyBundleRefUIDs(bundle);
		expect(result.valid).toBe(false);
		expect(result.message).toContain("Scheduled");
	});

	it("fails when a checkin refUID does not match the scheduled UID", () => {
		const bundle = makeBundle({ crewCount: 2 });
		(
			bundle.attestations.checkins[1].signedAttestation as {
				message: { refUID: string };
			}
		).message.refUID = "0xwrong";
		const result = verifyBundleRefUIDs(bundle);
		expect(result.valid).toBe(false);
		expect(result.message).toContain("checkin[1]");
	});

	it("fails when a checkout refUID does not match its paired checkin UID", () => {
		const bundle = makeBundle({ crewCount: 1 });
		(
			bundle.attestations.checkouts[0].signedAttestation as {
				message: { refUID: string };
			}
		).message.refUID = "0xsomeoneelsescheckin";
		const result = verifyBundleRefUIDs(bundle);
		expect(result.valid).toBe(false);
		expect(result.message).toContain("checkout[0]");
	});

	it("fails when a report refUID does not match the scheduled UID", () => {
		const bundle = makeBundle({ crewCount: 1 });
		(
			bundle.attestations.reports[0].signedAttestation as {
				message: { refUID: string };
			}
		).message.refUID = "0xwrong";
		const result = verifyBundleRefUIDs(bundle);
		expect(result.valid).toBe(false);
		expect(result.message).toContain("report[0]");
	});

	it("compares UIDs case-insensitively", () => {
		const bundle = makeBundle({ crewCount: 1 });
		(
			bundle.attestations.checkins[0].signedAttestation as {
				message: { refUID: string };
			}
		).message.refUID = SCHED_UID.toUpperCase();
		const result = verifyBundleRefUIDs(bundle);
		expect(result.valid).toBe(true);
	});
});

describe("verifyBundleCrewSize", () => {
	it("passes when all three arrays match the scheduled crewSize", () => {
		const bundle = makeBundle({ crewCount: 2 });
		const result = verifyBundleCrewSize(bundle, { crewSize: 2 });
		expect(result).toEqual({
			code: VerificationCheckCode.CREW_SIZE,
			valid: true,
		});
	});

	it("fails when bundle has fewer crew tuples than scheduled", () => {
		const bundle = makeBundle({ crewCount: 1 });
		const result = verifyBundleCrewSize(bundle, { crewSize: 3 });
		expect(result.valid).toBe(false);
		expect(result.message).toContain("crewSize (3)");
	});

	it("fails when bundle has more crew tuples than scheduled", () => {
		const bundle = makeBundle({ crewCount: 3 });
		const result = verifyBundleCrewSize(bundle, { crewSize: 1 });
		expect(result.valid).toBe(false);
		expect(result.message).toContain("checkins=3");
	});

	it("fails when checkins matches but checkouts/reports don't", () => {
		const bundle = makeBundle({
			crewCount: 2,
			mismatchCrew: { checkouts: 1 },
		});
		const result = verifyBundleCrewSize(bundle, { crewSize: 2 });
		expect(result.valid).toBe(false);
		expect(result.message).toContain("checkouts=1");
	});
});

describe("verifyBundleCrewConsistency", () => {
	it("passes when every crew member's checkin/checkout/report share an attester", () => {
		const bundle = makeBundle({ crewCount: 2 });
		const result = verifyBundleCrewConsistency(bundle);
		expect(result).toEqual({
			code: VerificationCheckCode.CREW_CONSISTENCY,
			valid: true,
		});
	});

	it("fails when one member's report attester differs", () => {
		const bundle = makeBundle({ crewCount: 2 });
		bundle.attestations.reports[1].attester = "0xSomeoneElse";
		const result = verifyBundleCrewConsistency(bundle);
		expect(result.valid).toBe(false);
		expect(result.message).toContain("Crew member 1");
	});

	it("passes regardless of attester casing", () => {
		const bundle = makeBundle({ crewCount: 1 });
		bundle.attestations.checkins[0].attester = "0xABC";
		bundle.attestations.checkouts[0].attester = "0xabc";
		bundle.attestations.reports[0].attester = "0xAbc";
		const result = verifyBundleCrewConsistency(bundle);
		expect(result.valid).toBe(true);
	});

	it("fails when crew arrays have mismatched lengths", () => {
		const bundle = makeBundle({
			crewCount: 2,
			mismatchCrew: { reports: 1 },
		});
		const result = verifyBundleCrewConsistency(bundle);
		expect(result.valid).toBe(false);
		expect(result.message).toContain("inconsistent crew arrays");
	});
});

describe("verifyBundleCrewDistinctness", () => {
	it("passes when every crew member has a distinct attester wallet", () => {
		const bundle = makeBundle({ crewCount: 3 });
		const result = verifyBundleCrewDistinctness(bundle);
		expect(result).toEqual({
			code: VerificationCheckCode.CREW_DISTINCTNESS,
			valid: true,
		});
	});

	it("fails when two crew members share an attester wallet", () => {
		const bundle = makeBundle({ crewCount: 2 });
		bundle.attestations.checkins[1].attester =
			bundle.attestations.checkins[0].attester;
		const result = verifyBundleCrewDistinctness(bundle);
		expect(result.valid).toBe(false);
		expect(result.message).toContain("distinct");
	});

	it("compares wallets case-insensitively", () => {
		const bundle = makeBundle({ crewCount: 2 });
		bundle.attestations.checkins[0].attester = "0xABC";
		bundle.attestations.checkins[1].attester = "0xabc";
		const result = verifyBundleCrewDistinctness(bundle);
		expect(result.valid).toBe(false);
	});

	it("passes trivially for a solo bundle", () => {
		const bundle = makeBundle({ crewCount: 1 });
		const result = verifyBundleCrewDistinctness(bundle);
		expect(result.valid).toBe(true);
	});
});
