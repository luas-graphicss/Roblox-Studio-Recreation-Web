export const SB_ROUGH_REFRACTION_DEFAULT_IOR = 1.52
export const SB_ROUGH_REFRACTION_MINIMUM_IOR = 1
export const SB_ROUGH_REFRACTION_MAXIMUM_IOR = 3


export const SB_ROUGH_REFRACTION_DEFAULT_F0 = 0.04


export const SB_ROUGH_REFRACTION_SPREAD_PER_IOR_UNIT = 1.2


export const SB_ROUGH_REFRACTION_INTERFACE_SHARE = 0.6


export const SB_ROUGH_REFRACTION_MEDIUM_SHARE = 0.4


export const SB_ROUGH_REFRACTION_PATH_REFERENCE = 0.25


export const SB_ROUGH_REFRACTION_MINIMUM_REFRACTED_COSINE = 0.08


export const SB_ROUGH_REFRACTION_MAXIMUM_MIP_LEVEL = 6


export const SB_ROUGH_REFRACTION_MAXIMUM_SCREEN_OFFSET = 0.12
export const SB_ROUGH_REFRACTION_OFFSET_PER_IOR_UNIT = 0.18

function finiteOr(value, fallback) {
	return Number.isFinite(value) ? value : fallback
}

function clampNumber(value, minimum, maximum) {
	return Math.min(maximum, Math.max(minimum, value))
}

function averageChannel(colorOrNumber, fallback) {
	if (Number.isFinite(colorOrNumber)) return colorOrNumber
	if (!Array.isArray(colorOrNumber) || colorOrNumber.length === 0) return fallback
	const channels = colorOrNumber.map((channel) => finiteOr(channel, fallback))
	return channels.reduce((total, channel) => total + channel, 0) / channels.length
}

export function sanitizeIor(ior) {
	return clampNumber(
		finiteOr(ior, SB_ROUGH_REFRACTION_DEFAULT_IOR),
		SB_ROUGH_REFRACTION_MINIMUM_IOR,
		SB_ROUGH_REFRACTION_MAXIMUM_IOR,
	)
}

export function sanitizeUnitRange(value, fallback = 0) {
	return clampNumber(finiteOr(value, fallback), 0, 1)
}


export function refractionF0FromIor(ior) {
	const refractiveIndex = sanitizeIor(ior)
	const ratio = (refractiveIndex - 1) / (refractiveIndex + 1)
	return ratio * ratio
}


export function iorFromRefractionF0(f0) {
	const clamped = clampNumber(finiteOr(f0, SB_ROUGH_REFRACTION_DEFAULT_F0), 0, 0.99)
	const root = Math.sqrt(clamped)
	return sanitizeIor((1 + root) / (1 - root))
}


export function screenOffsetFromIor(ior) {
	const deviation = (sanitizeIor(ior) - 1) * SB_ROUGH_REFRACTION_OFFSET_PER_IOR_UNIT
	return Math.min(SB_ROUGH_REFRACTION_MAXIMUM_SCREEN_OFFSET, Math.max(0, deviation))
}


export function refractedCosine(cosThetaView, ior) {
	const refractiveIndex = sanitizeIor(ior)
	const cosine = sanitizeUnitRange(cosThetaView, 1)
	const sineSquared = 1 - cosine * cosine
	const refractedSineSquared = sineSquared / (refractiveIndex * refractiveIndex)
	return Math.sqrt(Math.max(0, 1 - refractedSineSquared))
}


export function refractedPathLength({ thickness, cosThetaView, ior } = {}) {
	const travelled = Math.max(0, finiteOr(thickness, 0))
	const cosine = Math.max(SB_ROUGH_REFRACTION_MINIMUM_REFRACTED_COSINE, refractedCosine(cosThetaView, ior))
	return (travelled * 2) / cosine
}


export function refractionSpreadAmplification(ior) {
	return 1 + SB_ROUGH_REFRACTION_SPREAD_PER_IOR_UNIT * (sanitizeIor(ior) - 1)
}


export function roughRefractionSpread({ topRoughness, ior } = {}) {
	const roughness = sanitizeUnitRange(topRoughness)
	if (!(roughness > 0)) return 0
	const amplification = refractionSpreadAmplification(ior)
	return (roughness * amplification) / (1 + roughness * (amplification - 1))
}


export function refractionPathTerm({ thickness, cosThetaView, ior } = {}) {
	const pathLength = refractedPathLength({ thickness, cosThetaView, ior })
	const mediumTerm = 1 - Math.exp(-pathLength / SB_ROUGH_REFRACTION_PATH_REFERENCE)
	return SB_ROUGH_REFRACTION_INTERFACE_SHARE + SB_ROUGH_REFRACTION_MEDIUM_SHARE * mediumTerm
}


export function roughRefractionStrength({ topRoughness, ior, coverage, thickness, cosThetaView } = {}) {
	const spread = roughRefractionSpread({ topRoughness, ior })
	if (!(spread > 0)) return 0
	const coverageAmount = sanitizeUnitRange(coverage, 1)
	if (!(coverageAmount > 0)) return 0
	const pathTerm = refractionPathTerm({ thickness, cosThetaView, ior })
	return sanitizeUnitRange(spread * coverageAmount * pathTerm)
}


export function broadenRoughness(bottomRoughness, spread) {
	const roughness = sanitizeUnitRange(bottomRoughness)
	if (!(spread > 0)) return roughness
	return Math.min(1, Math.sqrt(roughness * roughness + spread * spread))
}


export function refractionMipLevel(strength) {
	const amount = sanitizeUnitRange(strength)
	if (!(amount > 0)) return 0
	return amount * SB_ROUGH_REFRACTION_MAXIMUM_MIP_LEVEL
}


export function planRoughRefraction(request = {}) {
	const ior = sanitizeIor(request.ior)
	const topRoughness = sanitizeUnitRange(request.topRoughness)
	const bottomRoughness = sanitizeUnitRange(request.bottomRoughness)
	const coverage = sanitizeUnitRange(request.coverage, 1)
	const thickness = Math.max(0, finiteOr(request.thickness, 0))
	const cosThetaView = sanitizeUnitRange(request.cosThetaView, 1)
	const spread = roughRefractionSpread({ topRoughness, ior })
	const strength = roughRefractionStrength({ topRoughness, ior, coverage, thickness, cosThetaView })
	const effectiveBottomRoughness = broadenRoughness(bottomRoughness, strength)
	return {
		ior,
		topRoughness,
		bottomRoughness,
		coverage,
		thickness,
		cosThetaView,
		spread,
		strength,
		effectiveBottomRoughness,
		blurGrowth: effectiveBottomRoughness - bottomRoughness,
		interfaceF0: refractionF0FromIor(ior),
		pathLength: refractedPathLength({ thickness, cosThetaView, ior }),
		screenOffset: screenOffsetFromIor(ior),
		mipLevel: refractionMipLevel(strength),
	}
}


export function planFromLayeredPreset(layeredPreset, options = {}) {
	const topLayer = layeredPreset?.top ?? {}
	const bottomLayer = layeredPreset?.bottom ?? {}
	const ior = Number.isFinite(options.ior)
		? options.ior
		: iorFromRefractionF0(averageChannel(topLayer.f0, SB_ROUGH_REFRACTION_DEFAULT_F0))
	return planRoughRefraction({
		ior,
		topRoughness: topLayer.roughness,
		bottomRoughness: bottomLayer.roughness,
		coverage: layeredPreset?.coverage,
		thickness: layeredPreset?.thickness,
		cosThetaView: options.cosThetaView,
	})
}
export const SB_ROUGH_REFRACTION_NORMAL_BLUR_SHARE = 0.85

export function normalBlurWeight(strength) {
	const amount = sanitizeUnitRange(strength)
	if (!(amount > 0)) return 0
	return amount * SB_ROUGH_REFRACTION_NORMAL_BLUR_SHARE
}

export function combineStackedStrengths(strengths) {
	let total = 0
	for (const strength of Array.isArray(strengths) ? strengths : []) {
		const amount = sanitizeUnitRange(strength)
		total = Math.min(1, Math.sqrt(total * total + amount * amount))
	}
	return total
}

export function planFromCoatRecord(request = {}) {
	return planRoughRefraction({
		ior: iorFromRefractionF0(averageChannel(request.coatF0, SB_ROUGH_REFRACTION_DEFAULT_F0)),
		topRoughness: request.coatRoughness,
		bottomRoughness: request.bottomRoughness,
		coverage: request.coverage,
		thickness: request.thickness,
		cosThetaView: request.cosThetaView,
	})
}

export function roughRefractionGlslConstants() {
	return {
		SB_ROUGH_REFRACTION_SPREAD_PER_IOR_UNIT,
		SB_ROUGH_REFRACTION_INTERFACE_SHARE,
		SB_ROUGH_REFRACTION_MEDIUM_SHARE,
		SB_ROUGH_REFRACTION_PATH_REFERENCE,
		SB_ROUGH_REFRACTION_MINIMUM_REFRACTED_COSINE,
		SB_ROUGH_REFRACTION_MINIMUM_IOR,
		SB_ROUGH_REFRACTION_MAXIMUM_IOR,
		SB_ROUGH_REFRACTION_NORMAL_BLUR_SHARE,
	}
}
