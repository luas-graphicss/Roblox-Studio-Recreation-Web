const EPSILON = 1e-6
const TWO_PI = Math.PI * 2


export const SB_HAIR_KERATIN_IOR = 1.55


export const SB_HAIR_OUTER_IOR = 1


export const SB_HAIR_LOBE_NAMES = Object.freeze(["R", "TT", "TRT"])


export const SB_HAIR_LONGITUDINAL_SHIFT_FACTORS = Object.freeze({ R: -1, TT: 0.5, TRT: 1.5 })


export const SB_HAIR_LONGITUDINAL_WIDTH_FACTORS = Object.freeze({ R: 1, TT: 0.5, TRT: 2 })


export const SB_HAIR_AZIMUTHAL_CENTERS = Object.freeze({ R: 0, TT: Math.PI, TRT: 0 })


export const SB_HAIR_AZIMUTHAL_WIDTH_FACTORS = Object.freeze({ TT: 0.5, TRT: 2 })


export const SB_HAIR_R_AZIMUTHAL_NORMALIZATION = 0.25


export const SB_HAIR_EUMELANIN_ABSORPTION = Object.freeze([0.419, 0.697, 1.37])


export const SB_HAIR_PATH_LENGTH_PER_PASS = 2


export const SB_HAIR_MINIMUM_PATH_COSINE = 0.1


export const SB_HAIR_MINIMUM_ROUGHNESS = 0.02


export const SB_HAIR_MAXIMUM_LONGITUDINAL_WIDTH = 0.5


export const SB_HAIR_MAXIMUM_AZIMUTHAL_WIDTH = 1


export const SB_HAIR_UNIFORM_COMPONENTS = Object.freeze(["cuticleAngle", "roughness", "radialRoughness", "melanin"])

export const SB_HAIR_PARAMETER_RANGES = Object.freeze({
	melanin: Object.freeze({ minimum: 0, maximum: 1 }),
	roughness: Object.freeze({ minimum: SB_HAIR_MINIMUM_ROUGHNESS, maximum: 1 }),
	radialRoughness: Object.freeze({ minimum: SB_HAIR_MINIMUM_ROUGHNESS, maximum: 1 }),
	cuticleAngle: Object.freeze({ minimum: 0, maximum: 0.1745 }),
	ior: Object.freeze({ minimum: 1.05, maximum: 1.8 }),
	scatter: Object.freeze({ minimum: 0, maximum: 1 }),
})


export function defaultHairParameters() {
	return {
		baseColor: [0.14, 0.08, 0.05],
		melanin: 0.6,
		roughness: 0.28,
		radialRoughness: 0.45,
		cuticleAngle: 0.0524,
		ior: SB_HAIR_KERATIN_IOR,
		scatter: 0.35,
	}
}

function clampNumber(value, minimum, maximum) {
	if (value > maximum) return maximum
	if (minimum > value) return minimum
	return value
}

function numberOrFallback(value, fallback) {
	return Number.isFinite(value) ? value : fallback
}

function clampToRange(value, range) {
	return clampNumber(value, range.minimum, range.maximum)
}

function sanitizeColor(rawColor, fallbackColor) {
	const source = Array.isArray(rawColor) ? rawColor : []
	return fallbackColor.map((fallbackChannel, channelIndex) =>
		clampNumber(numberOrFallback(source[channelIndex], fallbackChannel), 0, 1),
	)
}


function sanitizeDirection(rawDirection) {
	const source = Array.isArray(rawDirection) ? rawDirection : []
	const axes = [0, 1, 2].map((axisIndex) => numberOrFallback(source[axisIndex], axisIndex === 0 ? 1 : 0))
	const length = Math.sqrt(axes.reduce((total, axis) => total + axis * axis, 0))
	if (EPSILON > length) return [1, 0, 0]
	return axes.map((axis) => axis / length)
}


export function wrapAzimuth(azimuth) {
	const finiteAzimuth = numberOrFallback(azimuth, 0)
	const wrapped = finiteAzimuth - TWO_PI * Math.floor((finiteAzimuth + Math.PI) / TWO_PI)
	return wrapped
}


export function normalizedGaussian(value, center, width) {
	const safeWidth = Math.max(width, EPSILON)
	const normalizedDistance = (value - center) / safeWidth
	return Math.exp(-0.5 * normalizedDistance * normalizedDistance) / (safeWidth * Math.sqrt(TWO_PI))
}


export function sanitizeHairParameters(rawParameters) {
	const defaults = defaultHairParameters()
	const source = rawParameters ?? {}
	return {
		baseColor: sanitizeColor(source.baseColor, defaults.baseColor),
		melanin: clampToRange(numberOrFallback(source.melanin, defaults.melanin), SB_HAIR_PARAMETER_RANGES.melanin),
		roughness: clampToRange(numberOrFallback(source.roughness, defaults.roughness), SB_HAIR_PARAMETER_RANGES.roughness),
		radialRoughness: clampToRange(
			numberOrFallback(source.radialRoughness, defaults.radialRoughness),
			SB_HAIR_PARAMETER_RANGES.radialRoughness,
		),
		cuticleAngle: clampToRange(
			numberOrFallback(source.cuticleAngle, defaults.cuticleAngle),
			SB_HAIR_PARAMETER_RANGES.cuticleAngle,
		),
		ior: clampToRange(numberOrFallback(source.ior, defaults.ior), SB_HAIR_PARAMETER_RANGES.ior),
		scatter: clampToRange(numberOrFallback(source.scatter, defaults.scatter), SB_HAIR_PARAMETER_RANGES.scatter),
	}
}


export function keratinFresnelAtNormalIncidence(fiberIor = SB_HAIR_KERATIN_IOR) {
	const ratio = (fiberIor - SB_HAIR_OUTER_IOR) / (fiberIor + SB_HAIR_OUTER_IOR)
	return ratio * ratio
}


export function fiberFresnel(cosThetaIncidence, fiberIor = SB_HAIR_KERATIN_IOR) {
	const cosine = clampNumber(numberOrFallback(cosThetaIncidence, 0), 0, 1)
	const reflectanceAtNormal = keratinFresnelAtNormalIncidence(fiberIor)
	return reflectanceAtNormal + (1 - reflectanceAtNormal) * Math.pow(1 - cosine, 5)
}


export function absorptionFromMelanin(melanin) {
	const amount = clampToRange(numberOrFallback(melanin, 0), SB_HAIR_PARAMETER_RANGES.melanin)
	return SB_HAIR_EUMELANIN_ABSORPTION.map((coefficient) => coefficient * amount)
}


export function fiberPathLength(cosThetaDifference) {
	const cosine = Math.max(Math.abs(numberOrFallback(cosThetaDifference, 1)), SB_HAIR_MINIMUM_PATH_COSINE)
	return SB_HAIR_PATH_LENGTH_PER_PASS / cosine
}


export function singlePassTransmittance(hairParameters, cosThetaDifference = 1) {
	const hair = sanitizeHairParameters(hairParameters)
	const pathLength = fiberPathLength(cosThetaDifference)
	return absorptionFromMelanin(hair.melanin).map((absorption) => Math.exp(-absorption * pathLength))
}

export function longitudinalLobeCenter(lobeName, cuticleAngle) {
	const shiftFactor = SB_HAIR_LONGITUDINAL_SHIFT_FACTORS[lobeName]
	if (shiftFactor === undefined) return null
	const angle = clampToRange(numberOrFallback(cuticleAngle, 0), SB_HAIR_PARAMETER_RANGES.cuticleAngle)
	return shiftFactor * angle
}

export function longitudinalLobeWidth(lobeName, roughness) {
	const widthFactor = SB_HAIR_LONGITUDINAL_WIDTH_FACTORS[lobeName]
	if (widthFactor === undefined) return null
	const fiberRoughness = clampToRange(numberOrFallback(roughness, 0), SB_HAIR_PARAMETER_RANGES.roughness)
	return clampNumber(widthFactor * fiberRoughness, SB_HAIR_MINIMUM_ROUGHNESS, SB_HAIR_MAXIMUM_LONGITUDINAL_WIDTH)
}

export function azimuthalLobeWidth(lobeName, radialRoughness) {
	const widthFactor = SB_HAIR_AZIMUTHAL_WIDTH_FACTORS[lobeName]
	if (widthFactor === undefined) return null
	const fiberRadialRoughness = clampToRange(
		numberOrFallback(radialRoughness, 0),
		SB_HAIR_PARAMETER_RANGES.radialRoughness,
	)
	return clampNumber(widthFactor * fiberRadialRoughness, SB_HAIR_MINIMUM_ROUGHNESS, SB_HAIR_MAXIMUM_AZIMUTHAL_WIDTH)
}


export function longitudinalScattering(lobeName, thetaHalf, hairParameters) {
	const hair = sanitizeHairParameters(hairParameters)
	const center = longitudinalLobeCenter(lobeName, hair.cuticleAngle)
	const width = longitudinalLobeWidth(lobeName, hair.roughness)
	if (center === null || width === null) return 0
	return normalizedGaussian(numberOrFallback(thetaHalf, 0), center, width)
}


export function azimuthalScattering(lobeName, azimuth, hairParameters) {
	const hair = sanitizeHairParameters(hairParameters)
	const center = SB_HAIR_AZIMUTHAL_CENTERS[lobeName]
	if (center === undefined) return 0
	const wrappedAzimuth = wrapAzimuth(azimuth)
	if ("R" === lobeName) {
		return SB_HAIR_R_AZIMUTHAL_NORMALIZATION * Math.max(0, Math.cos(wrappedAzimuth / 2))
	}
	const width = azimuthalLobeWidth(lobeName, hair.radialRoughness)
	return normalizedGaussian(wrapAzimuth(wrappedAzimuth - center), 0, width)
}


export function analyticEnergyCeiling(fresnel) {
	const reflectance = clampNumber(numberOrFallback(fresnel, 0), 0, 1)
	return 1 - reflectance * reflectance * (1 - reflectance)
}


export function lobeAttenuations(hairParameters, cosThetaIncidence, cosThetaDifference = 1) {
	const hair = sanitizeHairParameters(hairParameters)
	const fresnel = fiberFresnel(cosThetaIncidence, hair.ior)
	const transmittance = singlePassTransmittance(hair, cosThetaDifference)
	const entryExit = (1 - fresnel) * (1 - fresnel)
	const lobes = {
		R: [fresnel, fresnel, fresnel],
		TT: transmittance.map((channel) => entryExit * channel),
		TRT: transmittance.map((channel) => entryExit * fresnel * channel * channel),
	}
	const energyPerChannel = [0, 1, 2].map((channelIndex) =>
		SB_HAIR_LOBE_NAMES.reduce((total, lobeName) => total + lobes[lobeName][channelIndex], 0),
	)
	return {
		fresnel,
		transmittance,
		lobes,
		energyPerChannel,
		energy: Math.max(...energyPerChannel),
		energyCeiling: analyticEnergyCeiling(fresnel),
	}
}


export function evaluateHairBsdf(options = {}) {
	const hair = sanitizeHairParameters(options.hair)
	const thetaIncidence = numberOrFallback(options.thetaIncidence, 0)
	const thetaOutgoing = numberOrFallback(options.thetaOutgoing, 0)
	const azimuth = wrapAzimuth(options.azimuth)
	const thetaHalf = (thetaIncidence + thetaOutgoing) / 2
	const thetaDifference = (thetaOutgoing - thetaIncidence) / 2
	const cosThetaDifference = Math.cos(thetaDifference)
	const cosThetaIncidence = clampNumber(cosThetaDifference * Math.cos(azimuth / 2), 0, 1)
	const attenuation = lobeAttenuations(hair, cosThetaIncidence, cosThetaDifference)
	const lobes = SB_HAIR_LOBE_NAMES.map((lobeName) => {
		const longitudinal = longitudinalScattering(lobeName, thetaHalf, hair)
		const azimuthal = azimuthalScattering(lobeName, azimuth, hair)
		return {
			name: lobeName,
			center: longitudinalLobeCenter(lobeName, hair.cuticleAngle),
			width: longitudinalLobeWidth(lobeName, hair.roughness),
			attenuation: attenuation.lobes[lobeName].slice(),
			longitudinal,
			azimuthal,
			radiance: attenuation.lobes[lobeName].map((channel) => channel * longitudinal * azimuthal),
		}
	})
	const total = [0, 1, 2].map((channelIndex) => lobes.reduce((sum, lobe) => sum + lobe.radiance[channelIndex], 0))
	return {
		parameters: hair,
		thetaHalf,
		thetaDifference,
		azimuth,
		cosThetaIncidence,
		fresnel: attenuation.fresnel,
		transmittance: attenuation.transmittance,
		lobes,
		total,
		energy: attenuation.energy,
		energyCeiling: attenuation.energyCeiling,
	}
}


export function hairClosurePayload(hairParameters, fiberTangent) {
	const hair = sanitizeHairParameters(hairParameters)
	return {
		baseColor: hair.baseColor.slice(),
		melanin: hair.melanin,
		roughness: hair.roughness,
		radialRoughness: hair.radialRoughness,
		cuticleAngle: hair.cuticleAngle,
		ior: hair.ior,
		tangent: sanitizeDirection(fiberTangent),
		scatter: hair.scatter,
	}
}


export function packHairUniform(hairParameters) {
	const hair = sanitizeHairParameters(hairParameters)
	return SB_HAIR_UNIFORM_COMPONENTS.map((componentName) => hair[componentName])
}
