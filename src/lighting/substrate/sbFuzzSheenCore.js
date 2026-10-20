const TAU = Math.PI * 2
const RECIPROCAL_PI = 1 / Math.PI


export const SB_FUZZ_SHEEN_QUALITY_LEVELS = ["low", "high"]


export const SB_SHEEN_MINIMUM_ROUGHNESS = 0.07


export const SB_SHEEN_VISIBILITY_FLOOR = 1e-4


export const SB_SHEEN_ENERGY_FLOOR = 0.05


export const SB_SHEEN_QUADRATURE_POLAR_STEPS = 48
export const SB_SHEEN_QUADRATURE_AZIMUTH_STEPS = 48


export const SB_SHEEN_CERTIFICATION_POLAR_STEPS = 96
export const SB_SHEEN_CERTIFICATION_AZIMUTH_STEPS = 96


export const SB_SHEEN_CERTIFICATION_VIEW_COSINES = [0.04, 0.23, 0.51, 0.78, 0.97]
export const SB_SHEEN_CERTIFICATION_ROUGHNESSES = [0.09, 0.28, 0.52, 0.81, 0.96]


export const SB_COSINE_LOBE_MEAN_LENGTH = 2 / 3

export const SB_SHEEN_LTC_MINIMUM_SCALE = 0.05
export const SB_SHEEN_LTC_MAXIMUM_SCALE = 4
export const SB_SHEEN_LTC_MAXIMUM_SKEW = 2


export const SB_SHEEN_MAXIMUM_FORWARD_MIX = 0.75
export const SB_SHEEN_FORWARD_EXPONENT = 4


export const SB_FUZZ_SHEEN_QUALITY_COST_GATE = 0.6


export const SB_FUZZ_COLOR_QUANTIZATION_STEPS = 255


export const SB_SHEEN_COST_WEIGHTS = Object.freeze({
	arithmetic: 1,
	transcendental: 8,
	textureFetch: 16,
})

export function clampToUnitRange(value) {
	const numeric = Number(value)
	if (!Number.isFinite(numeric)) return 0
	if (numeric < 0) return 0
	if (numeric > 1) return 1
	return numeric
}

function clampToRange(value, minimum, maximum) {
	const numeric = Number(value)
	if (!Number.isFinite(numeric)) return minimum
	return Math.min(Math.max(numeric, minimum), maximum)
}


export function sheenRoughnessFor(rawRoughness) {
	return Math.max(clampToUnitRange(rawRoughness), SB_SHEEN_MINIMUM_ROUGHNESS)
}


export function normalizeFuzzParameters(rawParameters) {
	const rawColor = rawParameters?.fuzzColor ?? [1, 1, 1]
	return {
		fuzzAmount: clampToUnitRange(rawParameters?.fuzzAmount ?? 0),
		fuzzRoughness: clampToUnitRange(rawParameters?.fuzzRoughness ?? SB_SHEEN_MINIMUM_ROUGHNESS),
		fuzzColor: [clampToUnitRange(rawColor[0]), clampToUnitRange(rawColor[1]), clampToUnitRange(rawColor[2])],
	}
}


export function packFuzzColorToFloat(fuzzColor) {
	const steps = SB_FUZZ_COLOR_QUANTIZATION_STEPS
	const redChannel = Math.round(clampToUnitRange(fuzzColor?.[0]) * steps)
	const greenChannel = Math.round(clampToUnitRange(fuzzColor?.[1]) * steps)
	const blueChannel = Math.round(clampToUnitRange(fuzzColor?.[2]) * steps)
	return redChannel * 65536 + greenChannel * 256 + blueChannel
}

export function unpackFuzzColorFromFloat(packedFuzzColor) {
	const packed = Math.max(0, Math.round(Number(packedFuzzColor) || 0))
	const steps = SB_FUZZ_COLOR_QUANTIZATION_STEPS
	const blueChannel = packed % 256
	const greenChannel = Math.floor(packed / 256) % 256
	const redChannel = Math.floor(packed / 65536)
	return [redChannel / steps, greenChannel / steps, blueChannel / steps]
}


export function fuzzQualityCode(qualityLevel) {
	return qualityLevel === "high" ? 1 : 0
}

export function fuzzQualityFromCode(qualityCode) {
	return Number(qualityCode) >= 0.5 ? "high" : "low"
}


export function viewDirectionFromCosine(viewCosine) {
	const cosine = clampToUnitRange(viewCosine)
	return { x: Math.sqrt(Math.max(1 - cosine * cosine, 0)), y: 0, z: cosine }
}


export function evaluateSheenDistribution(halfVectorCosine, rawRoughness) {
	const inverseRoughness = 1 / sheenRoughnessFor(rawRoughness)
	const halfCosine = clampToUnitRange(halfVectorCosine)
	const halfSineSquared = Math.max(1 - halfCosine * halfCosine, SB_SHEEN_VISIBILITY_FLOOR)
	return ((2 + inverseRoughness) * Math.pow(halfSineSquared, inverseRoughness * 0.5)) / TAU
}


export function evaluateSheenVisibility(viewCosine, lightCosine) {
	const view = clampToUnitRange(viewCosine)
	const light = clampToUnitRange(lightCosine)
	const denominator = 4 * (light + view - light * view)
	return 1 / Math.max(denominator, SB_SHEEN_VISIBILITY_FLOOR)
}


export function evaluateReferenceSheenLobe(options) {
	const viewDirection = options.viewDirection
	const lightDirection = options.lightDirection
	const lightCosine = clampToUnitRange(lightDirection.z)
	if (lightCosine <= 0) return 0
	const halfX = lightDirection.x + viewDirection.x
	const halfY = lightDirection.y + viewDirection.y
	const halfZ = lightDirection.z + viewDirection.z
	const halfLength = Math.sqrt(halfX * halfX + halfY * halfY + halfZ * halfZ)
	if (halfLength <= 0) return 0
	const distribution = evaluateSheenDistribution(halfZ / halfLength, options.sheenRoughness)
	const visibility = evaluateSheenVisibility(viewDirection.z, lightCosine)
	return distribution * visibility * lightCosine
}


export function integrateSheenLobeStatistics(options) {
	const viewCosine = clampToUnitRange(options?.viewCosine ?? 1)
	const sheenRoughness = sheenRoughnessFor(options?.sheenRoughness)
	const polarSteps = Math.max(2, Math.round(options?.polarSteps ?? SB_SHEEN_QUADRATURE_POLAR_STEPS))
	const azimuthSteps = Math.max(2, Math.round(options?.azimuthSteps ?? SB_SHEEN_QUADRATURE_AZIMUTH_STEPS))
	const viewDirection = viewDirectionFromCosine(viewCosine)
	const solidAngleWeight = TAU / (polarSteps * azimuthSteps)

	let albedo = 0
	let momentX = 0
	let momentZ = 0

	for (let polarIndex = 0; polarIndex < polarSteps; polarIndex += 1) {
		const lightCosine = (polarIndex + 0.5) / polarSteps
		const lightSine = Math.sqrt(Math.max(1 - lightCosine * lightCosine, 0))
		for (let azimuthIndex = 0; azimuthIndex < azimuthSteps; azimuthIndex += 1) {
			const azimuth = (TAU * (azimuthIndex + 0.5)) / azimuthSteps
			const lightDirection = {
				x: lightSine * Math.cos(azimuth),
				y: lightSine * Math.sin(azimuth),
				z: lightCosine,
			}
			const weightedLobe = evaluateReferenceSheenLobe({ viewDirection, lightDirection, sheenRoughness }) * solidAngleWeight
			albedo += weightedLobe
			momentX += weightedLobe * lightDirection.x
			momentZ += weightedLobe * lightDirection.z
		}
	}

	const meanX = albedo > 0 ? momentX / albedo : 0
	const meanZ = albedo > 0 ? momentZ / albedo : 1
	return {
		viewCosine,
		sheenRoughness,
		albedo,
		meanX,
		meanZ,
		meanLength: Math.sqrt(meanX * meanX + meanZ * meanZ),
	}
}


export function fitSheenLtcFromStatistics(statistics) {
	const meanLength = Math.max(statistics?.meanLength ?? 0, 1e-6)
	const ltcScale = clampToRange(meanLength / SB_COSINE_LOBE_MEAN_LENGTH, SB_SHEEN_LTC_MINIMUM_SCALE, SB_SHEEN_LTC_MAXIMUM_SCALE)
	const meanZ = Math.max(statistics?.meanZ ?? 1, 1e-3)
	const rawSkew = -ltcScale * ((statistics?.meanX ?? 0) / meanZ)
	return {
		albedo: clampToUnitRange(statistics?.albedo ?? 0),
		ltcScale,
		ltcSkew: clampToRange(rawSkew, -SB_SHEEN_LTC_MAXIMUM_SKEW, SB_SHEEN_LTC_MAXIMUM_SKEW),
		meanLength,
	}
}


export function evaluateSheenLtcDistribution(options) {
	const lightDirection = options.lightDirection
	const ltcScale = options.ltcScale
	const ltcSkew = options.ltcSkew
	const transformedZ = lightDirection.z
	if (transformedZ <= 0) return 0
	const transformedX = ltcScale * lightDirection.x + ltcSkew * lightDirection.z
	const transformedY = ltcScale * lightDirection.y
	const lengthSquared = Math.max(transformedX * transformedX + transformedY * transformedY + transformedZ * transformedZ, 1e-12)
	return (transformedZ * ltcScale * ltcScale * RECIPROCAL_PI) / (lengthSquared * lengthSquared)
}


export function sheenLtcDominantDirection(options) {
	const ltcScale = Math.max(options?.ltcScale ?? 1, 1e-6)
	const ltcSkew = options?.ltcSkew ?? 0
	const length = Math.sqrt(ltcSkew * ltcSkew + ltcScale * ltcScale)
	return { x: -ltcSkew / length, z: ltcScale / length }
}


export function sheenForwardMix(options) {
	const sheenSmoothness = 1 - clampToUnitRange(options?.sheenRoughness ?? 1)
	const dominantAlignment = clampToUnitRange(options?.dominantAlignment ?? 0)
	return SB_SHEEN_MAXIMUM_FORWARD_MIX * sheenSmoothness * Math.pow(dominantAlignment, SB_SHEEN_FORWARD_EXPONENT)
}


export function evaluateFuzzSheenResponse(options) {
	const fuzzAmount = clampToUnitRange(options?.fuzzAmount ?? 0)
	const sheenAlbedo = clampToUnitRange(options?.tableSample?.albedo ?? 0)
	const ambientRadiance = Math.max(Number(options?.ambientRadiance ?? 0) || 0, 0)
	if (fuzzAmount <= 0 || sheenAlbedo <= 0) return 0
	if (options?.quality !== "high") return fuzzAmount * sheenAlbedo * ambientRadiance

	const environmentRadiance = Math.max(Number(options?.environmentRadiance ?? ambientRadiance) || 0, 0)
	const forwardMix = sheenForwardMix({
		sheenRoughness: options?.sheenRoughness,
		dominantAlignment: options?.dominantAlignment,
	})
	const shapedRadiance = ambientRadiance + (environmentRadiance - ambientRadiance) * forwardMix
	return fuzzAmount * sheenAlbedo * shapedRadiance
}


export function certifyFuzzSheenEnergy(options) {
	const sampleTable = options.sampleTable
	const tolerance = options?.gates?.maxSheenEnergyDeviation ?? 0.03
	const viewCosines = options?.viewCosines ?? SB_SHEEN_CERTIFICATION_VIEW_COSINES
	const sheenRoughnesses = options?.sheenRoughnesses ?? SB_SHEEN_CERTIFICATION_ROUGHNESSES
	const polarSteps = options?.polarSteps ?? SB_SHEEN_CERTIFICATION_POLAR_STEPS
	const azimuthSteps = options?.azimuthSteps ?? SB_SHEEN_CERTIFICATION_AZIMUTH_STEPS

	const entries = []
	let worstDeviation = 0
	let worstEntry = null

	for (const sheenRoughness of sheenRoughnesses) {
		for (const viewCosine of viewCosines) {
			const reference = integrateSheenLobeStatistics({ viewCosine, sheenRoughness, polarSteps, azimuthSteps })
			const referenceAlbedo = clampToUnitRange(reference.albedo)
			const allowedDeviation = tolerance * Math.max(referenceAlbedo, SB_SHEEN_ENERGY_FLOOR)
			const tableSample = sampleTable(viewCosine, sheenRoughness)
			for (const quality of SB_FUZZ_SHEEN_QUALITY_LEVELS) {
				const modelledAlbedo = evaluateFuzzSheenResponse({
					quality,
					tableSample,
					fuzzAmount: 1,
					ambientRadiance: 1,
					environmentRadiance: 1,
					sheenRoughness,
					dominantAlignment: 1,
				})
				const deviation = Math.abs(modelledAlbedo - referenceAlbedo)
				const entry = {
					quality,
					viewCosine,
					sheenRoughness,
					referenceAlbedo,
					modelledAlbedo,
					deviation,
					allowedDeviation,
					ok: deviation <= allowedDeviation,
				}
				entries.push(entry)
				if (deviation > worstDeviation) {
					worstDeviation = deviation
					worstEntry = entry
				}
			}
		}
	}

	const failures = entries.filter((entry) => !entry.ok)
	return { ok: failures.length === 0, tolerance, worstDeviation, worstEntry, failures, entries }
}


export function certifyFuzzSheenGrazing(options) {
	const sampleTable = options.sampleTable
	const viewCosines = options?.viewCosines ?? [1e-6, 1e-4, 0.01, 0.5, 1]
	const sheenRoughnesses = options?.sheenRoughnesses ?? [0, SB_SHEEN_MINIMUM_ROUGHNESS, 0.5, 1]
	const environmentRadiance = 2
	const entries = []

	for (const sheenRoughness of sheenRoughnesses) {
		for (const viewCosine of viewCosines) {
			const tableSample = sampleTable(viewCosine, sheenRoughness)
			const referenceLobe = evaluateReferenceSheenLobe({
				viewDirection: viewDirectionFromCosine(viewCosine),
				lightDirection: { x: 1, y: 0, z: 1e-6 },
				sheenRoughness,
			})
			for (const quality of SB_FUZZ_SHEEN_QUALITY_LEVELS) {
				const response = evaluateFuzzSheenResponse({
					quality,
					tableSample,
					fuzzAmount: 1,
					ambientRadiance: 1,
					environmentRadiance,
					sheenRoughness,
					dominantAlignment: 1,
				})
				const finite = Number.isFinite(response) && Number.isFinite(referenceLobe)
				entries.push({
					quality,
					viewCosine,
					sheenRoughness,
					response,
					referenceLobe,
					ok: finite && response >= 0 && referenceLobe >= 0 && response <= environmentRadiance,
				})
			}
		}
	}

	const failures = entries.filter((entry) => !entry.ok)
	return { ok: failures.length === 0, failures, entries }
}

function stripShaderComments(shaderSource) {
	return String(shaderSource ?? "")
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/\/\/[^\n]*/g, " ")
}

function countMatches(text, pattern) {
	const matches = text.match(pattern)
	return matches ? matches.length : 0
}

const TEXTURE_FETCH_PATTERN = /\b(texture2D|textureLod|texture)\s*\(/g
const TRANSCENDENTAL_PATTERN = /\b(pow|sqrt|inversesqrt|normalize|length|distance|exp|exp2|log|log2|sin|cos|tan|asin|acos|atan)\s*\(/g
const ARITHMETIC_CALL_PATTERN = /\b(dot|cross|mix|clamp|min|max|abs|floor|ceil|mod|fract|sign|step|smoothstep|reflect|saturate)\s*\(/g
const ARITHMETIC_OPERATOR_PATTERN = /[+\-*/]/g


export function measureShaderOperationCost(shaderSource) {
	const source = stripShaderComments(shaderSource)
	const textureFetches = countMatches(source, TEXTURE_FETCH_PATTERN)
	const transcendentals = countMatches(source, TRANSCENDENTAL_PATTERN)
	const arithmetic = countMatches(source, ARITHMETIC_CALL_PATTERN) + countMatches(source, ARITHMETIC_OPERATOR_PATTERN)
	const cost =
		textureFetches * SB_SHEEN_COST_WEIGHTS.textureFetch +
		transcendentals * SB_SHEEN_COST_WEIGHTS.transcendental +
		arithmetic * SB_SHEEN_COST_WEIGHTS.arithmetic
	return { textureFetches, transcendentals, arithmetic, cost }
}


export function measureFuzzSheenQualityCost(sources) {
	const sharedCost =
		measureShaderOperationCost(sources?.sharedHelpers).cost +
		measureShaderOperationCost(sources?.callSite).cost +
		measureShaderOperationCost(sources?.lowQuality).cost
	const highQualityCost = measureShaderOperationCost(sources?.highQuality).cost
	const lowTotalCost = sharedCost
	const highTotalCost = sharedCost + highQualityCost
	const costRatio = highTotalCost > 0 ? lowTotalCost / highTotalCost : 1
	return {
		sharedCost,
		highQualityCost,
		lowTotalCost,
		highTotalCost,
		costRatio,
		gate: SB_FUZZ_SHEEN_QUALITY_COST_GATE,
		ok: costRatio <= SB_FUZZ_SHEEN_QUALITY_COST_GATE,
	}
}
