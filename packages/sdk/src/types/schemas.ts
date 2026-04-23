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
	 * Canonical boundary blob (polygon GeoJSON plus any inline attributes the
	 * publisher chooses to cover with the signature). The SDK hashes this via
	 * §9.8 canonical JSON and commits only the keccak256 on-chain as
	 * `boundariesHash`. `null` for areas without boundary data (encoded as
	 * ZERO_BYTES32).
	 */
	boundary: Record<string, unknown> | null;
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
	/** Wall-clock duration of the intervention in minutes, including planned breaks (crew-level). `0` = unspecified. */
	plannedDuration: number;
	/** Planned task codes the crew as a whole is expected to cover. Verifier policy compares this against the union of `report.tasksCompleted` across crew. */
	tasksPlanned: string[];
	/** Free-text supplement to `tasksPlanned`. */
	description: string;
	/** Plain commissioning identifier, structured `SponsorRef`, or `null` for volunteer/unsponsored work. Hashed internally per spec §9.1 and stored in the schedule payload's `commissionRef`. */
	commissionId: string | SponsorRef | null;
}

export interface CheckinActivityInput extends ActivityEnvelopeOverrides {
	interventionId: string;
	/** GPS latitude at check-in. Optional — omit when area-boundary membership is sufficient. Both `latitude` and `longitude` MUST be omitted together or both present. */
	latitude?: number;
	/** GPS longitude at check-in. Optional — see `latitude`. */
	longitude?: number;
}

export interface CheckoutActivityInput extends ActivityEnvelopeOverrides {
	interventionId: string;
	/** GPS latitude at check-out. Optional — symmetric with `checkin`. Both `latitude` and `longitude` MUST be omitted together or both present. */
	latitude?: number;
	/** GPS longitude at check-out. Optional — see `latitude`. */
	longitude?: number;
}

export interface ReportActivityInput extends ActivityEnvelopeOverrides {
	interventionId: string;
	/** Per-gardener completed task codes — a subset (or all) of `schedule.tasksPlanned`. */
	tasksCompleted: string[];
	/** Per-gardener active work time in minutes, excluding breaks. Drives person-minute impact aggregation. `0` if unreported. */
	reportedEffort: number;
	/** keccak256 of the after-work evidence — a single file's raw bytes or the canonical media manifest JSON bytes (spec §9.2). 0x-prefixed bytes32 hex. `ZERO_BYTES32` if none. */
	mediaHash: string;
	notes: string;
}

export interface HealthcheckActivityInput extends ActivityEnvelopeOverrides {
	/** UID of the AreaRegistration. Healthchecks are area-scoped — the refUID slot holds this directly. */
	areaUID: string;
	/** 1-10, where 10 is best. */
	healthScore: number;
	/** keccak256 of the condition-documentation bytes — a single file or canonical media manifest (spec §9.2). 0x-prefixed bytes32 hex. `ZERO_BYTES32` if none. */
	mediaHash: string;
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
