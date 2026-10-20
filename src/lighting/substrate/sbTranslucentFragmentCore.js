import {
	SB_REFERENCE_THICKNESS,
	applyTransmittance,
	computeColoredTransmittance,
	normalizeTransmittanceColor,
} from "./sbTransmittanceCore.js"

const CHANNEL_INDEXES = [0, 1, 2]


export const SB_FULL_COVERAGE = 1

export const SB_FRAGMENT_ID_PREFIX = "fragment"

function clampToPositive(value) {
	if (!Number.isFinite(value)) return 0
	return value > 0 ? value : 0
}

function clampCoverage(value) {
	if (!Number.isFinite(value)) return SB_FULL_COVERAGE
	if (value > SB_FULL_COVERAGE) return SB_FULL_COVERAGE
	if (0 > value) return 0
	return value
}


export function normalizeRadianceColor(color) {
	if (typeof color === "number") {
		const grayChannel = clampToPositive(color)
		return [grayChannel, grayChannel, grayChannel]
	}
	if (!Array.isArray(color)) return [0, 0, 0]
	return CHANNEL_INDEXES.map((channelIndex) => clampToPositive(color[channelIndex]))
}


export function createTranslucentFragment(fragment, sequenceIndex) {
	const sequence = Number.isInteger(sequenceIndex) ? sequenceIndex : 0
	const hasExplicitId = typeof fragment?.id === "string" && fragment.id.length > 0
	return {
		id: hasExplicitId ? fragment.id : SB_FRAGMENT_ID_PREFIX + sequence,
		sequence,
		depth: Number.isFinite(fragment?.depth) ? fragment.depth : 0,
		color: normalizeRadianceColor(fragment?.color),
		coverage: clampCoverage(fragment?.coverage ?? fragment?.alpha ?? SB_FULL_COVERAGE),
		transmittanceColor: normalizeTransmittanceColor(fragment?.transmittanceColor),
		thickness: clampToPositive(fragment?.thickness ?? SB_REFERENCE_THICKNESS),
		cosThetaView: Number.isFinite(fragment?.cosThetaView) ? Math.abs(fragment.cosThetaView) : 1,
	}
}

export function normalizeTranslucentFragments(fragments) {
	if (!Array.isArray(fragments)) return []
	return fragments.map((fragment, index) => createTranslucentFragment(fragment, index))
}

export function fragmentTransmittance(fragment) {
	return computeColoredTransmittance(fragment)
}


export function fragmentThroughput(fragment) {
	const openFraction = SB_FULL_COVERAGE - fragment.coverage
	return applyTransmittance([openFraction, openFraction, openFraction], fragmentTransmittance(fragment))
}


export function fragmentEmission(fragment) {
	return fragment.color.map((channel) => channel * fragment.coverage)
}

export function fragmentIsOpaque(fragment) {
	return fragmentThroughput(fragment).every((channel) => channel === 0)
}


export function canonicalFragmentOrder(fragments) {
	return [...fragments].sort((left, right) => {
		if (left.id === right.id) return left.sequence - right.sequence
		return left.id > right.id ? 1 : -1
	})
}

export function fragmentOrderSignature(fragments) {
	return fragments.map((fragment) => fragment.id).join("|")
}
