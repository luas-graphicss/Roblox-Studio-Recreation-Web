import {
	MSM_COMPOSITE_MODE_INJECTION,
	MSM_COMPOSITE_MODE_SCREEN,
	MSM_RESOLUTION_DIVISORS,
	listPatchSlots,
} from "./msmPipelineContract.js";
import {
	MSM_UPSAMPLE_BILATERAL_TAP_COUNT,
	MSM_UPSAMPLE_BILINEAR_TAP_COUNT,
	MSM_UPSAMPLE_OWNER,
	MSM_UPSAMPLE_RELATIVE_DEPTH_TOLERANCE,
	MSM_UPSAMPLE_RUNGS,
} from "./msmUpsampleCore.js";
import { MSM_ACTIVE_TIERS, getMsmTierPolicy } from "./msmTierPolicy.js";


export const MSM_UPSAMPLE_TAP_LADDER = Object.freeze([
	MSM_UPSAMPLE_BILINEAR_TAP_COUNT,
	MSM_UPSAMPLE_BILATERAL_TAP_COUNT,
]);


export const MSM_UPSAMPLE_DEPTH_ALIGNED_DIVISOR = 2;


export const MSM_UPSAMPLE_BILINEAR_HARDWARE_FETCHES = 1;
export const MSM_UPSAMPLE_BILINEAR_DEPTH_FETCHES = 0;


export const MSM_UPSAMPLE_NEW_TEXTURE_UNITS = 0;


export function upsampleTapCountForDivisor(divisor) {
	const requestedDivisor = Math.floor(Number(divisor));
	return requestedDivisor === MSM_UPSAMPLE_DEPTH_ALIGNED_DIVISOR
		? MSM_UPSAMPLE_BILATERAL_TAP_COUNT
		: MSM_UPSAMPLE_BILINEAR_TAP_COUNT;
}


export function upsampleTapCountForTier(tier) {
	const policy = getMsmTierPolicy(tier);
	return policy ? upsampleTapCountForDivisor(policy.resolutionDivisor) : null;
}


export function upsampleRungForTapCount(tapCount) {
	return Math.floor(Number(tapCount)) === MSM_UPSAMPLE_BILATERAL_TAP_COUNT
		? MSM_UPSAMPLE_RUNGS.BILATERAL
		: MSM_UPSAMPLE_RUNGS.BILINEAR;
}


export function relativeDepthToleranceForTier(tier) {
	const tapCount = upsampleTapCountForTier(tier);
	if (tapCount === null) return null;
	return tapCount === MSM_UPSAMPLE_BILATERAL_TAP_COUNT ? MSM_UPSAMPLE_RELATIVE_DEPTH_TOLERANCE : 0;
}


export function hardwareFetchesPerPixel(tapCount) {
	return upsampleRungForTapCount(tapCount) === MSM_UPSAMPLE_RUNGS.BILATERAL
		? MSM_UPSAMPLE_BILATERAL_TAP_COUNT
		: MSM_UPSAMPLE_BILINEAR_HARDWARE_FETCHES;
}


export function depthFetchesPerPixel(tapCount) {
	return upsampleRungForTapCount(tapCount) === MSM_UPSAMPLE_RUNGS.BILATERAL
		? MSM_UPSAMPLE_BILATERAL_TAP_COUNT
		: MSM_UPSAMPLE_BILINEAR_DEPTH_FETCHES;
}


export function reducedTexelFootprint(verticalFieldOfViewDegrees, reducedHeight) {
	const fieldOfView = Number(verticalFieldOfViewDegrees);
	const height = Math.floor(Number(reducedHeight));
	if (!Number.isFinite(fieldOfView) || !Number.isFinite(height) || 1 > height) return 0;
	return (2 * Math.tan((fieldOfView * Math.PI) / 360)) / height;
}


export function acceptedSurfaceTiltDegrees(relativeDepthTolerance, texelFootprint) {
	const tolerance = Number(relativeDepthTolerance);
	const footprint = Number(texelFootprint);
	if (!Number.isFinite(tolerance) || !Number.isFinite(footprint) || !(footprint > 0)) return 0;
	return (Math.atan(tolerance / footprint) * 180) / Math.PI;
}











export function upsampleTapCeilingForCompositeMode(compositeMode) {
	const slots = listPatchSlots().filter((slot) => slot.compositeMode === compositeMode);
	if (slots.length === 0) return null;
	const spendsMaterialUnit = slots.some((slot) => slot.materialTextureUnitCost > 0);
	return spendsMaterialUnit ? MSM_UPSAMPLE_BILINEAR_TAP_COUNT : MSM_UPSAMPLE_BILATERAL_TAP_COUNT;
}


export function describeUpsampleBudget(tier) {
	const tapCount = upsampleTapCountForTier(tier);
	const normalizedTier = typeof tier === "string" ? tier.trim().toLowerCase() : "";

	if (tapCount === null) {
		return {
			owner: MSM_UPSAMPLE_OWNER,
			tier: normalizedTier,
			runs: false,
			rung: null,
			tapCount: 0,
			hardwareFetchesPerPixel: 0,
			depthFetchesPerPixel: 0,
			relativeDepthTolerance: null,
			newTextureUnits: MSM_UPSAMPLE_NEW_TEXTURE_UNITS,
			reason: "the MSM does not run on this tier, so there is no reduced buffer to resolve",
		};
	}

	const policy = getMsmTierPolicy(normalizedTier);
	const rung = upsampleRungForTapCount(tapCount);

	return {
		owner: MSM_UPSAMPLE_OWNER,
		tier: normalizedTier,
		runs: true,
		rung,
		tapCount,
		resolutionDivisor: policy.resolutionDivisor,
		hardwareFetchesPerPixel: hardwareFetchesPerPixel(tapCount),
		depthFetchesPerPixel: depthFetchesPerPixel(tapCount),
		relativeDepthTolerance: relativeDepthToleranceForTier(normalizedTier),
		newTextureUnits: MSM_UPSAMPLE_NEW_TEXTURE_UNITS,
		reason:
			rung === MSM_UPSAMPLE_RUNGS.BILATERAL
				? "divisor " +
					policy.resolutionDivisor +
					" lines the source grid up with the half resolution depth, so tier " +
					normalizedTier +
					" spends " +
					tapCount +
					" bilateral taps on every destination pixel"
				: "divisor " +
					policy.resolutionDivisor +
					" does not line the source grid up with the half resolution depth, so tier " +
					normalizedTier +
					" spends one bilinear fetch and inherits the halo",
	};
}


export function evaluateFlatCostAcceptance(measurements) {
	const rows = Array.isArray(measurements) ? measurements : [];
	const problems = [];

	if (2 > rows.length) {
		problems.push("a flat cost needs at least two pixels to compare, received " + rows.length);
	}

	const totals = rows.map((row) => Number(row.hardwareFetchCount) + Number(row.depthFetchCount));
	const minimum = totals.length > 0 ? Math.min(...totals) : 0;
	const maximum = totals.length > 0 ? Math.max(...totals) : 0;
	const mean = totals.length > 0 ? totals.reduce((sum, value) => sum + value, 0) / totals.length : 0;
	const variance =
		totals.length > 0
			? totals.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / totals.length
			: 0;

	if (variance !== 0) {
		const spread = rows
			.map((row, index) => (row.label || "pixel " + index) + " spent " + totals[index])
			.join("; ");
		problems.push(
			"fetches per destination pixel vary between " +
				minimum +
				" and " +
				maximum +
				" - a resolve whose cost depends on the pixel breaks gate G1 (" +
				spread +
				")",
		);
	}

	totals.forEach((total, index) => {
		if (!Number.isFinite(total) || 1 > total) {
			problems.push("row " + index + " did not report a usable fetch count");
		}
	});

	return { pass: problems.length === 0, pixelCount: rows.length, minimum, maximum, mean, variance, problems };
}


export function validateUpsampleTapBudget() {
	const problems = [];

	if (MSM_RESOLUTION_DIVISORS.indexOf(MSM_UPSAMPLE_DEPTH_ALIGNED_DIVISOR) === -1) {
		problems.push(
			"the pipeline contract no longer offers divisor " +
				MSM_UPSAMPLE_DEPTH_ALIGNED_DIVISOR +
				", the only one where the depth guide of the bilateral rung lines up",
		);
	}

	MSM_ACTIVE_TIERS.forEach((tier) => {
		const policy = getMsmTierPolicy(tier);
		const divisor = policy ? Math.floor(Number(policy.resolutionDivisor)) : NaN;
		if (!Number.isFinite(divisor)) {
			problems.push("tier " + tier + " declares no resolution divisor");
			return;
		}
		if (MSM_RESOLUTION_DIVISORS.indexOf(divisor) === -1) {
			problems.push("tier " + tier + " asks for divisor " + divisor + ", which the contract does not offer");
		}
		const tapCount = upsampleTapCountForTier(tier);
		if (MSM_UPSAMPLE_TAP_LADDER.indexOf(tapCount) === -1) {
			problems.push("tier " + tier + " resolves to " + tapCount + " taps, which is not a rung of the ladder");
		}
	});


	const bilinearTiers = MSM_ACTIVE_TIERS.filter(
		(tier) => upsampleTapCountForTier(tier) === MSM_UPSAMPLE_BILINEAR_TAP_COUNT,
	);
	if (bilinearTiers.length !== 1 || bilinearTiers[0] !== MSM_ACTIVE_TIERS[0]) {
		problems.push(
			"exactly one tier - the cheapest - may spend the bilinear rung, found [" + bilinearTiers.join(", ") + "]",
		);
	}


	MSM_ACTIVE_TIERS.forEach((tier, index) => {
		if (index === 0) return;
		const previousTapCount = upsampleTapCountForTier(MSM_ACTIVE_TIERS[index - 1]);
		if (previousTapCount > upsampleTapCountForTier(tier)) {
			problems.push("tier " + tier + " spends fewer taps than the cheaper tier before it");
		}
	});

	if (upsampleTapCeilingForCompositeMode(MSM_COMPOSITE_MODE_SCREEN) !== MSM_UPSAMPLE_BILATERAL_TAP_COUNT) {
		problems.push("mode A stopped affording the bilateral rung - check the material cost of its patch slot");
	}
	if (upsampleTapCeilingForCompositeMode(MSM_COMPOSITE_MODE_INJECTION) !== MSM_UPSAMPLE_BILINEAR_TAP_COUNT) {
		problems.push("mode B stopped being capped at the bilinear rung - the +1 texture unit of gate G10 moved");
	}

	return { ok: problems.length === 0, problems };
}
