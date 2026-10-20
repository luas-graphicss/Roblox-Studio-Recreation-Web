import { SB_TIER_NAMES, tierDefaults } from "./sbMaterialContract.js"
import { SB_SORTED_PIXELS_MODE, resolveSortedPixels } from "./sbOitSortedPixelsCore.js"
import { SB_WEIGHTED_BLENDED_MODE, resolveWeightedBlended } from "./sbOitWeightedBlendedCore.js"

export const SB_TRANSLUCENCY_MODES = {
	[SB_SORTED_PIXELS_MODE]: {
		mode: SB_SORTED_PIXELS_MODE,
		exact: true,
		orderIndependent: false,
		description: "K-buffer por pixel: ordem exata, custo maior",
	},
	[SB_WEIGHTED_BLENDED_MODE]: {
		mode: SB_WEIGHTED_BLENDED_MODE,
		exact: false,
		orderIndependent: true,
		description: "soma ponderada: sem ordenar, com erro medido",
	},
}


export const SB_FALLBACK_TRANSLUCENCY_MODE = SB_WEIGHTED_BLENDED_MODE

export function translucencyModeForTier(tierName) {
	const declaredMode = tierDefaults(tierName)?.translucencyMode ?? null
	const known = Boolean(declaredMode && SB_TRANSLUCENCY_MODES[declaredMode])
	const mode = known ? declaredMode : SB_FALLBACK_TRANSLUCENCY_MODE
	return { ...SB_TRANSLUCENCY_MODES[mode], tier: tierName ?? null, declaredMode, known }
}

export function describeTranslucencyModes() {
	return SB_TIER_NAMES.map((tierName) => translucencyModeForTier(tierName))
}


export function translucencyModeProblems() {
	const problems = []
	for (const declaration of describeTranslucencyModes()) {
		if (!declaration.known) {
			problems.push("tier " + declaration.tier + " declara modo desconhecido: " + declaration.declaredMode)
		}
	}
	const weakTier = translucencyModeForTier("fraco")
	if (weakTier.mode !== SB_FALLBACK_TRANSLUCENCY_MODE) {
		problems.push("tier fraco tem de nascer no fallback, e nao em " + weakTier.mode)
	}
	if (!weakTier.orderIndependent) {
		problems.push("o fallback do tier fraco precisa ser independente de ordem")
	}
	return problems
}


export function resolveTranslucency(options) {
	const mode = options?.mode ?? translucencyModeForTier(options?.tierName).mode
	if (mode === SB_SORTED_PIXELS_MODE) return resolveSortedPixels(options)
	return resolveWeightedBlended(options)
}
