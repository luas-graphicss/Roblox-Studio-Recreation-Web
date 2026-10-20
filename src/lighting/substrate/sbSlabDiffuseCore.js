import {
	dotProduct,
	lambertDiffuseBsdf,
	normalizeSlabForReference,
	normalizeVector,
} from "./sbSlabBsdfReferenceCore.js"

export const SB_SLAB_DIFFUSE_MODELS = {
	lambert: "lambert",
	energyNormalizedRetro: "energyNormalizedRetro",
	burley: "burley",
}


export const SB_SLAB_DIFFUSE_DEFAULT_MODEL = SB_SLAB_DIFFUSE_MODELS.energyNormalizedRetro


export const SB_SLAB_DIFFUSE_GRAZING_EXPONENT = 5


export const SB_SLAB_DIFFUSE_GRAZING_HEMISPHERE_INTEGRAL = 1 / 21


export const SB_SLAB_DIFFUSE_RETRO_STRENGTH_AT_FULL_ROUGHNESS = 0.5

const BURLEY_ENERGY_BIAS_AT_FULL_ROUGHNESS = 0.5
const BURLEY_ENERGY_FACTOR_AT_FULL_ROUGHNESS = 1 / 1.51
const MINIMUM_COSINE = 1e-6
const CHANNEL_TOTAL = 3

function clampToUnitRange(value) {
	if (!Number.isFinite(value)) return 0
	if (value > 1) return 1
	return value > 0 ? value : 0
}


function grazingTail(cosTheta) {
	return clampToUnitRange(1 - clampToUnitRange(cosTheta)) ** SB_SLAB_DIFFUSE_GRAZING_EXPONENT
}

export function slabDiffuseModelIds() {
	return Object.values(SB_SLAB_DIFFUSE_MODELS)
}

export function isKnownSlabDiffuseModel(model) {
	return slabDiffuseModelIds().includes(model)
}


export function slabDiffuseRetroStrength(roughness) {
	return clampToUnitRange(roughness) * SB_SLAB_DIFFUSE_RETRO_STRENGTH_AT_FULL_ROUGHNESS
}


export function slabDiffuseLightShaping(cosThetaLight, retroStrength) {
	return 1 + retroStrength * grazingTail(cosThetaLight)
}


export function slabDiffuseEnergyNormalization(retroStrength) {
	return 1 / (1 + retroStrength * SB_SLAB_DIFFUSE_GRAZING_HEMISPHERE_INTEGRAL)
}


export function energyNormalizedRetroDiffuseWeight(roughness, cosThetaLight) {
	const retroStrength = slabDiffuseRetroStrength(roughness)
	return slabDiffuseLightShaping(cosThetaLight, retroStrength) * slabDiffuseEnergyNormalization(retroStrength)
}

export function burleyEnergyBias(roughness) {
	return clampToUnitRange(roughness) * BURLEY_ENERGY_BIAS_AT_FULL_ROUGHNESS
}

export function burleyEnergyFactor(roughness) {
	return 1 + clampToUnitRange(roughness) * (BURLEY_ENERGY_FACTOR_AT_FULL_ROUGHNESS - 1)
}


export function burleyDiffuseWeight(options) {
	const roughness = clampToUnitRange(options.roughness)
	const cosThetaLightHalf = clampToUnitRange(options.cosThetaLightHalf)
	const grazingReflectance = burleyEnergyBias(roughness) + 2 * cosThetaLightHalf * cosThetaLightHalf * roughness
	const lightScatter = 1 + (grazingReflectance - 1) * grazingTail(options.cosThetaLight)
	const viewScatter = 1 + (grazingReflectance - 1) * grazingTail(options.cosThetaView)
	return lightScatter * viewScatter * burleyEnergyFactor(roughness)
}


export function slabDiffuseWeight(options) {
	const model = options.model ?? SB_SLAB_DIFFUSE_DEFAULT_MODEL
	if (model === SB_SLAB_DIFFUSE_MODELS.lambert) return 1
	if (model === SB_SLAB_DIFFUSE_MODELS.energyNormalizedRetro) {
		return energyNormalizedRetroDiffuseWeight(options.roughness, options.cosThetaLight)
	}
	if (model === SB_SLAB_DIFFUSE_MODELS.burley) return burleyDiffuseWeight(options)
	throw new TypeError("modelo de difusa desconhecido: " + String(model))
}


export function evaluateSlabDiffuseBsdf(options) {
	const normalizedSlab = options.normalizedSlab ?? normalizeSlabForReference(options.slab)
	const viewDirection = options.viewDirection
	const lightDirection = options.lightDirection
	const cosThetaView = viewDirection[2]
	const cosThetaLight = lightDirection[2]
	if (MINIMUM_COSINE > cosThetaView || MINIMUM_COSINE > cosThetaLight) return new Array(CHANNEL_TOTAL).fill(0)

	const halfVector = normalizeVector([
		viewDirection[0] + lightDirection[0],
		viewDirection[1] + lightDirection[1],
		viewDirection[2] + lightDirection[2],
	])
	const weight = slabDiffuseWeight({
		model: options.model,
		roughness: normalizedSlab.roughness,
		cosThetaView,
		cosThetaLight,
		cosThetaLightHalf: Math.max(0, dotProduct(lightDirection, halfVector)),
	})
	return lambertDiffuseBsdf(normalizedSlab.albedo).map((channel) => channel * weight)
}


export function diffuseEnergyScaleFromSpecularAlbedo(specularDirectionalAlbedo) {
	const perChannel = Array.isArray(specularDirectionalAlbedo)
		? specularDirectionalAlbedo
		: new Array(CHANNEL_TOTAL).fill(specularDirectionalAlbedo)
	return perChannel.map((channel) => clampToUnitRange(1 - clampToUnitRange(channel)))
}

export function applyDiffuseEnergyScale(diffuseBsdf, energyScale) {
	return diffuseBsdf.map((channel, channelIndex) => channel * energyScale[channelIndex])
}


export function evaluateCoupledSlabDiffuseBsdf(options) {
	return applyDiffuseEnergyScale(
		evaluateSlabDiffuseBsdf(options),
		diffuseEnergyScaleFromSpecularAlbedo(options.specularDirectionalAlbedo ?? 0),
	)
}


export function analyticSlabDiffuseDirectionalAlbedo(options) {
	const model = options.model ?? SB_SLAB_DIFFUSE_DEFAULT_MODEL
	const normalizedSlab = options.normalizedSlab ?? normalizeSlabForReference(options.slab)
	if (model === SB_SLAB_DIFFUSE_MODELS.lambert || model === SB_SLAB_DIFFUSE_MODELS.energyNormalizedRetro) {
		return [...normalizedSlab.albedo]
	}
	return null
}


export function describeSlabDiffuse() {
	return {
		models: slabDiffuseModelIds(),
		defaultModel: SB_SLAB_DIFFUSE_DEFAULT_MODEL,
		grazingExponent: SB_SLAB_DIFFUSE_GRAZING_EXPONENT,
		grazingHemisphereIntegral: SB_SLAB_DIFFUSE_GRAZING_HEMISPHERE_INTEGRAL,
		retroStrengthAtFullRoughness: SB_SLAB_DIFFUSE_RETRO_STRENGTH_AT_FULL_ROUGHNESS,
		reciprocal: false,
		couplingSource: "albedo direcional especular recebido de fora (SB-F5 hoje, SB-F10 depois)",
	}
}
