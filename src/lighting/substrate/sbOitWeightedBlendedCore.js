import { SB_CLEAR_TRANSMITTANCE } from "./sbTransmittanceCore.js"
import {
	canonicalFragmentOrder,
	fragmentEmission,
	fragmentThroughput,
	normalizeRadianceColor,
	normalizeTranslucentFragments,
} from "./sbTranslucentFragmentCore.js"

export const SB_WEIGHTED_BLENDED_MODE = "weightedBlended"


export const SB_WEIGHTED_BLENDED_DEPTH_SCALE = 200

export const SB_WEIGHTED_BLENDED_WEIGHT_MINIMUM = 1e-2
export const SB_WEIGHTED_BLENDED_WEIGHT_MAXIMUM = 3e3


export const SB_MINIMUM_ACCUMULATED_WEIGHT = 1e-5

const CHANNEL_INDEXES = [0, 1, 2]
const WEIGHT_NUMERATOR = 0.03
const WEIGHT_FALLOFF_EXPONENT = 4


export function weightForDepthAndCoverage(depth, coverage) {
	const safeDepth = Number.isFinite(depth) ? Math.abs(depth) : 0
	const normalizedDepth = safeDepth / SB_WEIGHTED_BLENDED_DEPTH_SCALE
	const falloff =
		WEIGHT_NUMERATOR / (SB_MINIMUM_ACCUMULATED_WEIGHT + Math.pow(normalizedDepth, WEIGHT_FALLOFF_EXPONENT))
	const weight = coverage * falloff
	if (weight > SB_WEIGHTED_BLENDED_WEIGHT_MAXIMUM) return SB_WEIGHTED_BLENDED_WEIGHT_MAXIMUM
	if (SB_WEIGHTED_BLENDED_WEIGHT_MINIMUM > weight) return SB_WEIGHTED_BLENDED_WEIGHT_MINIMUM
	return weight
}


export function accumulateWeightedFragments(fragments) {
	const weightedColorSum = [0, 0, 0]
	const revealage = [...SB_CLEAR_TRANSMITTANCE]
	let weightSum = 0

	for (const fragment of canonicalFragmentOrder(fragments)) {
		const weight = weightForDepthAndCoverage(fragment.depth, fragment.coverage)
		const emission = fragmentEmission(fragment)
		const throughput = fragmentThroughput(fragment)
		for (const channelIndex of CHANNEL_INDEXES) {
			weightedColorSum[channelIndex] += emission[channelIndex] * weight
			revealage[channelIndex] *= throughput[channelIndex]
		}
		weightSum += fragment.coverage * weight
	}

	return { weightedColorSum, weightSum, revealage }
}


export function resolveWeightedBlended(options) {
	const backgroundColor = normalizeRadianceColor(options?.backgroundColor)
	const fragments = normalizeTranslucentFragments(options?.fragments)

	if (fragments.length === 0) {
		return {
			mode: SB_WEIGHTED_BLENDED_MODE,
			color: backgroundColor,
			revealage: [...SB_CLEAR_TRANSMITTANCE],
			weightSum: 0,
			fragmentCount: 0,
			orderIndependent: true,
			touchedBackground: false,
		}
	}

	const accumulation = accumulateWeightedFragments(fragments)
	const safeWeightSum = Math.max(accumulation.weightSum, SB_MINIMUM_ACCUMULATED_WEIGHT)
	const color = CHANNEL_INDEXES.map((channelIndex) => {
		const averageChannel = accumulation.weightedColorSum[channelIndex] / safeWeightSum
		const revealageChannel = accumulation.revealage[channelIndex]
		return averageChannel * (1 - revealageChannel) + backgroundColor[channelIndex] * revealageChannel
	})

	return {
		mode: SB_WEIGHTED_BLENDED_MODE,
		color,
		revealage: accumulation.revealage,
		weightSum: accumulation.weightSum,
		fragmentCount: fragments.length,
		orderIndependent: true,
		touchedBackground: true,
	}
}
