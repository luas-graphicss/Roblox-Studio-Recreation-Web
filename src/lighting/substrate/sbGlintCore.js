const UINT32_LIMIT = 4294967296
const HASH_SEED_FALLBACK = 0x9e3779b9
const HASH_MULTIPLIER_CELL_X = 0x27d4eb2d
const HASH_MULTIPLIER_CELL_Y = 0x165667b1
const HASH_MULTIPLIER_LEVEL = 0x9e3779b1
const HASH_MULTIPLIER_STREAM = 0x85ebca6b
const HASH_AVALANCHE_FIRST = 0x2c1b3c6d
const HASH_AVALANCHE_SECOND = 0x297a2d39


export const SB_GLINT_DEFAULT_SEED = 20260915


export const SB_GLINT_NORMAL_APPROXIMATION_THRESHOLD = 12


export const SB_GLINT_COUNT_ITERATION_CEILING = 64


export const SB_GLINT_MINIMUM_LIT_FRACTION = 0.0001


export const SB_GLINT_MINIMUM_ROUGHNESS = 0.001

function normalizeSeed(seed) {
	const numericSeed = Number(seed)
	if (!Number.isFinite(numericSeed)) return HASH_SEED_FALLBACK
	const truncatedSeed = Math.floor(Math.abs(numericSeed)) % UINT32_LIMIT
	return truncatedSeed === 0 ? HASH_SEED_FALLBACK : truncatedSeed >>> 0
}

function toInteger(value) {
	const numericValue = Number(value)
	return Number.isFinite(numericValue) ? Math.trunc(numericValue) | 0 : 0
}

function toNonNegativeNumber(value) {
	const numericValue = Number(value)
	return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0
}


function avalanche(state) {
	let mixed = state >>> 0
	mixed ^= mixed >>> 15
	mixed = Math.imul(mixed, HASH_AVALANCHE_FIRST) >>> 0
	mixed ^= mixed >>> 12
	mixed = Math.imul(mixed, HASH_AVALANCHE_SECOND) >>> 0
	mixed ^= mixed >>> 15
	return mixed >>> 0
}


export function hashCell(options) {
	const cellX = toInteger(options?.cellX)
	const cellY = toInteger(options?.cellY)
	const level = toInteger(options?.level)
	const streamIndex = toInteger(options?.streamIndex)
	let state = normalizeSeed(options?.seed ?? SB_GLINT_DEFAULT_SEED)
	state = (state ^ Math.imul(cellX, HASH_MULTIPLIER_CELL_X)) >>> 0
	state = (state ^ Math.imul(cellY, HASH_MULTIPLIER_CELL_Y)) >>> 0
	state = (state ^ Math.imul(level + 1, HASH_MULTIPLIER_LEVEL)) >>> 0
	state = (state ^ Math.imul(streamIndex + 1, HASH_MULTIPLIER_STREAM)) >>> 0
	return avalanche(state)
}


export function hashCellToUnitFloat(options) {
	return hashCell(options) / UINT32_LIMIT
}


export function ggxNormalDistribution(options) {
	const roughness = Math.max(Number(options?.roughness) || 0, SB_GLINT_MINIMUM_ROUGHNESS)
	const halfVectorCosine = Math.min(Math.max(Number(options?.halfVectorCosine) || 0, 0), 1)
	const alpha = roughness * roughness
	const alphaSquared = alpha * alpha
	const cosineSquared = halfVectorCosine * halfVectorCosine
	const denominator = cosineSquared * (alphaSquared - 1) + 1
	return alphaSquared / (Math.PI * denominator * denominator)
}


export function litMicrofacetFraction(options) {
	const glintRoughness = Math.max(Number(options?.glintRoughness) || 0, 0)
	const baseRoughness = Math.max(Number(options?.baseRoughness) || 0, SB_GLINT_MINIMUM_ROUGHNESS)
	const flakeLobeArea = glintRoughness * glintRoughness
	const baseLobeArea = baseRoughness * baseRoughness
	const fraction = flakeLobeArea / baseLobeArea
	return Math.min(Math.max(fraction, SB_GLINT_MINIMUM_LIT_FRACTION), 1)
}


export function expectedMicrofacetCount(options) {
	const glintDensity = toNonNegativeNumber(options?.glintDensity)
	const cellArea = toNonNegativeNumber(options?.cellArea)
	if (glintDensity === 0 || cellArea === 0) return 0
	const litFraction = litMicrofacetFraction({
		glintRoughness: options?.glintRoughness,
		baseRoughness: options?.baseRoughness,
	})
	return glintDensity * cellArea * litFraction
}


export function relativeStandardDeviationForCount(expectedCount) {
	const count = toNonNegativeNumber(expectedCount)
	return count === 0 ? 1 : 1 / Math.sqrt(count)
}


function samplePoissonCount(expectedCount, cellKey) {
	const limit = Math.exp(-expectedCount)
	let product = 1
	let count = 0
	while (count < SB_GLINT_COUNT_ITERATION_CEILING) {
		product *= hashCellToUnitFloat({ ...cellKey, streamIndex: count + 1 })
		if (product <= limit) break
		count += 1
	}
	return count
}


function sampleNormalApproximatedCount(expectedCount, cellKey) {
	const firstUniform = Math.max(hashCellToUnitFloat({ ...cellKey, streamIndex: 1 }), Number.EPSILON)
	const secondUniform = hashCellToUnitFloat({ ...cellKey, streamIndex: 2 })
	const gaussian = Math.sqrt(-2 * Math.log(firstUniform)) * Math.cos(2 * Math.PI * secondUniform)
	const count = Math.round(expectedCount + Math.sqrt(expectedCount) * gaussian)
	return Math.max(count, 0)
}


export function discreteMicrofacetCount(options) {
	const expectedCount = toNonNegativeNumber(options?.expectedCount)
	if (expectedCount === 0) return 0
	const cellKey = {
		cellX: options?.cellX,
		cellY: options?.cellY,
		level: options?.level,
		seed: options?.seed ?? SB_GLINT_DEFAULT_SEED,
	}
	if (expectedCount < SB_GLINT_NORMAL_APPROXIMATION_THRESHOLD) return samplePoissonCount(expectedCount, cellKey)
	return sampleNormalApproximatedCount(expectedCount, cellKey)
}


export function evaluateGlintResponse(options) {
	const smoothResponse = ggxNormalDistribution({
		roughness: options?.baseRoughness,
		halfVectorCosine: options?.halfVectorCosine,
	})
	const expectedCount = expectedMicrofacetCount({
		glintDensity: options?.glintDensity,
		glintRoughness: options?.glintRoughness,
		baseRoughness: options?.baseRoughness,
		cellArea: options?.cellArea,
	})
	if (expectedCount === 0) {
		return { response: smoothResponse, smoothResponse, ratio: 1, expectedCount: 0, microfacetCount: 0, isDiscrete: false }
	}
	const microfacetCount = discreteMicrofacetCount({
		expectedCount,
		cellX: options?.cellX,
		cellY: options?.cellY,
		level: options?.level,
		seed: options?.seed,
	})
	const ratio = microfacetCount / expectedCount
	return { response: smoothResponse * ratio, smoothResponse, ratio, expectedCount, microfacetCount, isDiscrete: true }
}
