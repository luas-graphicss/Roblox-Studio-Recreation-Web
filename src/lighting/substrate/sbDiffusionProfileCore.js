import { SB_GATES } from "./sbMaterialContract.js"

export const SB_DIFFUSION_PROFILE_ID = "burleyNormalizedDiffusion"


export const SB_DIFFUSION_COVERED_ENERGY = 0.995


export const SB_DEFAULT_SINGLE_SCATTERING_ALBEDO = 0.8


export const SB_NEGLIGIBLE_BIN_ENERGY = 0.005


export const SB_GATE_SAMPLE_COUNT = 32768
export const SB_GATE_BIN_COUNT = 8

const DEFAULT_KERNEL_SAMPLE_COUNT = 16
const INVERSE_CUMULATIVE_ITERATIONS = 48
const INVERSE_CUMULATIVE_RADIUS_FACTOR = 64
const REFERENCE_SUBSTEPS_PER_BIN = 32

function clampToUnitRange(value) {
	if (!Number.isFinite(value)) return 0
	return Math.min(1, Math.max(0, value))
}

function positiveCount(value, fallback) {
	const rounded = Math.floor(Number(value))
	if (!Number.isFinite(rounded) || 1 > rounded) return fallback
	return rounded
}

function sumOf(values) {
	return values.reduce((total, value) => total + value, 0)
}

function normalizeBins(bins) {
	const total = sumOf(bins)
	if (!(total > 0)) return bins
	return bins.map((value) => value / total)
}


export function burleyScalingFactor(singleScatteringAlbedo) {
	const albedo = clampToUnitRange(singleScatteringAlbedo ?? SB_DEFAULT_SINGLE_SCATTERING_ALBEDO)
	const distanceFromPeak = albedo - 0.8
	return 1.9 - albedo + 3.5 * distanceFromPeak * distanceFromPeak
}


export function shapingDistance(options) {
	const meanFreePathMillimeters = Number(options?.meanFreePathMillimeters)
	if (!Number.isFinite(meanFreePathMillimeters) || 0 >= meanFreePathMillimeters) return 0
	return meanFreePathMillimeters / burleyScalingFactor(options?.singleScatteringAlbedo)
}


export function radialProfile(radiusMillimeters, shapingDistanceMillimeters) {
	const shaping = shapingDistanceMillimeters
	const radius = radiusMillimeters
	if (!(shaping > 0) || !(radius > 0)) return 0
	return (Math.exp(-radius / shaping) + Math.exp(-radius / (3 * shaping))) / (8 * Math.PI * shaping * radius)
}


export function radialDensity(radiusMillimeters, shapingDistanceMillimeters) {
	const shaping = shapingDistanceMillimeters
	if (!(shaping > 0)) return 0
	const radius = Math.max(0, radiusMillimeters)
	return (Math.exp(-radius / shaping) + Math.exp(-radius / (3 * shaping))) / (4 * shaping)
}


export function cumulativeProfile(radiusMillimeters, shapingDistanceMillimeters) {
	const shaping = shapingDistanceMillimeters
	if (!(shaping > 0)) return 1
	const radius = Math.max(0, radiusMillimeters)
	return 1 - 0.25 * Math.exp(-radius / shaping) - 0.75 * Math.exp(-radius / (3 * shaping))
}


export function inverseCumulativeProfile(coveredEnergy, shapingDistanceMillimeters) {
	const shaping = shapingDistanceMillimeters
	if (!(shaping > 0)) return 0
	const target = clampToUnitRange(coveredEnergy)
	let lowRadius = 0
	let highRadius = INVERSE_CUMULATIVE_RADIUS_FACTOR * shaping
	for (let iteration = 0; iteration !== INVERSE_CUMULATIVE_ITERATIONS; iteration += 1) {
		const middleRadius = (lowRadius + highRadius) / 2
		if (cumulativeProfile(middleRadius, shaping) > target) highRadius = middleRadius
		else lowRadius = middleRadius
	}
	return (lowRadius + highRadius) / 2
}


export function maximumDiffusionRadius(shapingDistanceMillimeters, coveredEnergy) {
	return inverseCumulativeProfile(coveredEnergy ?? SB_DIFFUSION_COVERED_ENERGY, shapingDistanceMillimeters)
}


export function buildSeparableKernel(options) {
	const shapingDistanceMillimeters = shapingDistance(options)
	const coveredEnergy = clampToUnitRange(options?.coveredEnergy ?? SB_DIFFUSION_COVERED_ENERGY)
	const sampleCount = positiveCount(options?.sampleCount, DEFAULT_KERNEL_SAMPLE_COUNT)

	if (!(shapingDistanceMillimeters > 0)) {
		return {
			profileId: SB_DIFFUSION_PROFILE_ID,
			diffuses: false,
			shapingDistanceMillimeters: 0,
			maximumRadiusMillimeters: 0,
			offsetsMillimeters: [0],
			weights: [1],
			weightSum: 1,
			sampleCount: 1,
			coveredEnergy: 1,
		}
	}

	const offsetsMillimeters = []
	const weights = []
	const sampleWeight = 1 / sampleCount
	for (let index = 0; index !== sampleCount; index += 1) {
		const stratumCenter = (index + 0.5) / sampleCount
		offsetsMillimeters.push(inverseCumulativeProfile(stratumCenter * coveredEnergy, shapingDistanceMillimeters))
		weights.push(sampleWeight)
	}

	return {
		profileId: SB_DIFFUSION_PROFILE_ID,
		diffuses: true,
		shapingDistanceMillimeters,
		maximumRadiusMillimeters: maximumDiffusionRadius(shapingDistanceMillimeters, coveredEnergy),
		offsetsMillimeters,
		weights,
		weightSum: sumOf(weights),
		sampleCount,
		coveredEnergy,
	}
}


export function measureRadialProfile(options) {
	const kernel = options?.kernel
	const binCount = positiveCount(options?.binCount, SB_GATE_BIN_COUNT)
	const maximumRadiusMillimeters = Number(options?.maximumRadiusMillimeters ?? kernel?.maximumRadiusMillimeters ?? 0)
	const bins = new Array(binCount).fill(0)
	if (!kernel || !(maximumRadiusMillimeters > 0)) {
		bins[0] = 1
		return bins
	}
	const binWidth = maximumRadiusMillimeters / binCount
	for (let index = 0; index !== kernel.offsetsMillimeters.length; index += 1) {
		const binIndex = Math.min(binCount - 1, Math.floor(kernel.offsetsMillimeters[index] / binWidth))
		bins[binIndex] += kernel.weights[index]
	}
	return normalizeBins(bins)
}


export function buildOfflineReferenceProfile(options) {
	const shapingDistanceMillimeters = Number(options?.shapingDistanceMillimeters ?? shapingDistance(options))
	const binCount = positiveCount(options?.binCount, SB_GATE_BIN_COUNT)
	const maximumRadiusMillimeters = Number(
		options?.maximumRadiusMillimeters ?? maximumDiffusionRadius(shapingDistanceMillimeters, options?.coveredEnergy),
	)
	const bins = new Array(binCount).fill(0)
	if (!(shapingDistanceMillimeters > 0) || !(maximumRadiusMillimeters > 0)) {
		bins[0] = 1
		return bins
	}
	const binWidth = maximumRadiusMillimeters / binCount
	const substepWidth = binWidth / REFERENCE_SUBSTEPS_PER_BIN
	for (let binIndex = 0; binIndex !== binCount; binIndex += 1) {
		let integratedEnergy = 0
		for (let substep = 0; substep !== REFERENCE_SUBSTEPS_PER_BIN; substep += 1) {
			const radius = binIndex * binWidth + (substep + 0.5) * substepWidth
			integratedEnergy += radialDensity(radius, shapingDistanceMillimeters) * substepWidth
		}
		bins[binIndex] = integratedEnergy
	}
	return normalizeBins(bins)
}


export function findRadialProfileDeviation(measuredBins, referenceBins) {
	const binCount = Math.min(measuredBins.length, referenceBins.length)
	let worstDeviation = 0
	let worstBinIndex = -1
	let comparedBinCount = 0
	for (let binIndex = 0; binIndex !== binCount; binIndex += 1) {
		const referenceEnergy = referenceBins[binIndex]
		if (SB_NEGLIGIBLE_BIN_ENERGY > referenceEnergy) continue
		comparedBinCount += 1
		const deviation = Math.abs(measuredBins[binIndex] - referenceEnergy) / referenceEnergy
		if (deviation > worstDeviation) {
			worstDeviation = deviation
			worstBinIndex = binIndex
		}
	}
	return { deviation: worstDeviation, worstBinIndex, comparedBinCount }
}


export function evaluateRadialProfileGate(options) {
	const binCount = positiveCount(options?.binCount, SB_GATE_BIN_COUNT)
	const kernel = buildSeparableKernel({
		meanFreePathMillimeters: options?.meanFreePathMillimeters,
		singleScatteringAlbedo: options?.singleScatteringAlbedo,
		coveredEnergy: options?.coveredEnergy,
		sampleCount: positiveCount(options?.sampleCount, SB_GATE_SAMPLE_COUNT),
	})
	const measuredBins = measureRadialProfile({ kernel, binCount })
	const referenceBins = buildOfflineReferenceProfile({
		shapingDistanceMillimeters: kernel.shapingDistanceMillimeters,
		maximumRadiusMillimeters: kernel.maximumRadiusMillimeters,
		binCount,
	})
	const worst = findRadialProfileDeviation(measuredBins, referenceBins)
	const limit = SB_GATES.maxDiffusionProfileDeviation
	return {
		gate: "maxDiffusionProfileDeviation",
		limit,
		deviation: worst.deviation,
		worstBinIndex: worst.worstBinIndex,
		comparedBinCount: worst.comparedBinCount,
		binCount,
		sampleCount: kernel.sampleCount,
		shapingDistanceMillimeters: kernel.shapingDistanceMillimeters,
		maximumRadiusMillimeters: kernel.maximumRadiusMillimeters,
		measuredBins,
		referenceBins,
		passed: limit >= worst.deviation,
	}
}


export function edgeAwareWeight(options) {
	const diffusionRadiusMillimeters = Number(options?.diffusionRadiusMillimeters)
	if (!(diffusionRadiusMillimeters > 0)) return 0
	const depthDifference = Math.abs(Number(options?.depthDifferenceMillimeters))
	if (!Number.isFinite(depthDifference)) return 0
	if (depthDifference >= diffusionRadiusMillimeters) return 0
	const remaining = 1 - depthDifference / diffusionRadiusMillimeters
	return remaining * remaining
}


export function rejectSilhouetteLeakage(options) {
	const weights = Array.isArray(options?.weights) ? options.weights : []
	const depthDifferences = Array.isArray(options?.depthDifferencesMillimeters)
		? options.depthDifferencesMillimeters
		: []
	const diffusionRadiusMillimeters = Number(options?.diffusionRadiusMillimeters)
	const centerIndex = Number.isInteger(options?.centerIndex) ? options.centerIndex : 0

	const acceptedWeights = weights.map((weight, index) => {
		if (index === centerIndex) return weight
		return (
			weight *
			edgeAwareWeight({
				depthDifferenceMillimeters: depthDifferences[index],
				diffusionRadiusMillimeters,
			})
		)
	})

	const leakedWeight = weights.reduce((total, weight, index) => {
		if (index === centerIndex) return total
		return total + (weight - acceptedWeights[index])
	}, 0)

	const renormalizedWeights = acceptedWeights.slice()
	if (renormalizedWeights.length > centerIndex) renormalizedWeights[centerIndex] += leakedWeight

	return {
		acceptedWeights,
		renormalizedWeights,
		leakedWeight,
		weightSum: sumOf(renormalizedWeights),
	}
}


export function describeDiffusionProfile(options) {
	const kernel = buildSeparableKernel(options)
	return {
		profileId: kernel.profileId,
		diffuses: kernel.diffuses,
		meanFreePathMillimeters: Number(options?.meanFreePathMillimeters ?? 0),
		singleScatteringAlbedo: clampToUnitRange(options?.singleScatteringAlbedo ?? SB_DEFAULT_SINGLE_SCATTERING_ALBEDO),
		scalingFactor: burleyScalingFactor(options?.singleScatteringAlbedo),
		shapingDistanceMillimeters: kernel.shapingDistanceMillimeters,
		maximumRadiusMillimeters: kernel.maximumRadiusMillimeters,
		sampleCount: kernel.sampleCount,
		weightSum: kernel.weightSum,
		coveredEnergy: kernel.coveredEnergy,
	}
}
