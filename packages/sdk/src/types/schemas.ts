import type { SponsorRef } from "../sponsor";
import type {
	CheckinActivityPayload,
	CheckoutActivityPayload,
	HealthcheckActivityPayload,
	ReportActivityPayload,
	ScheduleActivityPayload,
} from "./attestation";
import type {
	AreaType,
	InterventionType,
	MilestoneLevel,
} from "./enums";

export interface AreaRegistrationInput {
	areaId: string;
	latitude: number;
	longitude: number;
	areaType: AreaType;
	name: string;
	municipality: string;
	/**
	 * Content-addressable hash (IPFS CID / storage adapter hash) of a large
	 * boundary payload — polygon GeoJSON, photo bundle, etc. `null` if the
	 * organization has no boundary data for this area (encoded as ZERO_BYTES32).
	 */
	boundariesHash: string | null;
	/**
	 * Small inline JSON escape hatch for app-specific extras (surface area,
	 * access hours, institutional labels). Empty string for none. SHOULD stay
	 * under the 512-byte budget documented in spec §9.6; the SDK does not
	 * enforce it.
	 */
	metadata: string;
}

export interface InterventionInput {
	/** UID of the AreaRegistration attestation this intervention belongs to. Carried as the EAS `refUID` slot on the on-chain attestation, not encoded in schema data. */
	areaUID: string;
	interventionId: string;
	interventionType: InterventionType;
	executionDate: Date | bigint;
	/** Plain commissioning identifier, structured `SponsorRef`, or `null` for volunteer/unsponsored work. Hashed internally per spec §9.1; structured refs are canonicalized via `serializeSponsorRef` before hashing. */
	commissionId: string | SponsorRef | null;
	evidenceBundleHash: string;
}

export interface GardenerMilestoneInput {
	recipient: string;
	milestoneLevel: MilestoneLevel;
	totalInterventions: number;
	totalValidated: number;
	avgHealthImprovement: number;
	achievedAt: Date | bigint;
	evidenceRoot: string;
}

// --- Activity inputs (per-type convenience wrappers) ---

/**
 * Common EIP-712 envelope overrides applicable to every Activity input.
 * Callers signing at the moment of the event may omit `time`; callers
 * signing server-side on later upload MUST pass the device-recorded moment
 * so the envelope reflects the claim, not the upload time.
 */
export interface ActivityEnvelopeOverrides {
	/** Signer's claim of when the event happened (Unix seconds or `Date`). Written into the EIP-712 envelope's `message.time`. */
	time?: Date | bigint;
}

export interface ScheduleActivityInput extends ActivityEnvelopeOverrides {
	/** UID of the AreaRegistration. Included in the Activity's payload to preserve area linkage (the refUID slot holds the intervention scope hash). */
	areaUID: string;
	interventionId: string;
	interventionType: InterventionType;
	/** Crew lead wallet — becomes the EIP-712 envelope's `recipient`. Use `ZERO_ADDRESS` for unassigned schedules. */
	crewLead: string;
	crewSize: number;
	scheduledDate: Date | bigint;
	estimatedMinutes: number;
	description: string;
	/** Plain commissioning identifier, structured `SponsorRef`, or `null` for volunteer/unsponsored work. Hashed internally per spec §9.1 and stored in the schedule payload's `commissionRef`. */
	commissionId: string | SponsorRef | null;
}

export interface CheckinActivityInput extends ActivityEnvelopeOverrides {
	interventionId: string;
	latitude: number;
	longitude: number;
	photoCID: string;
}

export interface CheckoutActivityInput extends ActivityEnvelopeOverrides {
	interventionId: string;
	actualMinutes: number;
}

export interface ReportActivityInput extends ActivityEnvelopeOverrides {
	interventionId: string;
	tasksCompleted: string[];
	photosCID: string;
	notes: string;
}

export interface HealthcheckActivityInput extends ActivityEnvelopeOverrides {
	/** UID of the AreaRegistration. Healthchecks are area-scoped — the refUID slot holds this directly. */
	areaUID: string;
	/** 1-10, where 10 is best. */
	healthScore: number;
	photoCID: string;
	notes: string;
	/** App-specific extras. Omit for none. */
	metadata?: Record<string, unknown> | null;
}

// --- Low-level per-type payload-only inputs (for advanced callers) ---

/**
 * Low-level discriminated union for callers that want to sign an Activity
 * of any type through a single `signActivity` primitive. Most callers should
 * use the typed per-type wrappers above.
 */
export type ActivityPayloadInput =
	| { type: "schedule"; payload: ScheduleActivityPayload }
	| { type: "checkin"; payload: CheckinActivityPayload }
	| { type: "checkout"; payload: CheckoutActivityPayload }
	| { type: "report"; payload: ReportActivityPayload }
	| { type: "healthcheck"; payload: HealthcheckActivityPayload };
