export const SB_LAYER_REFERENCE_THICKNESS = 1
export const SB_MINIMUM_TRANSMITTANCE_CHANNEL = 1e-4
export const SB_MINIMUM_VIEW_COSINE = 0.05
export const SB_TRANSMITTANCE_CHANNEL_COUNT = 3
export const SB_NORMAL_INCIDENCE_COSINE = 1

const NEUTRAL_TRANSMITTANCE_COLOR = [1, 1, 1]


const SELF_CHECK_COLORS = [
	[1, 1, 1],
	[0.95, 0.92, 0.9],
	[0.86, 0.72, 0.5],
	[0.5, 0.25, 0.125],
	[0.01, 0.005, 0],
]
const SELF_CHECK_THICKNESSES = [0, 0.02, 0.08, 0.2, 1, 4, 16, 64]
const SELF_CHECK_VIEW_COSINES = [1, 0.7, 0.3, 0.05, 0]
const CLOSED_FORM_TOLERANCE = 1e-12
const SQUARING_TOLERANCE = 1e-9

function isUsableNumber(value) {
	return typeof value === "number" && Number.isFinite(value)
}

function clampToRange(value, minimum, maximum, fallback) {
	if (!isUsableNumber(value)) return fallback
	if (minimum > value) return minimum
	if (value > maximum) return maximum
	return value
}


export function sanitizeTransmittanceColor(transmittanceColor) {
	if (!Array.isArray(transmittanceColor)) return NEUTRAL_TRANSMITTANCE_COLOR.slice()
	const sanitized = []
	for (let channelIndex = 0; SB_TRANSMITTANCE_CHANNEL_COUNT > channelIndex; channelIndex += 1) {
		sanitized.push(clampToRange(transmittanceColor[channelIndex], 0, 1, 1))
	}
	return sanitized
}


export function sanitizeThickness(thickness) {
	if (!isUsableNumber(thickness) || 0 > thickness) return 0
	return thickness
}


export function sanitizeViewCosine(viewCosine) {
	return clampToRange(viewCosine, 0, 1, SB_NORMAL_INCIDENCE_COSINE)
}


export function absorptionCoefficients(transmittanceColor) {
	return sanitizeTransmittanceColor(transmittanceColor).map((channel) => {
		const flooredChannel = Math.max(channel, SB_MINIMUM_TRANSMITTANCE_CHANNEL)
		return -Math.log(flooredChannel) / SB_LAYER_REFERENCE_THICKNESS
	})
}


export function layerPathLength(thickness, viewCosine) {
	const stretchCosine = Math.max(sanitizeViewCosine(viewCosine), SB_MINIMUM_VIEW_COSINE)
	return sanitizeThickness(thickness) / stretchCosine
}


export function layerTransmittance(request) {
	const pathLength = layerPathLength(request?.thickness, request?.viewCosine)
	return absorptionCoefficients(request?.transmittanceColor).map((absorption) => Math.exp(-absorption * pathLength))
}

export function transmittanceAtNormalIncidence(transmittanceColor, thickness) {
	return layerTransmittance({ transmittanceColor, thickness, viewCosine: SB_NORMAL_INCIDENCE_COSINE })
}


export function meanChannel(color) {
	if (!Array.isArray(color) || color.length === 0) return 0
	const total = color.reduce((sum, channel) => sum + (isUsableNumber(channel) ? channel : 0), 0)
	return total / color.length
}

export function describeLayerTransmittance(request) {
	const transmittanceColor = sanitizeTransmittanceColor(request?.transmittanceColor)
	const thickness = sanitizeThickness(request?.thickness)
	const viewCosine = sanitizeViewCosine(request?.viewCosine)
	const transmittance = layerTransmittance({ transmittanceColor, thickness, viewCosine })
	return {
		transmittanceColor,
		thickness,
		viewCosine,
		referenceThickness: SB_LAYER_REFERENCE_THICKNESS,
		absorption: absorptionCoefficients(transmittanceColor),
		pathLength: layerPathLength(thickness, viewCosine),
		transmittance,
		meanTransmittance: meanChannel(transmittance),
	}
}


function closedFormTransmittance(transmittanceColor, thickness, viewCosine) {
	const pathLength = layerPathLength(thickness, viewCosine)
	return sanitizeTransmittanceColor(transmittanceColor).map((channel) =>
		Math.pow(Math.max(channel, SB_MINIMUM_TRANSMITTANCE_CHANNEL), pathLength / SB_LAYER_REFERENCE_THICKNESS),
	)
}


export function findLayerTransmittanceProblems() {
	const problems = []

	for (const transmittanceColor of SELF_CHECK_COLORS) {
		const colorLabel = "cor " + transmittanceColor.join("/")
		for (const viewCosine of SELF_CHECK_VIEW_COSINES) {
			let previousMean = Number.POSITIVE_INFINITY
			for (const thickness of SELF_CHECK_THICKNESSES) {
				const label = colorLabel + " espessura " + thickness + " cosseno " + viewCosine
				const transmittance = layerTransmittance({ transmittanceColor, thickness, viewCosine })
				const closedForm = closedFormTransmittance(transmittanceColor, thickness, viewCosine)
				const doubled = layerTransmittance({ transmittanceColor, thickness: thickness * 2, viewCosine })

				transmittance.forEach((channel, channelIndex) => {
					if (!isUsableNumber(channel)) {
						problems.push("canal nao numerico em " + label)
						return
					}
					if (0 > channel || channel > 1) {
						problems.push("canal fora de 0..1 em " + label + ": " + channel)
					}

					const mirrorError = Math.abs(channel - closedForm[channelIndex])
					if (mirrorError > CLOSED_FORM_TOLERANCE) {
						problems.push("espelho fechado divergiu " + mirrorError + " em " + label)
					}

					const squaredChannel = channel * channel
					if (Math.abs(doubled[channelIndex] - squaredChannel) > SQUARING_TOLERANCE) {
						problems.push("dobrar a espessura nao elevou ao quadrado em " + label)
					}
				})

				const currentMean = meanChannel(transmittance)
				if (currentMean > previousMean + CLOSED_FORM_TOLERANCE) {
					problems.push("transmitancia subiu com a espessura em " + label)
				}
				previousMean = currentMean
			}
		}
	}

	const colorlessVarnish = layerTransmittance({
		transmittanceColor: NEUTRAL_TRANSMITTANCE_COLOR,
		thickness: 64,
		viewCosine: SB_MINIMUM_VIEW_COSINE,
	})
	if (meanChannel(colorlessVarnish) !== 1) {
		problems.push("verniz incolor escureceu: " + colorlessVarnish.join("/"))
	}

	const withoutThickness = layerTransmittance({
		transmittanceColor: [0.1, 0.2, 0.3],
		thickness: 0,
		viewCosine: SB_MINIMUM_VIEW_COSINE,
	})
	if (meanChannel(withoutThickness) !== 1) {
		problems.push("espessura zero escureceu: " + withoutThickness.join("/"))
	}

	const fromJunk = layerTransmittance({ transmittanceColor: "verniz", thickness: "grossa", viewCosine: null })
	if (meanChannel(fromJunk) !== 1) {
		problems.push("entrada podre nao caiu na identidade: " + fromJunk.join("/"))
	}

	const grazingMean = meanChannel(
		layerTransmittance({ transmittanceColor: [0.5, 0.5, 0.5], thickness: 0.2, viewCosine: SB_MINIMUM_VIEW_COSINE }),
	)
	const frontalMean = meanChannel(
		layerTransmittance({ transmittanceColor: [0.5, 0.5, 0.5], thickness: 0.2, viewCosine: SB_NORMAL_INCIDENCE_COSINE }),
	)
	if (grazingMean >= frontalMean) {
		problems.push("visada rasante nao escureceu mais que a frontal: " + grazingMean + " x " + frontalMean)
	}

	return problems
}
