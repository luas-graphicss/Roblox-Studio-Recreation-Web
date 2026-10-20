import { fresnelSchlickF0ToF90, normalizeSlabSpecular } from "./sbSlabSpecularCore.js"
import { slabParameterSchema } from "./sbSlabParametersCore.js"
import { projectDirectionOntoFrame } from "./sbTangentFrameCore.js"

const anisotropySchema = slabParameterSchema("anisotropy")
const rotationSchema = slabParameterSchema("anisotropyRotation")


export const SB_ANISOTROPY_MINIMUM = anisotropySchema.minimum
export const SB_ANISOTROPY_MAXIMUM = anisotropySchema.maximum
export const SB_ANISOTROPY_ROTATION_PERIOD = rotationSchema.maximum


export const SB_ANISOTROPY_ASPECT_FACTOR = 0.9


export const SB_ANISOTROPY_BEND_EXPONENT = 4

const MINIMUM_ALPHA = 1e-4
const MINIMUM_DENOMINATOR = 1e-12

function dotProduct(first, second) {
	return first[0] * second[0] + first[1] * second[1] + first[2] * second[2]
}

function crossProduct(first, second) {
	return [
		first[1] * second[2] - first[2] * second[1],
		first[2] * second[0] - first[0] * second[2],
		first[0] * second[1] - first[1] * second[0],
	]
}

function normalizeVector(vector) {
	const length = Math.sqrt(dotProduct(vector, vector))
	if (MINIMUM_ALPHA > length) return null
	return [vector[0] / length, vector[1] / length, vector[2] / length]
}

function wrapRotation(rotationRadians) {
	const wrapped = rotationRadians % SB_ANISOTROPY_ROTATION_PERIOD
	return 0 > wrapped ? wrapped + SB_ANISOTROPY_ROTATION_PERIOD : wrapped
}

function readFiniteNumber(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback
}


export function normalizeAnisotropicSlab(slab) {
	const source = slab ?? {}
	const specular = normalizeSlabSpecular(source)
	const anisotropySource = readFiniteNumber(source.anisotropy, anisotropySchema.defaultValue)
	const anisotropy = Math.min(Math.max(anisotropySource, SB_ANISOTROPY_MINIMUM), SB_ANISOTROPY_MAXIMUM)
	const rotationSource = readFiniteNumber(source.anisotropyRotation, rotationSchema.defaultValue)
	return { ...specular, anisotropy, anisotropyRotation: wrapRotation(rotationSource) }
}

function resolveNormalizedSlab(options) {
	if (options?.normalizedSlab) return options.normalizedSlab
	return normalizeAnisotropicSlab(options?.slab ?? options)
}


export function anisotropicAlphaSplit(options) {
	const slab = resolveNormalizedSlab(options)
	const aspect = Math.sqrt(Math.max(1 - SB_ANISOTROPY_ASPECT_FACTOR * slab.anisotropy, MINIMUM_ALPHA))
	const alphaTangent = Math.min(Math.max(slab.alpha / aspect, MINIMUM_ALPHA), 1)
	const alphaBitangent = Math.min(Math.max(slab.alpha * aspect, MINIMUM_ALPHA), 1)
	return { alpha: slab.alpha, anisotropy: slab.anisotropy, aspect, alphaTangent, alphaBitangent }
}


export function anisotropicHighlightStretch(split) {
	return split.alphaTangent / split.alphaBitangent
}

function lengthOfThree(first, second, third) {
	return Math.sqrt(first * first + second * second + third * third)
}


export function anisotropicGgxDistribution(halfVector, split) {
	const cosineHalf = halfVector[2]
	if (0 >= cosineHalf) return 0
	const scaledTangent = halfVector[0] / split.alphaTangent
	const scaledBitangent = halfVector[1] / split.alphaBitangent
	const shape = scaledTangent * scaledTangent + scaledBitangent * scaledBitangent + cosineHalf * cosineHalf
	const denominator = Math.PI * split.alphaTangent * split.alphaBitangent * shape * shape
	return 1 / Math.max(denominator, MINIMUM_DENOMINATOR)
}


export function anisotropicSmithVisibility(viewDirection, lightDirection, split) {
	const cosThetaView = viewDirection[2]
	const cosThetaLight = lightDirection[2]
	if (0 >= cosThetaView || 0 >= cosThetaLight) return 0
	const stretchedView = lengthOfThree(
		split.alphaTangent * viewDirection[0],
		split.alphaBitangent * viewDirection[1],
		cosThetaView,
	)
	const stretchedLight = lengthOfThree(
		split.alphaTangent * lightDirection[0],
		split.alphaBitangent * lightDirection[1],
		cosThetaLight,
	)
	const maskingSum = cosThetaLight * stretchedView + cosThetaView * stretchedLight
	return 0.5 / Math.max(maskingSum, MINIMUM_DENOMINATOR)
}


export function evaluateAnisotropicSpecularBrdfInFrameSpace(options) {
	const slab = resolveNormalizedSlab(options)
	const split = options.split ?? anisotropicAlphaSplit({ normalizedSlab: slab })
	const viewDirection = options.viewDirection
	const lightDirection = options.lightDirection
	if (0 >= viewDirection[2] || 0 >= lightDirection[2]) return [0, 0, 0]
	const halfVector = normalizeVector([
		viewDirection[0] + lightDirection[0],
		viewDirection[1] + lightDirection[1],
		viewDirection[2] + lightDirection[2],
	])
	if (halfVector === null) return [0, 0, 0]
	const distribution = anisotropicGgxDistribution(halfVector, split)
	const visibility = anisotropicSmithVisibility(viewDirection, lightDirection, split)
	const fresnel = fresnelSchlickF0ToF90(slab.f0, slab.f90, dotProduct(viewDirection, halfVector))
	const lobeWeight = distribution * visibility
	return [fresnel[0] * lobeWeight, fresnel[1] * lobeWeight, fresnel[2] * lobeWeight]
}


export function evaluateAnisotropicSpecularBrdf(options) {
	const slab = resolveNormalizedSlab(options)
	const frame = options.frame
	return evaluateAnisotropicSpecularBrdfInFrameSpace({
		normalizedSlab: slab,
		split: options.split ?? anisotropicAlphaSplit({ normalizedSlab: slab }),
		viewDirection: projectDirectionOntoFrame(frame, options.viewDirection),
		lightDirection: projectDirectionOntoFrame(frame, options.lightDirection),
	})
}


export function anisotropicBentNormalBlend(options) {
	const slab = resolveNormalizedSlab(options)
	const stretchAmount = 1 - slab.anisotropy * (1 - slab.roughness)
	return Math.pow(Math.min(Math.max(stretchAmount, 0), 1), SB_ANISOTROPY_BEND_EXPONENT)
}


export function bendNormalTowardAnisotropy(options) {
	const frame = options.frame
	const blend = options.blend ?? anisotropicBentNormalBlend(options)
	const bendPlaneNormal = crossProduct(frame.bitangent, options.viewDirection)
	const stretchedNormal = normalizeVector(crossProduct(bendPlaneNormal, frame.bitangent))
	if (stretchedNormal === null) return frame.normal
	const mixedNormal = [
		stretchedNormal[0] + (frame.normal[0] - stretchedNormal[0]) * blend,
		stretchedNormal[1] + (frame.normal[1] - stretchedNormal[1]) * blend,
		stretchedNormal[2] + (frame.normal[2] - stretchedNormal[2]) * blend,
	]
	return normalizeVector(mixedNormal) ?? frame.normal
}
