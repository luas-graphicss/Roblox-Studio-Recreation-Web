export const SB_MINIMUM_ROUGHNESS = 0.001

const MINIMUM_COSINE = 1e-6
const DEFAULT_ROUGHNESS = 0.5
const WHITE_TRIPLET = [1, 1, 1]
const BLACK_TRIPLET = [0, 0, 0]

function toColorTriplet(value, fallbackTriplet) {
	if (Array.isArray(value)) {
		const red = Number(value[0])
		const green = Number(value[1])
		const blue = Number(value[2])
		return [
			Number.isFinite(red) ? red : fallbackTriplet[0],
			Number.isFinite(green) ? green : fallbackTriplet[1],
			Number.isFinite(blue) ? blue : fallbackTriplet[2],
		]
	}
	const scalar = Number(value)
	if (Number.isFinite(scalar)) return [scalar, scalar, scalar]
	return [fallbackTriplet[0], fallbackTriplet[1], fallbackTriplet[2]]
}


export function normalizeSlabForReference(slab) {
	const roughnessInput = Number(slab?.roughness)
	const roughness = Number.isFinite(roughnessInput)
		? Math.min(1, Math.max(SB_MINIMUM_ROUGHNESS, roughnessInput))
		: DEFAULT_ROUGHNESS
	return {
		albedo: toColorTriplet(slab?.albedo, BLACK_TRIPLET),
		f0: toColorTriplet(slab?.f0, BLACK_TRIPLET),
		f90: toColorTriplet(slab?.f90, WHITE_TRIPLET),
		roughness,
		alpha: roughness * roughness,
	}
}

export function dotProduct(left, right) {
	return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

export function normalizeVector(vector) {
	const length = Math.hypot(vector[0], vector[1], vector[2])
	if (length < MINIMUM_COSINE) return [0, 0, 1]
	return [vector[0] / length, vector[1] / length, vector[2] / length]
}


export function viewDirectionFromCosine(cosThetaView) {
	const cosine = Math.min(1, Math.max(MINIMUM_COSINE, cosThetaView))
	const sine = Math.sqrt(Math.max(0, 1 - cosine * cosine))
	return [sine, 0, cosine]
}


export function directionFromCosineAndAzimuth(cosTheta, azimuth) {
	const cosine = Math.min(1, Math.max(0, cosTheta))
	const sine = Math.sqrt(Math.max(0, 1 - cosine * cosine))
	return [sine * Math.cos(azimuth), sine * Math.sin(azimuth), cosine]
}

export function reflectAroundHalfVector(viewDirection, halfVector) {
	const projection = 2 * dotProduct(viewDirection, halfVector)
	return [
		projection * halfVector[0] - viewDirection[0],
		projection * halfVector[1] - viewDirection[1],
		projection * halfVector[2] - viewDirection[2],
	]
}


export function fresnelSchlickWithF90(f0, f90, cosTheta) {
	const clampedCosine = Math.min(1, Math.max(0, cosTheta))
	const grazingWeight = (1 - clampedCosine) ** 5
	return [
		f0[0] + (f90[0] - f0[0]) * grazingWeight,
		f0[1] + (f90[1] - f0[1]) * grazingWeight,
		f0[2] + (f90[2] - f0[2]) * grazingWeight,
	]
}


export function ggxNormalDistribution(alpha, cosThetaHalf) {
	const cosine = Math.min(1, Math.max(0, cosThetaHalf))
	const alphaSquared = alpha * alpha
	const denominator = cosine * cosine * (alphaSquared - 1) + 1
	return alphaSquared / (Math.PI * denominator * denominator)
}


export function smithLambda(alpha, cosTheta) {
	const cosine = Math.min(1, Math.max(MINIMUM_COSINE, cosTheta))
	const tangentSquared = (1 - cosine * cosine) / (cosine * cosine)
	return (Math.sqrt(1 + alpha * alpha * tangentSquared) - 1) / 2
}


export function smithMaskingG1(alpha, cosTheta) {
	return 1 / (1 + smithLambda(alpha, cosTheta))
}


export function smithG2HeightCorrelated(alpha, cosThetaView, cosThetaLight) {
	return 1 / (1 + smithLambda(alpha, cosThetaView) + smithLambda(alpha, cosThetaLight))
}

export function lambertDiffuseBsdf(albedo) {
	return [albedo[0] / Math.PI, albedo[1] / Math.PI, albedo[2] / Math.PI]
}


export function sampleGgxVisibleNormal(options) {
	const alpha = Math.max(SB_MINIMUM_ROUGHNESS * SB_MINIMUM_ROUGHNESS, options.alpha)
	const viewDirection = options.viewDirection
	const stretchedView = normalizeVector([alpha * viewDirection[0], alpha * viewDirection[1], viewDirection[2]])
	const horizontalLengthSquared = stretchedView[0] * stretchedView[0] + stretchedView[1] * stretchedView[1]
	const horizontalLength = Math.sqrt(horizontalLengthSquared)
	const firstTangent =
		horizontalLengthSquared > 0
			? [-stretchedView[1] / horizontalLength, stretchedView[0] / horizontalLength, 0]
			: [1, 0, 0]
	const secondTangent = [
		stretchedView[1] * firstTangent[2] - stretchedView[2] * firstTangent[1],
		stretchedView[2] * firstTangent[0] - stretchedView[0] * firstTangent[2],
		stretchedView[0] * firstTangent[1] - stretchedView[1] * firstTangent[0],
	]
	const diskRadius = Math.sqrt(Math.min(1, Math.max(0, options.u)))
	const diskAzimuth = 2 * Math.PI * options.v
	const firstOffset = diskRadius * Math.cos(diskAzimuth)
	const unwarpedSecondOffset = diskRadius * Math.sin(diskAzimuth)
	const hemisphereBlend = 0.5 * (1 + stretchedView[2])
	const secondOffset =
		(1 - hemisphereBlend) * Math.sqrt(Math.max(0, 1 - firstOffset * firstOffset)) + hemisphereBlend * unwarpedSecondOffset
	const verticalOffset = Math.sqrt(Math.max(0, 1 - firstOffset * firstOffset - secondOffset * secondOffset))
	const stretchedNormal = [
		firstOffset * firstTangent[0] + secondOffset * secondTangent[0] + verticalOffset * stretchedView[0],
		firstOffset * firstTangent[1] + secondOffset * secondTangent[1] + verticalOffset * stretchedView[1],
		firstOffset * firstTangent[2] + secondOffset * secondTangent[2] + verticalOffset * stretchedView[2],
	]
	return normalizeVector([alpha * stretchedNormal[0], alpha * stretchedNormal[1], Math.max(0, stretchedNormal[2])])
}


export function visibleNormalSampleWeight(options) {
	const { alpha, f0, f90, viewDirection, halfVector, lightDirection } = options
	const cosThetaLight = lightDirection[2]
	if (cosThetaLight <= MINIMUM_COSINE) return [0, 0, 0]
	const cosThetaView = Math.max(MINIMUM_COSINE, viewDirection[2])
	const fresnel = fresnelSchlickWithF90(f0, f90, Math.max(0, dotProduct(viewDirection, halfVector)))
	const viewLambda = smithLambda(alpha, cosThetaView)
	const lightLambda = smithLambda(alpha, cosThetaLight)
	const shadowingRatio = (1 + viewLambda) / (1 + viewLambda + lightLambda)
	return [fresnel[0] * shadowingRatio, fresnel[1] * shadowingRatio, fresnel[2] * shadowingRatio]
}


export function evaluateSlabBsdf(options) {
	const slab = options.normalizedSlab ?? normalizeSlabForReference(options.slab)
	const viewDirection = options.viewDirection
	const lightDirection = options.lightDirection
	const cosThetaView = viewDirection[2]
	const cosThetaLight = lightDirection[2]
	if (cosThetaView <= MINIMUM_COSINE || cosThetaLight <= MINIMUM_COSINE) {
		return { diffuse: [0, 0, 0], specular: [0, 0, 0], total: [0, 0, 0] }
	}
	const diffuse = lambertDiffuseBsdf(slab.albedo)
	const halfVector = normalizeVector([
		viewDirection[0] + lightDirection[0],
		viewDirection[1] + lightDirection[1],
		viewDirection[2] + lightDirection[2],
	])
	const fresnel = fresnelSchlickWithF90(slab.f0, slab.f90, Math.max(0, dotProduct(viewDirection, halfVector)))
	const distribution = ggxNormalDistribution(slab.alpha, halfVector[2])
	const geometry = smithG2HeightCorrelated(slab.alpha, cosThetaView, cosThetaLight)
	const specularScale = (distribution * geometry) / (4 * cosThetaView * cosThetaLight)
	const specular = [fresnel[0] * specularScale, fresnel[1] * specularScale, fresnel[2] * specularScale]
	return {
		diffuse,
		specular,
		total: [diffuse[0] + specular[0], diffuse[1] + specular[1], diffuse[2] + specular[2]],
	}
}
