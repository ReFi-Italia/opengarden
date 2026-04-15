import type {
	EvidenceBundleBuilderInput,
	TimestampedOffChainResult,
} from "@refi-italia/opengarden";
import type { TaskConfig } from "payload";

import {
	getOpenGardenContext,
	type OpenGardenContext,
} from "../lib/openGardenClient";

type BuildBundleInput = {
	/** Payload document id of the `evidenceBundles` row to build. */
	bundleId: string;
};

type BuildBundleOutput = {
	evidenceBundleHash: string;
	attestationCount: number;
};

/**
 * Task that drives an `evidenceBundles` row from `draft` →
 * `built` → `uploaded` by rehydrating every off-chain attestation
 * from its parent collection's `chain.*` mirror, calling
 * `OpenGardenClient.buildEvidenceBundle`, uploading the resulting
 * JSON via the configured storage adapter, and snapshotting the
 * bundle hash + metadata onto the row.
 *
 * Preconditions (upstream tasks must have populated):
 * - `intervention.scheduling.chain.*` (scheduleIntervention)
 * - `intervention.validation.chain.*` (validateIntervention)
 * - One `gardenerCheckins`, `gardenerCheckouts`, `gardenerReports`
 *   row per crew member, each with `chain.*` populated by their
 *   respective (not-yet-implemented) task handlers
 * - Optionally 0/1/2 `healthchecks` rows with `intervention: X,
 *   kind: 'before' | 'after'`, each with `chain.*` populated
 */
export const buildBundleTask: TaskConfig<{
	input: BuildBundleInput;
	output: BuildBundleOutput;
}> = {
	slug: "buildBundle",
	label: "Build Evidence Bundle",
	retries: {
		attempts: 3,
		backoff: { type: "exponential", delay: 5_000 },
	},
	inputSchema: [
		{
			name: "bundleId",
			type: "text",
			required: true,
		},
	],
	outputSchema: [
		{ name: "evidenceBundleHash", type: "text", required: true },
		{ name: "attestationCount", type: "number", required: true },
	],
	handler: async ({ input, req }) => {
		const { payload } = req;
		const { bundleId } = input;

		const bundle = await payload.findByID({
			collection: "evidenceBundles",
			id: bundleId,
			depth: 2,
			req,
			overrideAccess: true,
		});

		if (
			(bundle.bundleState === "built" || bundle.bundleState === "uploaded") &&
			bundle.evidenceBundleHash
		) {
			return {
				output: {
					evidenceBundleHash: bundle.evidenceBundleHash,
					attestationCount: Array.isArray(bundle.crewMembers)
						? bundle.crewMembers.length * 3 + 2
						: 0,
				},
			};
		}

		if (bundle.bundleState !== "draft") {
			throw new Error(
				`Bundle ${bundleId} is in bundleState="${bundle.bundleState}"; expected "draft".`,
			);
		}

		const intervention = bundle.intervention;
		if (typeof intervention !== "object" || intervention === null) {
			throw new Error(
				`Bundle ${bundleId} → intervention could not be resolved; re-load with depth.`,
			);
		}

		const area = intervention.area;
		const areaUID =
			typeof area === "object" && area !== null && area.chain?.chainUID
				? area.chain.chainUID
				: null;
		if (!areaUID) {
			throw new Error(
				`Bundle ${bundleId} → intervention.area has no on-chain UID.`,
			);
		}

		const scheduled = chainGroupToTimestampedResult(
			intervention.scheduling,
			`intervention ${intervention.id} scheduling`,
		);
		const validationBase = chainGroupToTimestampedResult(
			intervention.validation,
			`intervention ${intervention.id} validation`,
		);
		if (typeof intervention.validation?.approved !== "boolean") {
			throw new Error(
				`Intervention ${intervention.id} is missing validation.approved.`,
			);
		}
		if (typeof intervention.validation?.qualityScore !== "number") {
			throw new Error(
				`Intervention ${intervention.id} is missing validation.qualityScore.`,
			);
		}
		const validation = {
			...validationBase,
			approved: intervention.validation.approved,
			qualityScore: intervention.validation.qualityScore,
		};

		const crew = Array.isArray(intervention.crew) ? intervention.crew : [];
		if (crew.length === 0) {
			throw new Error(`Intervention ${intervention.id} has an empty crew.`);
		}

		// Read all activities for this intervention in one query, depth=3
		// so the attestation relationship is populated with the signed
		// off-chain payload each row needs.
		const activitiesResult = await payload.find({
			collection: "activities",
			where: { intervention: { equals: intervention.id } },
			limit: 200,
			depth: 3,
			req,
			overrideAccess: true,
		});
		const activities = activitiesResult.docs;

		// Partition by type
		// biome-ignore lint/suspicious/noExplicitAny: activities rows are Payload-typed per field
		const checkins = activities.filter((a: any) => a.type === "checkin");
		// biome-ignore lint/suspicious/noExplicitAny: same
		const checkouts = activities.filter((a: any) => a.type === "checkout");
		// biome-ignore lint/suspicious/noExplicitAny: same
		const reports = activities.filter((a: any) => a.type === "report");
		// biome-ignore lint/suspicious/noExplicitAny: same
		const interventionHcs = activities.filter(
			// biome-ignore lint/suspicious/noExplicitAny: same
			(a: any) => a.type === "interventionHealthcheck",
		);

		const crewRows: Array<{
			gardenerId: string;
			attesterWallet: string;
			checkinId: string;
			checkoutId: string;
			reportId: string;
			checkin: TimestampedOffChainResult;
			checkout: TimestampedOffChainResult;
			report: TimestampedOffChainResult;
		}> = [];

		for (const row of crew) {
			const gardener = row?.gardener;
			if (typeof gardener !== "object" || gardener === null || !gardener.id) {
				throw new Error(
					`Bundle ${bundleId} → a crew row has no gardener id; re-save the intervention.`,
				);
			}
			const gardenerId = gardener.id;

			// biome-ignore lint/suspicious/noExplicitAny: activities rows are Payload-typed
			const checkinActivity = checkins.find((a: any) => {
				const g = a.gardener;
				if (!g) return false;
				if (typeof g === "object" && g !== null) return g.id === gardenerId;
				return g === gardenerId;
			});
			if (!checkinActivity) {
				throw new Error(
					`No checkin activity for intervention ${intervention.id} / gardener ${gardenerId}.`,
				);
			}

			// biome-ignore lint/suspicious/noExplicitAny: parentActivity is Payload-populated at depth 3
			const checkoutActivity = checkouts.find((a: any) => {
				const p = a.parentActivity;
				if (!p) return false;
				if (typeof p === "object" && p !== null) return p.id === checkinActivity.id;
				return p === checkinActivity.id;
			});
			if (!checkoutActivity) {
				throw new Error(
					`No checkout activity for checkin ${checkinActivity.id}.`,
				);
			}

			// biome-ignore lint/suspicious/noExplicitAny: parentActivity is Payload-populated at depth 3
			const reportActivity = reports.find((a: any) => {
				const p = a.parentActivity;
				if (!p) return false;
				if (typeof p === "object" && p !== null) return p.id === checkoutActivity.id;
				return p === checkoutActivity.id;
			});
			if (!reportActivity) {
				throw new Error(
					`No report activity for checkout ${checkoutActivity.id}.`,
				);
			}

			crewRows.push({
				gardenerId: String(gardenerId),
				attesterWallet:
					attestationAttesterWallet(checkinActivity) ?? "",
				checkinId: String(checkinActivity.id),
				checkoutId: String(checkoutActivity.id),
				reportId: String(reportActivity.id),
				checkin: attestationToTimestampedResult(
					checkinActivity,
					`checkin activity ${checkinActivity.id}`,
				),
				checkout: attestationToTimestampedResult(
					checkoutActivity,
					`checkout activity ${checkoutActivity.id}`,
				),
				report: attestationToTimestampedResult(
					reportActivity,
					`report activity ${reportActivity.id}`,
				),
			});
		}

		// biome-ignore lint/suspicious/noExplicitAny: same
		const healthcheckBeforeRow = interventionHcs.find(
			// biome-ignore lint/suspicious/noExplicitAny: same
			(a: any) => a.kind === "before",
		);
		// biome-ignore lint/suspicious/noExplicitAny: same
		const healthcheckAfterRow = interventionHcs.find(
			// biome-ignore lint/suspicious/noExplicitAny: same
			(a: any) => a.kind === "after",
		);

		const healthcheckBefore = healthcheckBeforeRow
			? {
					...attestationToTimestampedResult(
						healthcheckBeforeRow,
						`healthcheck-before activity ${healthcheckBeforeRow.id}`,
					),
					score: healthcheckBeforeRow.healthScore as number,
				}
			: undefined;
		const healthcheckAfter = healthcheckAfterRow
			? {
					...attestationToTimestampedResult(
						healthcheckAfterRow,
						`healthcheck-after activity ${healthcheckAfterRow.id}`,
					),
					score: healthcheckAfterRow.healthScore as number,
				}
			: undefined;

		const builderInput: EvidenceBundleBuilderInput = {
			interventionId: intervention.interventionId,
			areaUID,
			scheduled,
			crew: crewRows.map((r) => ({
				checkin: r.checkin,
				checkout: r.checkout,
				report: r.report,
			})),
			validation,
			healthcheckBefore,
			healthcheckAfter,
		};

		const offchainCount =
			2 +
			3 * crewRows.length +
			(healthcheckBefore ? 1 : 0) +
			(healthcheckAfter ? 1 : 0);

		let context: OpenGardenContext | null = null;
		try {
			context = await getOpenGardenContext(payload);
			const builtBundle = context.client.buildEvidenceBundle(builderInput);
			const evidenceBundleHash =
				await context.client.uploadEvidenceBundle(builtBundle);

			await payload.update({
				collection: "evidenceBundles",
				id: bundleId,
				data: {
					bundleState: "built",
					bundleJson: builtBundle as unknown as Record<string, unknown>,
					bundleVersion: builtBundle.bundleVersion,
					evidenceBundleHash,
					interventionIdSnapshot: intervention.interventionId,
					areaUIDSnapshot: areaUID,
					scheduledRef: scheduled.uid,
					crewMembers: crewRows.map((r) => ({
						gardener: r.gardenerId,
						attesterWallet: r.attesterWallet,
						checkin: r.checkinId,
						checkout: r.checkoutId,
						report: r.reportId,
					})),
					validationRef:
						typeof intervention.validation?.currentAttestation === "object" &&
						intervention.validation.currentAttestation !== null
							? intervention.validation.currentAttestation.id
							: intervention.validation?.currentAttestation,
					healthcheckBefore: healthcheckBeforeRow?.id,
					healthcheckAfter: healthcheckAfterRow?.id,
					buildIssuesJson: [],
				},
				overrideAccess: true,
				context: { skipLifecycleHooks: true },
				req,
			});

			await payload.update({
				collection: "evidenceBundles",
				id: bundleId,
				data: { bundleState: "uploaded" },
				overrideAccess: true,
				context: { skipLifecycleHooks: true },
				req,
			});

			// Snapshot offchainCount onto the intervention for the publish step.
			await payload.update({
				collection: "interventions",
				id: intervention.id,
				data: {
					execution: { offchainCount },
				},
				overrideAccess: true,
				context: { skipLifecycleHooks: true },
				req,
			});

			return {
				output: {
					evidenceBundleHash,
					attestationCount: offchainCount,
				},
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);

			await payload
				.update({
					collection: "evidenceBundles",
					id: bundleId,
					data: {
						bundleState: "failed",
						lastError: message,
					},
					overrideAccess: true,
					context: { skipLifecycleHooks: true },
					req,
				})
				.catch(() => undefined);

			payload.logger.error({
				msg: `buildBundle task failed for bundle ${bundleId}`,
				error: message,
			});

			throw err;
		}
	},
};

/**
 * Rehydrates a `TimestampedOffChainResult` from a Payload `chain` group
 * populated by an upstream task. Still used by intervention scheduling /
 * validation / execution groups pending the chain-mirror → Attestations
 * migration (see project memory).
 */
function chainGroupToTimestampedResult(
	// biome-ignore lint/suspicious/noExplicitAny: chain group is Payload-typed at each call site
	chain: any,
	context: string,
): TimestampedOffChainResult {
	if (!chain?.chainUID) {
		throw new Error(`${context} is missing chain.chainUID.`);
	}
	if (!chain.txHash) {
		throw new Error(`${context} is missing chain.txHash.`);
	}
	if (typeof chain.onchainTimestamp !== "number") {
		throw new Error(`${context} is missing chain.onchainTimestamp.`);
	}
	if (!chain.signedAttestation) {
		throw new Error(`${context} is missing chain.signedAttestation.`);
	}
	return {
		uid: chain.chainUID,
		signedAttestation: chain.signedAttestation as Record<string, unknown>,
		timestampTxHash: chain.txHash,
		onchainTimestamp: BigInt(chain.onchainTimestamp),
		// biome-ignore lint/suspicious/noExplicitAny: receipt isn't persisted on the row
		timestampReceipt: undefined as any,
	};
}

/**
 * Rehydrates a `TimestampedOffChainResult` from an activity row whose
 * `attestation` relationship has been populated (via depth=2+). Throws
 * if the activity has no committed attestation yet.
 */
function attestationToTimestampedResult(
	// biome-ignore lint/suspicious/noExplicitAny: activity row shape is generic
	activity: any,
	context: string,
): TimestampedOffChainResult {
	const att = activity?.attestation;
	if (!att || typeof att !== "object") {
		throw new Error(`${context} has no attestation relationship populated.`);
	}
	if (att.status !== "committed") {
		throw new Error(
			`${context} attestation is in status "${att.status}" — expected "committed".`,
		);
	}
	if (!att.uid) {
		throw new Error(`${context} attestation has no uid.`);
	}
	if (!att.signedAttestation) {
		throw new Error(`${context} attestation has no signedAttestation.`);
	}
	if (typeof att.onchainTimestamp !== "number") {
		throw new Error(`${context} attestation has no onchainTimestamp.`);
	}
	return {
		uid: att.uid,
		signedAttestation: att.signedAttestation as Record<string, unknown>,
		timestampTxHash: att.timestampTxHash,
		onchainTimestamp: BigInt(att.onchainTimestamp),
		// biome-ignore lint/suspicious/noExplicitAny: receipt isn't persisted
		timestampReceipt: undefined as any,
	};
}

function attestationAttesterWallet(
	// biome-ignore lint/suspicious/noExplicitAny: activity row shape is generic
	activity: any,
): string | undefined {
	const att = activity?.attestation;
	if (!att || typeof att !== "object") return undefined;
	return att.attesterWallet;
}
