import { averageFresnel, multiScatterEnergyScale, whiteFurnaceDirectionalAlbedo } from "./sbEnvBrdfCore.js"
import { slabParameterSchema } from "./sbSlabParametersCore.js"


export const SB_SLAB_SPECULAR_MINIMUM_ROUGHNESS = slabParameterSchema("roughness").minimum

const MINIMUM_COSINE = 1e-6

function asColorTriplet(value, fallback) {
	if (Array.isArray(value) && value.length >= 3) return [value[0], value[1], value[2]]
	if (typeof value === "number" && Number.isFinite(value)) return [value, value, value]
	return [fallback, fallback, fallback]
}

function dotProduct(first, second) {
	return first[0] * second[0] + first[1] * second[1] + first[2] * second[2]
}

function normalizeVector(vector) {
	const length = Math.sqrt(dotProduct(vector, vector))
	if (length <= MINIMUM_COSINE) return [0, 0, 1]
	return [vector[0] / length, vector[1] / length, vector[2] / length]
}


export function normalizeSlabSpecular(slab) {
	const source = slab ?? {}
	const f0 = asColorTriplet(source.f0, 0.04)
	const f90Source = source.f90
	const f90 = typeof f90Source === "number" && Number.isFinite(f90Source) ? f90Source : Array.isArray(f90Source) ? f90Source[0] : 1
	const roughnessSource = typeof source.roughness === "number" && Number.isFinite(source.roughness) ? source.roughness : slabParameterSchema("roughness").defaultValue
	const roughness = Math.min(Math.max(roughnessSource, SB_SLAB_SPECULAR_MINIMUM_ROUGHNESS), 1)
	return { f0, f90, roughness, alpha: roughness * roughness }
}


export function ggxDistribution(cosThetaHalf, alpha) {
	const alphaSquared = alpha * alpha
	const cosineSquared = Math.min(Math.max(cosThetaHalf * cosThetaHalf, 0), 1)
	const denominator = cosineSquared * (alphaSquared - 1) + 1
	return alphaSquared / (Math.PI * Math.max(denominator * denominator, MINIMUM_COSINE * MINIMUM_COSINE))
}


export function smithLambda(cosTheta, alpha) {
	const cosineSquared = Math.min(Math.max(cosTheta * cosTheta, MINIMUM_COSINE), 1)
	const tangentSquared = (1 - cosineSquared) / cosineSquared
	return (Math.sqrt(1 + alpha * alpha * tangentSquared) - 1) / 2
}


export function smithVisibilityHeightCorrelated(cosThetaView, cosThetaLight, alpha) {
	const lambdaView = smithLambda(cosThetaView, alpha)
	const lambdaLight = smithLambda(cosThetaLight, alpha)
	const cosineProduct = Math.max(cosThetaView, MINIMUM_COSINE) * Math.max(cosThetaLight, MINIMUM_COSINE)
	return 1 / (4 * cosineProduct * (1 + lambdaView + lambdaLight))
}


export function fresnelSchlickF0ToF90(f0, f90, cosTheta) {
	const clampedCosine = Math.min(Math.max(cosTheta, 0), 1)
	const tail = Math.pow(1 - clampedCosine, 5)
	return [f0[0] + (f90 - f0[0]) * tail, f0[1] + (f90 - f0[1]) * tail, f0[2] + (f90 - f0[2]) * tail]
}


export function evaluateSlabSpecularBrdf(options) {
	const slab = options.normalizedSlab ?? normalizeSlabSpecular(options.slab)
	const viewDirection = options.viewDirection
	const lightDirection = options.lightDirection
	const cosThetaView = viewDirection[2]
	const cosThetaLight = lightDirection[2]
	if (cosThetaView <= 0 || cosThetaLight <= 0) return [0, 0, 0]
	const halfVector = normalizeVector([
		viewDirection[0] + lightDirection[0],
		viewDirection[1] + lightDirection[1],
		viewDirection[2] + lightDirection[2],
	])
	const distribution = ggxDistribution(halfVector[2], slab.alpha)
	const visibility = smithVisibilityHeightCorrelated(cosThetaView, cosThetaLight, slab.alpha)
	const fresnel = fresnelSchlickF0ToF90(slab.f0, slab.f90, dotProduct(viewDirection, halfVector))
	const lobeWeight = distribution * visibility
	return [fresnel[0] * lobeWeight, fresnel[1] * lobeWeight, fresnel[2] * lobeWeight]
}


export function slabSpecularEnergyCompensation(options) {
	const slab = options.normalizedSlab ?? normalizeSlabSpecular(options.slab)
	const cosThetaView = Math.min(Math.max(options.cosThetaView ?? 1, 0), 1)
	const whiteAlbedo = whiteFurnaceDirectionalAlbedo(cosThetaView, slab.roughness)
	const averageFresnelValue = averageFresnel(slab.f0, slab.f90)
	return {
		cosThetaView,
		roughness: slab.roughness,
		whiteAlbedo,
		missingEnergy: 1 - whiteAlbedo,
		averageFresnel: averageFresnelValue,
		scale: multiScatterEnergyScale(whiteAlbedo, averageFresnelValue),
	}
}
