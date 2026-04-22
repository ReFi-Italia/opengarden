import { describe, expect, it } from "vitest";
import { ZERO_BYTES32 } from "../src/constants";
import {
	decodeIntervention,
	encodeIntervention,
} from "../src/schemas/encoders";
import { type SponsorRef, serializeSponsorRef } from "../src/sponsor";
import { InterventionType } from "../src/types/enums";
import { hashIdentifier } from "../src/utils";

describe("serializeSponsorRef", () => {
	it("returns null for volunteer", () => {
		expect(serializeSponsorRef({ kind: "volunteer" })).toBeNull();
	});

	it("serializes corporate sponsors with kind-first JSON", () => {
		expect(
			serializeSponsorRef({ kind: "corporate", sponsorId: "acme-001" }),
		).toBe('{"kind":"corporate","sponsorId":"acme-001"}');
	});

	it("serializes municipal contracts with kind-first JSON", () => {
		expect(
			serializeSponsorRef({ kind: "municipal", contractNumber: "RM-2026-017" }),
		).toBe('{"kind":"municipal","contractNumber":"RM-2026-017"}');
	});

	it("serializes grants with kind-first JSON", () => {
		expect(
			serializeSponsorRef({ kind: "grant", grantId: "EU-HORIZON-42" }),
		).toBe('{"kind":"grant","grantId":"EU-HORIZON-42"}');
	});

	it("is deterministic — repeated calls produce identical output", () => {
		const ref: SponsorRef = { kind: "corporate", sponsorId: "acme-001" };
		expect(serializeSponsorRef(ref)).toBe(serializeSponsorRef(ref));
	});

	it("distinct kinds with the same identifier produce distinct strings", () => {
		expect(
			serializeSponsorRef({ kind: "corporate", sponsorId: "abc" }),
		).not.toBe(
			serializeSponsorRef({ kind: "municipal", contractNumber: "abc" }),
		);
	});
});

describe("commissionId encoding with SponsorRef", () => {
	const baseInput = {
		areaUID: ZERO_BYTES32,
		interventionId: "INT-2026-0001",
		interventionType: InterventionType.RoutineMaintenance,
		executionDate: 1709251200n,
		evidenceBundleHash: ZERO_BYTES32,
		offchainCount: 5,
		crewSize: 1,
	};

	it("a structured SponsorRef produces the same on-chain hash as passing the canonical string directly", () => {
		const ref: SponsorRef = {
			kind: "corporate",
			sponsorId: "acme-001",
		};
		const canonical = serializeSponsorRef(ref);
		expect(canonical).not.toBeNull();

		const encodedFromRef = encodeIntervention({
			...baseInput,
			commissionId: ref,
		});
		const encodedFromString = encodeIntervention({
			...baseInput,
			commissionId: canonical as string,
		});
		expect(encodedFromRef).toBe(encodedFromString);

		const decoded = decodeIntervention(encodedFromRef);
		expect(decoded.commissionRef).toBe(hashIdentifier(canonical as string));
	});

	it("distinct kinds with the same identifier produce distinct on-chain hashes", () => {
		const corporate = encodeIntervention({
			...baseInput,
			commissionId: { kind: "corporate", sponsorId: "abc" },
		});
		const municipal = encodeIntervention({
			...baseInput,
			commissionId: { kind: "municipal", contractNumber: "abc" },
		});
		expect(decodeIntervention(corporate).commissionRef).not.toBe(
			decodeIntervention(municipal).commissionRef,
		);
	});

	it("a volunteer SponsorRef encodes to ZERO_BYTES32", () => {
		const encoded = encodeIntervention({
			...baseInput,
			commissionId: { kind: "volunteer" },
		});
		const decoded = decodeIntervention(encoded);
		expect(decoded.commissionRef).toBe(ZERO_BYTES32);
	});

	it("a structured corporate ref differs from the same plain string", () => {
		const structured = encodeIntervention({
			...baseInput,
			commissionId: { kind: "corporate", sponsorId: "acme-001" },
		});
		const plain = encodeIntervention({
			...baseInput,
			commissionId: "acme-001",
		});
		expect(decodeIntervention(structured).commissionRef).not.toBe(
			decodeIntervention(plain).commissionRef,
		);
	});
});
