import type {
	EvidenceBundleBuilderInput,
	TimestampedOffChainResult,
} from "@refi-italia/opengarden";
import type { Payload, PayloadRequest, TaskConfig } from "payload";

import {
	getOpenGardenContext,
	type OpenGardenContext,
} from "../lib/openGardenClient";
import { recordChainTransaction } from "../lib/recordChainTransaction";

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

			const checkinRow = await findOne(
				payload,
				"gardenerCheckins",
				{
					and: [
						{ intervention: { equals: intervention.id } },
						{ gardener: { equals: gardenerId } },
					],
				},
				req,
			);
			if (!checkinRow) {
				throw new Error(
					`No gardenerCheckins row for intervention ${intervention.id} / gardener ${gardenerId}.`,
				);
			}
			const checkoutRow = await findOne(
				payload,
				"gardenerCheckouts",
				{ checkin: { equals: checkinRow.id } },
				req,
			);
			if (!checkoutRow) {
				throw new Error(
					`No gardenerCheckouts row for checkin ${checkinRow.id}.`,
				);
			}
			const reportRow = await findOne(
				payload,
				"gardenerReports",
				{ checkout: { equals: checkoutRow.id } },
				req,
			);
			if (!reportRow) {
				throw new Error(
					`No gardenerReports row for checkout ${checkoutRow.id}.`,
				);
			}

			crewRows.push({
				gardenerId: String(gardenerId),
				attesterWallet: checkinRow.chain?.attesterWallet ?? "",
				checkinId: String(checkinRow.id),
				checkoutId: String(checkoutRow.id),
				reportId: String(reportRow.id),
				checkin: chainGroupToTimestampedResult(
					checkinRow.chain,
					`gardenerCheckins ${checkinRow.id}`,
				),
				checkout: chainGroupToTimestampedResult(
					checkoutRow.chain,
					`gardenerCheckouts ${checkoutRow.id}`,
				),
				report: chainGroupToTimestampedResult(
					reportRow.chain,
					`gardenerReports ${reportRow.id}`,
				),
			});
		}

		const healthcheckBeforeRow = await findOne(
			payload,
			"healthchecks",
			{
				and: [
					{ intervention: { equals: intervention.id } },
					{ kind: { equals: "before" } },
				],
			},
			req,
		);
		const healthcheckAfterRow = await findOne(
			payload,
			"healthchecks",
			{
				and: [
					{ intervention: { equals: intervention.id } },
					{ kind: { equals: "after" } },
				],
			},
			req,
		);

		const healthcheckBefore = healthcheckBeforeRow
			? {
					...chainGroupToTimestampedResult(
						healthcheckBeforeRow.chain,
						`healthchecks ${healthcheckBeforeRow.id}`,
					),
					score: healthcheckBeforeRow.healthScore as number,
				}
			: undefined;
		const healthcheckAfter = healthcheckAfterRow
			? {
					...chainGroupToTimestampedResult(
						healthcheckAfterRow.chain,
						`healthchecks ${healthcheckAfterRow.id}`,
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

			await recordChainTransaction({
				payload,
				req,
				kind: "buildBundle",
				relatedCollection: "evidenceBundles",
				relatedId: bundleId,
				status: "success",
				chainId: context.chainId,
				attesterWallet: context.attesterWallet,
				payloadJson: { interventionId: intervention.id, offchainCount },
				resultJson: { evidenceBundleHash, offchainCount },
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

			await recordChainTransaction({
				payload,
				req,
				kind: "buildBundle",
				relatedCollection: "evidenceBundles",
				relatedId: bundleId,
				status: "failed",
				error: message,
				chainId: context?.chainId,
				attesterWallet: context?.attesterWallet,
				payloadJson: { interventionId: intervention.id },
			}).catch(() => undefined);

			throw err;
		}
	},
};

/**
 * Rehydrates a `TimestampedOffChainResult` from a Payload `chain` group
 * populated by an upstream task. Throws with an actionable message if
 * any required mirror field is missing.
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

async function findOne<T extends string>(
	payload: Payload,
	collection: T,
	// biome-ignore lint/suspicious/noExplicitAny: payload where types are per-collection
	where: any,
	req: PayloadRequest,
	// biome-ignore lint/suspicious/noExplicitAny: row shape varies per collection
): Promise<any | null> {
	const result = await payload.find({
		// biome-ignore lint/suspicious/noExplicitAny: generic helper
		collection: collection as any,
		where,
		limit: 1,
		depth: 1,
		req,
		overrideAccess: true,
	});
	return result.docs[0] ?? null;
}
