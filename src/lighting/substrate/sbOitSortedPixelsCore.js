import { SB_CLEAR_TRANSMITTANCE, multiplyTransmittance } from "./sbTransmittanceCore.js"
import {
	SB_FULL_COVERAGE,
	fragmentEmission,
	fragmentOrderSignature,
	fragmentThroughput,
	fragmentTransmittance,
	normalizeRadianceColor,
	normalizeTranslucentFragments,
} from "./sbTranslucentFragmentCore.js"

export const SB_SORTED_PIXELS_MODE = "sortedPixels"


export const SB_MAX_SORTED_FRAGMENTS_PER_PIXEL = 8

const CHANNEL_INDEXES = [0, 1, 2]
const MINIMUM_MERGED_COVERAGE = 1e-6


export function sortFragmentsBackToFront(fragments) {
	return [...fragments].sort((left, right) => {
		if (left.depth === right.depth) return left.sequence - right.sequence
		return right.depth - left.depth
	})
}


export function mergeFarFragmentsByTailBlend(farFragments) {
	let openFraction = 1
	let mergedTransmittance = [...SB_CLEAR_TRANSMITTANCE]
	const emissionSum = [0, 0, 0]
	let farthestDepth = -Infinity
	const mergedIds = []

	for (const fragment of farFragments) {
		openFraction *= SB_FULL_COVERAGE - fragment.coverage
		mergedTransmittance = multiplyTransmittance(mergedTransmittance, fragmentTransmittance(fragment))
		const emission = fragmentEmission(fragment)
		for (const channelIndex of CHANNEL_INDEXES) emissionSum[channelIndex] += emission[channelIndex]
		if (fragment.depth > farthestDepth) farthestDepth = fragment.depth
		mergedIds.push(fragment.id)
	}

	const mergedCoverage = SB_FULL_COVERAGE - openFraction
	const mergedColor =
		mergedCoverage > MINIMUM_MERGED_COVERAGE ? emissionSum.map((channel) => channel / mergedCoverage) : [0, 0, 0]

	return {
		id: mergedIds.join("+"),
		sequence: farFragments[0]?.sequence ?? 0,
		depth: farthestDepth,
		color: mergedColor,
		coverage: mergedCoverage,
		transmittanceColor: mergedTransmittance,
		thickness: 1,
		cosThetaView: 1,
	}
}


export function foldFragmentsToBudget(sortedFragments, maxFragments) {
	const budget =
		Number.isInteger(maxFragments) && maxFragments > 0 ? maxFragments : SB_MAX_SORTED_FRAGMENTS_PER_PIXEL
	if (budget >= sortedFragments.length) return { fragments: sortedFragments, overflowCount: 0 }
	const tailLength = sortedFragments.length - budget + 1
	const tail = sortedFragments.slice(0, tailLength)
	const kept = sortedFragments.slice(tailLength)
	return {
		fragments: [mergeFarFragmentsByTailBlend(tail), ...kept],
		overflowCount: sortedFragments.length - budget,
	}
}


export function compositeFragmentOverBehind(fragment, behindColor) {
	const emission = fragmentEmission(fragment)
	const throughput = fragmentThroughput(fragment)
	return CHANNEL_INDEXES.map((channelIndex) => emission[channelIndex] + behindColor[channelIndex] * throughput[channelIndex])
}


export function resolveSortedPixels(options) {
	const backgroundColor = normalizeRadianceColor(options?.backgroundColor)
	const fragments = normalizeTranslucentFragments(options?.fragments)

	if (fragments.length === 0) {
		return {
			mode: SB_SORTED_PIXELS_MODE,
			color: backgroundColor,
			order: "",
			orderedIds: [],
			fragmentCount: 0,
			overflowCount: 0,
			throughput: [...SB_CLEAR_TRANSMITTANCE],
			touchedBackground: false,
		}
	}

	const sortedFragments = sortFragmentsBackToFront(fragments)
	const budgeted = foldFragmentsToBudget(sortedFragments, options?.maxFragments)

	let color = backgroundColor
	let throughput = [...SB_CLEAR_TRANSMITTANCE]
	for (const fragment of budgeted.fragments) {
		color = compositeFragmentOverBehind(fragment, color)
		throughput = multiplyTransmittance(throughput, fragmentThroughput(fragment))
	}

	return {
		mode: SB_SORTED_PIXELS_MODE,
		color,
		order: fragmentOrderSignature(budgeted.fragments),
		orderedIds: budgeted.fragments.map((fragment) => fragment.id),
		fragmentCount: fragments.length,
		overflowCount: budgeted.overflowCount,
		throughput,
		touchedBackground: true,
	}
}
