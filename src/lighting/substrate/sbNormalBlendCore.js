export const SB_NORMAL_BLEND_MODES = Object.freeze({ linear: "linear", spherical: "spherical" })
export const SB_DEFAULT_NORMAL = Object.freeze([0, 0, 1])
export const SB_UNIT_LENGTH_TOLERANCE = 1e-6


const NEARLY_PARALLEL_COSINE = 0.999999

const NEARLY_OPPOSITE_COSINE = -0.999999

const POLE_AVOIDANCE_COSINE = 0.9

function isFiniteNumber(value) {
	return typeof value === "number" && Number.isFinite(value)
}

function clampCosine(cosine) {
	if (-1 > cosine) return -1
	if (cosine > 1) return 1
	return cosine
}


export function clampBlendWeight(weight) {
	if (!isFiniteNumber(weight)) return 0
	if (0 > weight) return 0
	if (weight > 1) return 1
	return weight
}


export function normalizeNormal(vector) {
	if (!Array.isArray(vector) || 3 > vector.length) return [...SB_DEFAULT_NORMAL]
	const [x, y, z] = vector
	if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return [...SB_DEFAULT_NORMAL]
	const length = Math.sqrt(x * x + y * y + z * z)
	if (SB_UNIT_LENGTH_TOLERANCE > length) return [...SB_DEFAULT_NORMAL]
	return [x / length, y / length, z / length]
}

export function normalDotProduct(left, right) {
	return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

export function normalCrossProduct(left, right) {
	return [
		left[1] * right[2] - left[2] * right[1],
		left[2] * right[0] - left[0] * right[2],
		left[0] * right[1] - left[1] * right[0],
	]
}

export function isUnitNormal(vector, tolerance = SB_UNIT_LENGTH_TOLERANCE) {
	if (!Array.isArray(vector) || 3 > vector.length) return false
	if (![vector[0], vector[1], vector[2]].every(isFiniteNumber)) return false
	return tolerance >= Math.abs(1 - Math.sqrt(normalDotProduct(vector, vector)))
}

export function normalAngleBetween(firstNormal, secondNormal) {
	const first = normalizeNormal(firstNormal)
	const second = normalizeNormal(secondNormal)
	return Math.acos(clampCosine(normalDotProduct(first, second)))
}

function perpendicularAxis(normal) {
	const reference = POLE_AVOIDANCE_COSINE > Math.abs(normal[0]) ? [1, 0, 0] : [0, 1, 0]
	return normalizeNormal(normalCrossProduct(normal, reference))
}

function rotateAroundAxis(vector, axis, angle) {
	const cosine = Math.cos(angle)
	const sine = Math.sin(angle)
	const cross = normalCrossProduct(axis, vector)
	const axisProjection = normalDotProduct(axis, vector) * (1 - cosine)
	return normalizeNormal([
		vector[0] * cosine + cross[0] * sine + axis[0] * axisProjection,
		vector[1] * cosine + cross[1] * sine + axis[1] * axisProjection,
		vector[2] * cosine + cross[2] * sine + axis[2] * axisProjection,
	])
}


export function blendNormalsLinear(firstNormal, secondNormal, weight) {
	const first = normalizeNormal(firstNormal)
	const second = normalizeNormal(secondNormal)
	const blendWeight = clampBlendWeight(weight)
	if (0 === blendWeight) return first
	if (1 === blendWeight) return second
	return normalizeNormal([
		first[0] * (1 - blendWeight) + second[0] * blendWeight,
		first[1] * (1 - blendWeight) + second[1] * blendWeight,
		first[2] * (1 - blendWeight) + second[2] * blendWeight,
	])
}


export function blendNormalsSpherical(firstNormal, secondNormal, weight) {
	const first = normalizeNormal(firstNormal)
	const second = normalizeNormal(secondNormal)
	const blendWeight = clampBlendWeight(weight)
	if (0 === blendWeight) return first
	if (1 === blendWeight) return second

	const cosine = clampCosine(normalDotProduct(first, second))
	if (cosine > NEARLY_PARALLEL_COSINE) return blendNormalsLinear(first, second, blendWeight)
	if (NEARLY_OPPOSITE_COSINE > cosine) return rotateAroundAxis(first, perpendicularAxis(first), blendWeight * Math.PI)

	const angle = Math.acos(cosine)
	const sine = Math.sin(angle)
	const firstScale = Math.sin((1 - blendWeight) * angle) / sine
	const secondScale = Math.sin(blendWeight * angle) / sine
	return normalizeNormal([
		first[0] * firstScale + second[0] * secondScale,
		first[1] * firstScale + second[1] * secondScale,
		first[2] * firstScale + second[2] * secondScale,
	])
}


export function blendNormals(firstNormal, secondNormal, weight, options = {}) {
	const mode = options.mode ?? SB_NORMAL_BLEND_MODES.spherical
	if (mode === SB_NORMAL_BLEND_MODES.linear) return blendNormalsLinear(firstNormal, secondNormal, weight)
	return blendNormalsSpherical(firstNormal, secondNormal, weight)
}


export function findNormalBlendProblems(options = {}) {
	const {
		firstNormal = [0, 0, 1],
		secondNormal = [1, 0, 0],
		sampleCount = 11,
		mode = SB_NORMAL_BLEND_MODES.spherical,
	} = options
	const problems = []
	const first = normalizeNormal(firstNormal)
	const second = normalizeNormal(secondNormal)
	const angleTolerance = 1e-9
	let previousAngle = -1

	for (let sampleIndex = 0; sampleCount > sampleIndex; sampleIndex += 1) {
		const weight = sampleIndex / (sampleCount - 1)
		const blended = blendNormals(first, second, weight, { mode })
		if (!isUnitNormal(blended)) problems.push(`normal fora do comprimento unitario no peso ${weight}`)
		const angle = normalAngleBetween(first, blended)
		if (previousAngle - angleTolerance > angle) problems.push(`o angulo andou para tras no peso ${weight}`)
		previousAngle = angle
	}

	if (JSON.stringify(blendNormals(first, second, 0, { mode })) !== JSON.stringify(first)) {
		problems.push("peso 0 nao devolveu a primeira normal")
	}
	if (JSON.stringify(blendNormals(first, second, 1, { mode })) !== JSON.stringify(second)) {
		problems.push("peso 1 nao devolveu a segunda normal")
	}
	return problems
}


export function describeOppositeNormalBlend() {
	const first = [0, 0, 1]
	const second = [0, 0, -1]
	const midpointLinear = blendNormalsLinear(first, second, 0.5)
	const midpointSpherical = blendNormalsSpherical(first, second, 0.5)
	return {
		midpointLinear,
		midpointSpherical,
		linearIsUnit: isUnitNormal(midpointLinear),
		sphericalIsUnit: isUnitNormal(midpointSpherical),
		sphericalAngleFromFirst: normalAngleBetween(first, midpointSpherical),
	}
}
