import { SB_TIER_NAMES, tierDefaults } from "./sbMaterialContract.js"
import { SB_LAYERED_PRESETS } from "./support/src/lab/labSlabPresets.js"
import { planFromLayeredPreset, planRoughRefraction } from "./sbRoughRefractionCore.js"


export const SB_ROUGH_REFRACTION_MEASURED_ROUGHNESSES = [0, 0.25, 0.5, 0.75, 1]


export const SB_ROUGH_REFRACTION_CERTIFICATION_LAYER = {
	bottomRoughness: 0.28,
	ior: 1.52,
	coverage: 1,
	thickness: 0.08,
	cosThetaView: 1,
}


export const SB_ROUGH_REFRACTION_TEXTURE_UNITS = 0


export const SB_ROUGH_REFRACTION_CLOSURE_BYTES = 0


export const SB_ROUGH_REFRACTION_FRAGMENT_INSTRUCTIONS = 6


export const SB_ROUGH_REFRACTION_EXTRA_RENDER_PASSES = 0


export function measureBlurByRoughness(request = {}) {
	const layer = { ...SB_ROUGH_REFRACTION_CERTIFICATION_LAYER, ...(request.layer ?? {}) }
	const roughnesses = request.roughnesses ?? SB_ROUGH_REFRACTION_MEASURED_ROUGHNESSES
	const points = roughnesses.map((topRoughness) => {
		const plan = planRoughRefraction({ ...layer, topRoughness })
		return {
			topRoughness: plan.topRoughness,
			spread: plan.spread,
			strength: plan.strength,
			bottomRoughness: plan.bottomRoughness,
			effectiveBottomRoughness: plan.effectiveBottomRoughness,
			blurGrowth: plan.blurGrowth,
		}
	})
	const steps = points.slice(1).map((point, index) => point.blurGrowth - points[index].blurGrowth)
	const firstPoint = points[0]
	return {
		layer,
		pointCount: points.length,
		points,
		steps,
		smallestBlurStep: steps.length > 0 ? Math.min(...steps) : 0,
		largestBlurGrowth: points[points.length - 1].blurGrowth,
		strictlyIncreasing: steps.every((step) => step > 0),
		identityAtZeroRoughness:
			firstPoint.topRoughness === 0 &&
			firstPoint.strength === 0 &&
			firstPoint.effectiveBottomRoughness === firstPoint.bottomRoughness,
	}
}


export function measureLayeredPresets(request = {}) {
	const presets = request.presets ?? SB_LAYERED_PRESETS
	return Object.keys(presets)
		.sort()
		.map((presetId) => ({
			presetId,
			plan: planFromLayeredPreset(presets[presetId], { cosThetaView: request.cosThetaView }),
		}))
}


export function roughRefractionCostDeclaration(tierName) {
	const defaults = tierDefaults(tierName)
	return {
		tier: tierName,
		frameBudgetMilliseconds: defaults.frameBudgetMilliseconds,
		enabledByDefault: defaults.roughRefraction === true,
		textureUnits: SB_ROUGH_REFRACTION_TEXTURE_UNITS,
		closureBytes: SB_ROUGH_REFRACTION_CLOSURE_BYTES,
		extraRenderPasses: SB_ROUGH_REFRACTION_EXTRA_RENDER_PASSES,
		addedFragmentInstructions: SB_ROUGH_REFRACTION_FRAGMENT_INSTRUCTIONS,
		measuredMilliseconds: null,
		howToMeasure: "__sbLab.stepCost() com a flag ligada e desligada, no preview visivel",
	}
}

export function roughRefractionCostDeclarations() {
	return SB_TIER_NAMES.map((tierName) => roughRefractionCostDeclaration(tierName))
}


export function certifyRoughRefraction(request = {}) {
	const curve = measureBlurByRoughness(request)
	const repeatedCurve = measureBlurByRoughness(request)
	const presets = measureLayeredPresets(request)
	const costs = roughRefractionCostDeclarations()
	const deterministic = JSON.stringify(repeatedCurve.points) === JSON.stringify(curve.points)
	const problems = []

	if (5 > curve.pointCount) problems.push("o portao pede cinco pontos medidos, vieram " + curve.pointCount)
	if (!curve.strictlyIncreasing) problems.push("o desfoque nao cresce em todos os pontos medidos")
	if (!curve.identityAtZeroRoughness) problems.push("rugosidade zero mexeu na camada de baixo")
	if (!deterministic) problems.push("a mesma entrada devolveu numeros diferentes")

	for (const measured of presets) {
		if (measured.plan.topRoughness > 0 && !(measured.plan.blurGrowth > 0)) {
			problems.push("preset em camadas sem desfoque: " + measured.presetId)
		}
		if (measured.plan.strength > 1 || 0 > measured.plan.strength) {
			problems.push("forca fora da faixa em " + measured.presetId)
		}
	}

	for (const cost of costs) {
		if (cost.textureUnits !== 0) problems.push("unidade de textura declarada no tier " + cost.tier)
		if (cost.closureBytes !== 0) problems.push("byte de closure declarado no tier " + cost.tier)
		if (cost.extraRenderPasses !== 0) problems.push("passe de render extra no tier " + cost.tier)
	}

	return { ok: problems.length === 0, problems, curve, presets, costs, deterministic }
}
