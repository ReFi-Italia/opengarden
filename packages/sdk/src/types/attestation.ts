import type { VerificationCheck } from "../verification";
import type { AreaType, InterventionType, MilestoneLevel } from "./enums";

export interface Area {
	uid: string;
	areaId: string;
	latitude: number;
	longitude: number;
	areaType: AreaType;
	name: string;
	municipality: string;
	/** Content-addressable hash of the area's boundary payload (ZERO_BYTES32 if none). */
	boundariesHash: string;
	/** Inline JSON escape hatch for small extras (empty string if none). See spec §9.6. */
	metadata: string;
	attester: string;
	time: bigint;
}

export interface Intervention {
	uid: string;
	/** Sourced from the EAS `refUID` slot of the on-chain attestation, not from schema data. */
	areaUID: string;
	interventionId: string;
	interventionType: InterventionType;
	executionDate: bigint;
	commissionRef: string;
	evidenceBundleHash: string;
	attester: string;
	recipient: string;
	time: bigint;
}

export interface Milestone {
	uid: string;
	milestoneLevel: MilestoneLevel;
	totalInterventions: number;
	totalValidated: number;
	avgHealthImprovement: number;
	achievedAt: bigint;
	evidenceRoot: string;
	recipient: string;
	attester: string;
	time: bigint;
}

// --- Activity payload shapes (spec §3.2) ---

export interface ScheduleActivityPayload {
	interventionId: string;
	/** UID of the AreaRegistration this schedule belongs to. Carried in payload because the Activity's refUID slot holds the intervention scope hash. */
	areaUID: string;
	interventionType: InterventionType;
	/** Planned execution date, Unix seconds. */
	scheduledDate: number;
	/** Wall-clock duration in minutes including planned breaks (crew-level). `0` = unspecified. */
	plannedDuration: number;
	/** Planned task codes. Union of crew `report.tasksCompleted` is expected to cover this set. */
	tasksPlanned: string[];
	description: string;
	/** Bytes32 hash of commissioning entity ID (`hashIdentifier` from §9.1). `ZERO_BYTES32` = volunteer. */
	commissionRef: string;
	crewSize: number;
}

export interface CheckinActivityPayload {
	/** Microdegrees (int32) — GPS latitude at check-in. Optional. Both latitude and longitude MUST be present together or both absent. */
	latitude?: number;
	/** Microdegrees (int32) — GPS longitude at check-in. Optional. */
	longitude?: number;
}

export interface CheckoutActivityPayload {
	/** Microdegrees (int32) — GPS latitude at check-out. Optional. Both latitude and longitude MUST be present together or both absent. */
	latitude?: number;
	/** Microdegrees (int32) — GPS longitude at check-out. Optional. */
	longitude?: number;
}

export interface ReportActivityPayload {
	/** Per-gardener completed task codes. Empty array if none. */
	tasksCompleted: string[];
	/** Per-gardener active work time in minutes, excluding breaks. `0` if unreported. */
	reportedEffort: number;
	/** keccak256 bytes32 hex of the after-work evidence bytes (single file or canonical manifest per §9.2). `ZERO_BYTES32` if none. */
	mediaHash: string;
	notes: string;
}

export interface HealthcheckActivityPayload {
	/** 1-10 scale, 10 is best. */
	healthScore: number;
	/** keccak256 bytes32 hex of the condition-documentation bytes (single file or canonical manifest per §9.2). `ZERO_BYTES32` if none. */
	mediaHash: string;
	notes: string;
	/** App-specific extras (weather, annotations, seasonal context). Omit for none. SHOULD carry a `v` key for shape versioning. */
	metadata?: Record<string, unknown> | null;
}

// --- Decoded Activity shape (as returned by reads / stored in bundles) ---

interface BaseActivity {
	uid: string;
	/** Ethereum address of the wallet that signed this activity. Authoritative identity claim. */
	signer: string;
	/** Self-reported Unix seconds from the EIP-712 envelope's `message.time`. */
	claimedTimestamp: number;
	/** Authoritative on-chain block timestamp (Unix seconds). */
	onchainTimestamp: number;
	/** Full EIP-712 signed attestation, verbatim. See §5.2. */
	signedAttestation: Record<string, unknown>;
}

export type ScheduleActivity = BaseActivity & {
	type: "schedule";
	payload: ScheduleActivityPayload;
};

export type CheckinActivity = BaseActivity & {
	type: "checkin";
	payload: CheckinActivityPayload;
};

export type CheckoutActivity = BaseActivity & {
	type: "checkout";
	payload: CheckoutActivityPayload;
};

export type ReportActivity = BaseActivity & {
	type: "report";
	payload: ReportActivityPayload;
};

export type HealthcheckActivity = BaseActivity & {
	type: "healthcheck";
	payload: HealthcheckActivityPayload;
};

/** Lifecycle activities that appear inside an intervention evidence bundle (§5.2). */
export type LifecycleActivity =
	| ScheduleActivity
	| CheckinActivity
	| CheckoutActivity
	| ReportActivity;

/** Any activity type — lifecycle plus healthcheck. Healthcheck is area-scoped and does NOT appear in intervention bundles. */
export type Activity = LifecycleActivity | HealthcheckActivity;

export interface EvidenceBundleVerification {
	valid: boolean;
	/** Protocol tier — `keccak256(bundleBytes)` matches the on-chain `evidenceBundleHash`. Caller-supplied bytes are authentic for this Intervention. */
	bundleHashValid: boolean;
	/** Protocol tier — bundle version is understood. */
	bundleVersionValid: boolean;
	/** Protocol tier — every signed attestation's EIP-712 signature recovers to its claimed signer. */
	signaturesValid: boolean;
	/** Protocol tier — every activity's `payload` canonicalizes to the signed `payloadHash`. */
	payloadIntegrityValid: boolean;
	/** Protocol tier — bundle's on-chain timestamps match `EAS.getTimestamp`. */
	timestampsVerified: boolean;
	/** Policy tier — every lifecycle entry's `refUID` equals `keccak256(interventionId)`. */
	interventionScopeValid: boolean;
	/** Policy tier — strict `T_schedule < T_checkin < T_checkout < T_report` per crew signer. */
	temporalOrderValid: boolean;
	/** Policy tier — `executionDate` sits between schedule and publication timestamps. */
	executionDateBracketed: boolean;
	/** Flat per-check breakdown, in the order the SDK runs them. */
	checks: VerificationCheck[];
}

// --- Type guards ---

export function isScheduleActivity(a: Activity): a is ScheduleActivity {
	return a.type === "schedule";
}

export function isCheckinActivity(a: Activity): a is CheckinActivity {
	return a.type === "checkin";
}

export function isCheckoutActivity(a: Activity): a is CheckoutActivity {
	return a.type === "checkout";
}

export function isReportActivity(a: Activity): a is ReportActivity {
	return a.type === "report";
}

export function isHealthcheckActivity(a: Activity): a is HealthcheckActivity {
	return a.type === "healthcheck";
}
