import { MSM_ACTIVE_TIERS, getMsmTierPolicy } from "./msmTierPolicy.js";

export const MSM_SCREEN_TRACE_OWNER = "MSM-F18";


export const MSM_SCREEN_TRACE_STEP_FLOOR = 3;
export const MSM_SCREEN_TRACE_STEP_CEILING = 8;


export const MSM_SCREEN_TRACE_LADDER_STEP_DECREMENT = 2;


export const MSM_SCREEN_TRACE_DEPTH_TAPS_PER_STEP = 1;
export const MSM_SCREEN_TRACE_NEW_TEXTURE_UNITS = 0;


export function clampScreenTraceStepCount(value) {
	const stepCount = Math.floor(Number(value));
	if (!Number.isFinite(stepCount)) return MSM_SCREEN_TRACE_STEP_FLOOR;
	if (MSM_SCREEN_TRACE_STEP_FLOOR > stepCount) return MSM_SCREEN_TRACE_STEP_FLOOR;
	if (stepCount > MSM_SCREEN_TRACE_STEP_CEILING) return MSM_SCREEN_TRACE_STEP_CEILING;
	return stepCount;
}


export function screenTraceStepsForTier(tier) {
	const policy = getMsmTierPolicy(tier);
	return policy ? clampScreenTraceStepCount(policy.screenTraceSteps) : null;
}


export function sellScreenTraceStepCount(currentStepCount) {
	const stepCount = clampScreenTraceStepCount(currentStepCount);
	return clampScreenTraceStepCount(stepCount - MSM_SCREEN_TRACE_LADDER_STEP_DECREMENT);
}


export function buyBackScreenTraceStepCount(currentStepCount, tier) {
	const stepCount = clampScreenTraceStepCount(currentStepCount);
	const tierStepCount = screenTraceStepsForTier(tier);
	if (tierStepCount === null) return stepCount;
	const raised = stepCount + MSM_SCREEN_TRACE_LADDER_STEP_DECREMENT;
	return clampScreenTraceStepCount(tierStepCount > raised ? raised : tierStepCount);
}


export function depthTapsPerPixel(stepCount) {
	return clampScreenTraceStepCount(stepCount) * MSM_SCREEN_TRACE_DEPTH_TAPS_PER_STEP;
}


export function evaluateFixedCostAcceptance(measurements) {
	const rows = Array.isArray(measurements) ? measurements : [];
	const problems = [];

	if (rows.length < 2) {
		problems.push("a flat cost needs at least two pixels to compare, received " + rows.length);
	}

	const tapCounts = rows.map((row) => Number(row.depthTapCount));
	const minimum = tapCounts.length > 0 ? Math.min(...tapCounts) : 0;
	const maximum = tapCounts.length > 0 ? Math.max(...tapCounts) : 0;
	const mean = tapCounts.length > 0 ? tapCounts.reduce((total, count) => total + count, 0) / tapCounts.length : 0;
	const variance =
		tapCounts.length > 0
			? tapCounts.reduce((total, count) => total + (count - mean) * (count - mean), 0) / tapCounts.length
			: 0;

	if (variance !== 0) {
		const spread = rows
			.filter((row) => Number(row.depthTapCount) !== minimum)
			.map((row) => (row.label || "pixel") + " spent " + row.depthTapCount)
			.join("; ");
		problems.push(
			"visibility taps per pixel vary between " + minimum + " and " + maximum + " - gate G1 demands zero variance (" + spread + ")",
		);
	}

	tapCounts.forEach((count, index) => {
		if (!Number.isFinite(count) || 1 > count) {
			problems.push("row " + index + " did not report a usable tap count");
		}
	});

	return { pass: problems.length === 0, pixelCount: rows.length, minimum, maximum, mean, variance, problems };
}


export function describeScreenTraceBudget(tier) {
	const stepCount = screenTraceStepsForTier(tier);

	if (stepCount === null) {
		return {
			owner: MSM_SCREEN_TRACE_OWNER,
			tier: typeof tier === "string" ? tier.trim().toLowerCase() : "",
			runs: false,
			stepCount: 0,
			depthTapsPerPixel: 0,
			newTextureUnits: MSM_SCREEN_TRACE_NEW_TEXTURE_UNITS,
			reason: "the MSM does not run on this tier, so the screen trace marches nothing",
		};
	}

	return {
		owner: MSM_SCREEN_TRACE_OWNER,
		tier: String(tier).trim().toLowerCase(),
		runs: true,
		stepCount,
		depthTapsPerPixel: depthTapsPerPixel(stepCount),
		newTextureUnits: MSM_SCREEN_TRACE_NEW_TEXTURE_UNITS,
		ladder: {
			floor: MSM_SCREEN_TRACE_STEP_FLOOR,
			ceiling: MSM_SCREEN_TRACE_STEP_CEILING,
			sellsTo: sellScreenTraceStepCount(stepCount),
			decrement: MSM_SCREEN_TRACE_LADDER_STEP_DECREMENT,
		},
		reason: "tier " + tier + " marches exactly " + stepCount + " steps on every pixel of the frame",
	};
}


export function validateScreenTraceStepBudget() {
	const problems = [];

	MSM_ACTIVE_TIERS.forEach((tier) => {
		const policy = getMsmTierPolicy(tier);
		const declaredSteps = policy ? Math.floor(Number(policy.screenTraceSteps)) : NaN;
		if (!Number.isFinite(declaredSteps)) {
			problems.push("tier " + tier + " declares no screen trace step count");
			return;
		}
		if (MSM_SCREEN_TRACE_STEP_FLOOR > declaredSteps || declaredSteps > MSM_SCREEN_TRACE_STEP_CEILING) {
			problems.push(
				"tier " +
					tier +
					" asks for " +
					declaredSteps +
					" steps, outside the accepted range " +
					MSM_SCREEN_TRACE_STEP_FLOOR +
					".." +
					MSM_SCREEN_TRACE_STEP_CEILING,
			);
		}
	});


	const cheapestSteps = screenTraceStepsForTier(MSM_ACTIVE_TIERS[0]);
	const richestSteps = screenTraceStepsForTier(MSM_ACTIVE_TIERS[MSM_ACTIVE_TIERS.length - 1]);
	if (cheapestSteps !== MSM_SCREEN_TRACE_STEP_FLOOR) {
		problems.push("the cheapest tier should march the floor of " + MSM_SCREEN_TRACE_STEP_FLOOR + " steps");
	}
	if (richestSteps !== MSM_SCREEN_TRACE_STEP_CEILING) {
		problems.push("the most expensive tier should march the ceiling of " + MSM_SCREEN_TRACE_STEP_CEILING + " steps");
	}


	MSM_ACTIVE_TIERS.forEach((tier, index) => {
		if (index === 0) return;
		const previousSteps = screenTraceStepsForTier(MSM_ACTIVE_TIERS[index - 1]);
		const currentSteps = screenTraceStepsForTier(tier);
		if (previousSteps > currentSteps) {
			problems.push("tier " + tier + " marches fewer steps than the cheaper tier before it");
		}
	});

	return { ok: problems.length === 0, problems };
}
