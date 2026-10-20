import { MSM_ACTIVE_TIERS, describeMsmTierPolicy, getMsmTierPolicy } from "./msmTierPolicy.js";


export const MSM_SPECULAR_PHASE_ID = "MSM-F25";


export const MSM_SPECULAR_MODE = Object.freeze({
	NONE: "none",
	SCALAR_BOOST: "scalarBoost",
	MRP_LITE: "mrpLite",
});


export const MSM_SPECULAR_MODE_LADDER = Object.freeze([
	MSM_SPECULAR_MODE.MRP_LITE,
	MSM_SPECULAR_MODE.SCALAR_BOOST,
	MSM_SPECULAR_MODE.NONE,
]);


export const MSM_SPECULAR_MODE_BY_TIER = Object.freeze({
	micro: MSM_SPECULAR_MODE.NONE,
	lite: MSM_SPECULAR_MODE.NONE,
	low: MSM_SPECULAR_MODE.SCALAR_BOOST,
	medium: MSM_SPECULAR_MODE.MRP_LITE,
});


export const MSM_MRP_LITE_TIER = "medium";


export const MSM_SPECULAR_NEW_TEXTURE_UNITS = 0;


export const MSM_SPECULAR_TIER_REFUSAL = Object.freeze({
	TIER_NOT_INFORMED: "tierNotInformed",
	TIER_WITHOUT_MSM: "tierWithoutMsm",
	TIER_TOO_WEAK_FOR_SPECULAR: "tierTooWeakForSpecular",
	SOLD_BY_GOVERNOR: "soldByGovernor",
});


export const MSM_SPECULAR_LADDER_RUNG_REQUEST = Object.freeze({
	id: "specular-boost-off",
	requestedBy: MSM_SPECULAR_PHASE_ID,
	owner: "MSM-F31",
	suggestedPosition: 1,
	sells: "MRP-lite first, then the scalar boost, then nothing is left to sell",
	ladder: MSM_SPECULAR_MODE_LADDER,
	reason:
		"section 6.3 has no rung for specular, so half of this phase would have no buyer when the frame goes over the tier budget",
});

function readTierText(value) {
	return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function readSoldSteps(value) {
	if (value === true) return 1;
	if (typeof value !== "number" || !Number.isFinite(value) || value > 0 === false) return 0;
	return Math.floor(value);
}


export function degradeSpecularMode(mode) {
	const position = MSM_SPECULAR_MODE_LADDER.indexOf(mode);
	if (position === -1) return MSM_SPECULAR_MODE.NONE;
	const lastPosition = MSM_SPECULAR_MODE_LADDER.length - 1;
	return MSM_SPECULAR_MODE_LADDER[Math.min(position + 1, lastPosition)];
}


export function describeSpecularTierPolicy(request) {
	const settings = request && typeof request === "object" ? request : {};
	const tier = readTierText(settings.tier);
	const tierPolicy = getMsmTierPolicy(tier);
	const soldSteps = readSoldSteps(settings.soldSteps !== undefined ? settings.soldSteps : settings.soldByGovernor);

	function decision(mode, refusal, reason) {
		return {
			phaseId: MSM_SPECULAR_PHASE_ID,
			tier,
			mode,
			runs: mode !== MSM_SPECULAR_MODE.NONE,
			mrpLite: mode === MSM_SPECULAR_MODE.MRP_LITE,
			newTextureUnits: MSM_SPECULAR_NEW_TEXTURE_UNITS,
			budgetMs: tierPolicy ? tierPolicy.budgetMs : null,
			soldSteps,
			refusal,
			reason,
		};
	}

	if (!tier) {
		return decision(
			MSM_SPECULAR_MODE.NONE,
			MSM_SPECULAR_TIER_REFUSAL.TIER_NOT_INFORMED,
			"renderer tier was not informed - specular is the last thing to hand out on a guess",
		);
	}
	if (!tierPolicy) {
		return decision(
			MSM_SPECULAR_MODE.NONE,
			MSM_SPECULAR_TIER_REFUSAL.TIER_WITHOUT_MSM,
			describeMsmTierPolicy(tier).reason,
		);
	}

	const tableMode = MSM_SPECULAR_MODE_BY_TIER[tier] || MSM_SPECULAR_MODE.NONE;
	if (tableMode === MSM_SPECULAR_MODE.NONE) {
		return decision(
			MSM_SPECULAR_MODE.NONE,
			MSM_SPECULAR_TIER_REFUSAL.TIER_TOO_WEAK_FOR_SPECULAR,
			"tier " + tier + " runs no stochastic specular - residue 3 of section 12, declared, not hidden",
		);
	}

	let mode = tableMode;
	for (let step = 0; soldSteps > step; step += 1) mode = degradeSpecularMode(mode);

	if (mode === MSM_SPECULAR_MODE.NONE) {
		return decision(
			mode,
			MSM_SPECULAR_TIER_REFUSAL.SOLD_BY_GOVERNOR,
			"tier " + tier + " would run " + tableMode + ", but the governor sold " + soldSteps + " step(s) of specular",
		);
	}

	return decision(
		mode,
		null,
		"tier " +
			tier +
			" runs " +
			mode +
			" inside the same " +
			tierPolicy.budgetMs +
			" ms budget, with " +
			MSM_SPECULAR_NEW_TEXTURE_UNITS +
			" new texture unit",
	);
}


export function resolveSpecularMode(tier) {
	return describeSpecularTierPolicy({ tier }).mode;
}


export function specularRunsOnTier(tier) {
	return resolveSpecularMode(tier) !== MSM_SPECULAR_MODE.NONE;
}


export function describeSpecularTierContract() {
	return {
		phaseId: MSM_SPECULAR_PHASE_ID,
		activeTiers: MSM_ACTIVE_TIERS,
		modeByTier: MSM_SPECULAR_MODE_BY_TIER,
		mrpLiteTier: MSM_MRP_LITE_TIER,
		newTextureUnits: MSM_SPECULAR_NEW_TEXTURE_UNITS,
		ladderRungRequest: MSM_SPECULAR_LADDER_RUNG_REQUEST,
		declaredResidues: Object.freeze([
			"section 12 number 3: micro and lite have no stochastic specular",
			"section 12 number 1: area lights only reach MRP-lite, and only on medium",
		]),
	};
}
