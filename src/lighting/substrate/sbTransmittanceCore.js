export const SB_TRANSMITTANCE_CHANNEL_COUNT = 3


export const SB_REFERENCE_THICKNESS = 1


export const SB_MINIMUM_CHANNEL_TRANSMITTANCE = 1e-6


export const SB_MINIMUM_VIEW_COSINE = 1e-3


export const SB_CLEAR_TRANSMITTANCE = [1, 1, 1]


export const SB_OPAQUE_TRANSMITTANCE = [0, 0, 0]

const CHANNEL_INDEXES = [0, 1, 2]

function clampToUnitInterval(value) {
	if (!Number.isFinite(value)) return 0
	if (value > 1) return 1
	if (0 > value) return 0
	return value
}

function clampToPositive(value) {
	if (!Number.isFinite(value)) return 0
	return value > 0 ? value : 0
}


export function normalizeTransmittanceColor(transmittanceColor) {
	if (typeof transmittanceColor === "number") {
		const grayChannel = clampToUnitInterval(transmittanceColor)
		return [grayChannel, grayChannel, grayChannel]
	}
	if (!Array.isArray(transmittanceColor)) return [...SB_CLEAR_TRANSMITTANCE]
	return CHANNEL_INDEXES.map((channelIndex) => clampToUnitInterval(transmittanceColor[channelIndex] ?? 1))
}


export function absorbanceFromTransmittanceColor(transmittanceColor) {
	return normalizeTransmittanceColor(transmittanceColor).map((channel) =>
		-Math.log(Math.max(channel, SB_MINIMUM_CHANNEL_TRANSMITTANCE)),
	)
}


export function transmittanceFromAbsorbance(absorbance, pathLength) {
	const opticalDistance = clampToPositive(pathLength)
	return CHANNEL_INDEXES.map((channelIndex) =>
		clampToUnitInterval(Math.exp(-clampToPositive(absorbance?.[channelIndex]) * opticalDistance)),
	)
}


export function viewPathLength(thickness, cosThetaView) {
	const straightPath = clampToPositive(thickness)
	const cosine = Number.isFinite(cosThetaView) ? Math.abs(cosThetaView) : 1
	return straightPath / Math.max(cosine, SB_MINIMUM_VIEW_COSINE)
}


export function computeColoredTransmittance(layer) {
	const pathLength = viewPathLength(layer?.thickness ?? SB_REFERENCE_THICKNESS, layer?.cosThetaView ?? 1)
	if (pathLength === 0) return [...SB_CLEAR_TRANSMITTANCE]
	return transmittanceFromAbsorbance(absorbanceFromTransmittanceColor(layer?.transmittanceColor), pathLength)
}

export function multiplyTransmittance(left, right) {
	return CHANNEL_INDEXES.map((channelIndex) =>
		clampToUnitInterval((left?.[channelIndex] ?? 1) * (right?.[channelIndex] ?? 1)),
	)
}


export function accumulateTransmittance(transmittanceList) {
	let accumulated = [...SB_CLEAR_TRANSMITTANCE]
	for (const transmittance of transmittanceList ?? []) {
		accumulated = multiplyTransmittance(accumulated, transmittance)
	}
	return accumulated
}

export function applyTransmittance(color, transmittance) {
	return CHANNEL_INDEXES.map((channelIndex) => (color?.[channelIndex] ?? 0) * (transmittance?.[channelIndex] ?? 1))
}

export function transmittanceAverage(transmittance) {
	const total = CHANNEL_INDEXES.reduce((sum, channelIndex) => sum + (transmittance?.[channelIndex] ?? 0), 0)
	return total / SB_TRANSMITTANCE_CHANNEL_COUNT
}

export function transmittanceIsClear(transmittance) {
	return CHANNEL_INDEXES.every((channelIndex) => (transmittance?.[channelIndex] ?? 0) === 1)
}

export function transmittanceIsOpaque(transmittance) {
	return CHANNEL_INDEXES.every((channelIndex) => (transmittance?.[channelIndex] ?? 1) === 0)
}
