import { MSM_RESOLUTION_DIVISORS } from "./msmPipelineContract.js";
import { MSM_SPATIAL_FILTER, getMsmTierPolicy } from "./msmTierPolicy.js";
import { clampScreenTraceStepCount, sellScreenTraceStepCount } from "./msmScreenTraceBudgetCore.js";
import { MSM_FAR_LIST_CAPACITY, MSM_FAR_LIST_SLEEP_REASON, MSM_FAR_LIST_TIERS } from "./msmFarListCore.js";
import { MSM_PROXY_LADDER_RUNG_REQUEST, decideMsmProxyOcclusion } from "./msmProxyVetoPolicyCore.js";
import { MSM_LADDER_RUNG, clampMsmSoldRungCount, msmLadderLength, msmSoldRungIds } from "./msmLadderCore.js";

export const MSM_LADDER_SETTINGS_OWNER = "MSM-F31";


export const MSM_LADDER_COARSEST_DIVISOR = MSM_RESOLUTION_DIVISORS[MSM_RESOLUTION_DIVISORS.length - 1];


export const MSM_LADDER_ATLAS_PAGES_FLOOR = 1;


export const MSM_SPATIAL_FILTER_COST_RANK = Object.freeze({
	[MSM_SPATIAL_FILTER.OFF]: 0,
	[MSM_SPATIAL_FILTER.GATED]: 1,
	[MSM_SPATIAL_FILTER.ON]: 2,
});

function readTierText(value) {
	return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function farListCapacityForTier(tier) {
	return MSM_FAR_LIST_TIERS.indexOf(tier) === -1 ? 0 : MSM_FAR_LIST_CAPACITY;
}

function buildSleepingSettings(tier, soldRungCount, soldRungIds, reason) {
	return Object.freeze({
		owner: MSM_LADDER_SETTINGS_OWNER,
		tier,
		runs: false,
		isMsmEnabled: false,
		soldRungCount,
		soldRungIds,
		soldWithoutEffectRungIds: Object.freeze([]),
		budgetMs: 0,
		spatialFilter: MSM_SPATIAL_FILTER.OFF,
		samplesPerPixel: 0,
		screenTraceSteps: 0,
		resolutionDivisor: 0,
		atlasPagesPerFrame: 0,
		farListCapacity: 0,
		farListSleepReason: MSM_FAR_LIST_SLEEP_REASON.MSM_ASLEEP_ON_TIER,
		runsProxyOcclusion: false,
		proxyVetoReason: decideMsmProxyOcclusion({ tier }).vetoReason,
		reason,
	});
}


export function resolveMsmLadderSettings(request) {
	const source = request && typeof request === "object" ? request : {};
	const tier = readTierText(source.tier);
	const soldRungCount = clampMsmSoldRungCount(source.soldRungCount);
	const soldRungIds = msmSoldRungIds(soldRungCount);
	const isSold = (rungId) => soldRungIds.indexOf(rungId) !== -1;

	const policy = getMsmTierPolicy(tier);
	if (!policy) {
		return buildSleepingSettings(
			tier,
			soldRungCount,
			soldRungIds,
			"the MSM does not run on this tier, so the ladder has nothing to sell",
		);
	}

	if (isSold(MSM_LADDER_RUNG.MSM_OFF)) {
		return buildSleepingSettings(
			tier,
			soldRungCount,
			soldRungIds,
			"rung " + MSM_LADDER_RUNG.MSM_OFF + " sold: the engine goes back to today, byte for byte",
		);
	}

	const spatialFilterSold = isSold(MSM_LADDER_RUNG.SPATIAL_FILTER_OFF);
	const spatialFilter = spatialFilterSold ? MSM_SPATIAL_FILTER.OFF : policy.spatialFilter;

	const samplesPerPixelSold = isSold(MSM_LADDER_RUNG.SAMPLES_PER_PIXEL_TO_ONE);
	const samplesPerPixel = samplesPerPixelSold && policy.samplesPerPixel > 1 ? 1 : policy.samplesPerPixel;

	const screenTraceStepsSold = isSold(MSM_LADDER_RUNG.SCREEN_TRACE_STEPS_DOWN);
	const screenTraceSteps = screenTraceStepsSold
		? sellScreenTraceStepCount(policy.screenTraceSteps)
		: clampScreenTraceStepCount(policy.screenTraceSteps);

	const resolutionDivisorSold = isSold(MSM_LADDER_RUNG.RESOLUTION_DIVISOR_UP);
	const resolutionDivisor =
		resolutionDivisorSold && MSM_LADDER_COARSEST_DIVISOR > policy.resolutionDivisor
			? MSM_LADDER_COARSEST_DIVISOR
			: policy.resolutionDivisor;

	const atlasPagesSold = isSold(MSM_LADDER_RUNG.ATLAS_PAGES_DOWN);
	const atlasPagesPerFrame =
		atlasPagesSold && policy.atlasPagesPerFrame > MSM_LADDER_ATLAS_PAGES_FLOOR
			? policy.atlasPagesPerFrame - 1
			: policy.atlasPagesPerFrame;

	const farListSold = isSold(MSM_LADDER_RUNG.FAR_LIST_OFF);
	const tierFarListCapacity = farListCapacityForTier(tier);
	const farListCapacity = farListSold ? 0 : tierFarListCapacity;
	const farListSleepReason = farListSold
		? MSM_FAR_LIST_SLEEP_REASON.SOLD_BY_GOVERNOR
		: tierFarListCapacity > 0
			? ""
			: MSM_FAR_LIST_SLEEP_REASON.TIER_WITHOUT_FAR_LIST;



	const proxyRequest = { tier };
	proxyRequest[MSM_PROXY_LADDER_RUNG_REQUEST.soldFlagName] = isSold(MSM_LADDER_RUNG.PROXY_OCCLUSION_OFF);
	const proxyDecision = decideMsmProxyOcclusion(proxyRequest);
	const proxySold = isSold(MSM_LADDER_RUNG.PROXY_OCCLUSION_OFF);
	const proxyRunsWithoutTheRung = decideMsmProxyOcclusion({ tier }).runsProxyOcclusion;


	const soldWithoutEffectRungIds = [];
	if (spatialFilterSold && policy.spatialFilter === MSM_SPATIAL_FILTER.OFF) {
		soldWithoutEffectRungIds.push(MSM_LADDER_RUNG.SPATIAL_FILTER_OFF);
	}
	if (samplesPerPixelSold && samplesPerPixel === policy.samplesPerPixel) {
		soldWithoutEffectRungIds.push(MSM_LADDER_RUNG.SAMPLES_PER_PIXEL_TO_ONE);
	}
	if (screenTraceStepsSold && screenTraceSteps === clampScreenTraceStepCount(policy.screenTraceSteps)) {
		soldWithoutEffectRungIds.push(MSM_LADDER_RUNG.SCREEN_TRACE_STEPS_DOWN);
	}
	if (resolutionDivisorSold && resolutionDivisor === policy.resolutionDivisor) {
		soldWithoutEffectRungIds.push(MSM_LADDER_RUNG.RESOLUTION_DIVISOR_UP);
	}
	if (atlasPagesSold && atlasPagesPerFrame === policy.atlasPagesPerFrame) {
		soldWithoutEffectRungIds.push(MSM_LADDER_RUNG.ATLAS_PAGES_DOWN);
	}
	if (proxySold && !proxyRunsWithoutTheRung) {
		soldWithoutEffectRungIds.push(MSM_LADDER_RUNG.PROXY_OCCLUSION_OFF);
	}
	if (farListSold && tierFarListCapacity === 0) {
		soldWithoutEffectRungIds.push(MSM_LADDER_RUNG.FAR_LIST_OFF);
	}

	return Object.freeze({
		owner: MSM_LADDER_SETTINGS_OWNER,
		tier,
		runs: true,
		isMsmEnabled: true,
		soldRungCount,
		soldRungIds,
		soldWithoutEffectRungIds: Object.freeze(soldWithoutEffectRungIds),
		budgetMs: policy.budgetMs,
		spatialFilter,
		samplesPerPixel,
		screenTraceSteps,
		resolutionDivisor,
		atlasPagesPerFrame,
		farListCapacity,
		farListSleepReason,
		runsProxyOcclusion: proxyDecision.runsProxyOcclusion,
		proxyVetoReason: proxyDecision.vetoReason,
		reason:
			soldRungCount === 0
				? "tier " + tier + " runs the full table 5.3, nothing sold"
				: "tier " + tier + " runs with " + soldRungCount + " rung(s) sold by the governor",
	});
}

function spatialFilterCostRank(spatialFilter) {
	const rank = MSM_SPATIAL_FILTER_COST_RANK[spatialFilter];
	return Number.isFinite(rank) ? rank : 0;
}


export function validateMsmLadderSettings(tiers) {
	const problems = [];
	const tierList = Array.isArray(tiers) && tiers.length > 0 ? tiers : ["micro", "lite", "low", "medium"];
	const ladderLength = msmLadderLength();

	tierList.forEach((tier) => {
		for (let soldRungCount = 0; ladderLength > soldRungCount; soldRungCount += 1) {
			const before = resolveMsmLadderSettings({ tier, soldRungCount });
			const after = resolveMsmLadderSettings({ tier, soldRungCount: soldRungCount + 1 });
			const step = "tier " + tier + " selling rung " + (soldRungCount + 1);

			if (spatialFilterCostRank(after.spatialFilter) > spatialFilterCostRank(before.spatialFilter)) {
				problems.push(step + " raised the spatial filter");
			}
			if (after.samplesPerPixel > before.samplesPerPixel) problems.push(step + " raised the samples per pixel");
			if (after.screenTraceSteps > before.screenTraceSteps) problems.push(step + " raised the screen trace steps");
			if (before.resolutionDivisor > after.resolutionDivisor) problems.push(step + " lowered the resolution divisor");
			if (after.atlasPagesPerFrame > before.atlasPagesPerFrame) problems.push(step + " raised the atlas pages per frame");
			if (after.farListCapacity > before.farListCapacity) problems.push(step + " raised the far list capacity");
			if (after.runsProxyOcclusion && !before.runsProxyOcclusion) problems.push(step + " woke the proxy occlusion up");
			if (after.isMsmEnabled && !before.isMsmEnabled) problems.push(step + " woke the MSM up");
		}

		const exhausted = resolveMsmLadderSettings({ tier, soldRungCount: ladderLength });
		if (exhausted.isMsmEnabled) problems.push("tier " + tier + " still runs the MSM with the whole ladder sold");
	});

	return { ok: problems.length === 0, problems };
}
