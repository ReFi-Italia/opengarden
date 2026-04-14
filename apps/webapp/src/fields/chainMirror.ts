import type { Field } from "payload";

/**
 * Returns the fixed set of plain-named subfields that mirror a single
 * on-chain/off-chain attestation onto a Payload row. The factory is meant to
 * be spread into a parent `group` (or array item) field — the parent group
 * supplies the namespace, so the same subfield names (`chainUID`, `txHash`,
 * etc.) can coexist on one row under different group names (e.g.
 * `interventions.scheduling.chainUID` vs `interventions.validation.chainUID`).
 *
 * All subfields are read-only in the admin UI — they are populated by server
 * action handlers that call the SDK, never by form writes.
 */
export const chainMirror = (): Field[] => [
	{
		name: "chainUID",
		type: "text",
		label: "Attestation ID",
		admin: { readOnly: true },
		index: true,
	},
	{
		name: "txHash",
		type: "text",
		label: "Transaction",
		admin: { readOnly: true },
	},
	{
		name: "onchainTimestamp",
		type: "number",
		label: "Timestamp",
		admin: { readOnly: true },
	},
	{
		name: "attesterWallet",
		type: "text",
		label: "Signer",
		admin: { readOnly: true },
	},
	{
		name: "chainIdSnapshot",
		type: "number",
		label: "Chain ID",
		admin: { readOnly: true },
	},
	{
		name: "signedAttestation",
		type: "json",
		label: "Signed data",
		admin: { readOnly: true },
	},
];
