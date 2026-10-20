export const SB_SPECTRAL_CHANNEL_COUNT = 3


export const SB_NANOMETERS_PER_METER = 1e9


export const SB_SPECTRAL_SENSITIVITY_LOBES = Object.freeze([
	Object.freeze({ channelIndex: 0, amplitude: 5.4856e-13, angularFrequency: 1.681e6, variance: 4.3278e9 }),
	Object.freeze({ channelIndex: 1, amplitude: 4.4201e-13, angularFrequency: 1.7953e6, variance: 9.3046e9 }),
	Object.freeze({ channelIndex: 2, amplitude: 5.2481e-13, angularFrequency: 2.2084e6, variance: 6.6121e9 }),
	Object.freeze({ channelIndex: 0, amplitude: 9.747e-14, angularFrequency: 2.2399e6, variance: 4.5282e9 }),
])


export const SB_SENSITIVITY_NORMALIZATION = 1.0685e-7


export const SB_XYZ_TO_LINEAR_SRGB_ROWS = Object.freeze([
	Object.freeze([3.2404542, -1.5371385, -0.4985314]),
	Object.freeze([-0.969266, 1.8760108, 0.041556]),
	Object.freeze([0.0556434, -0.2040259, 1.0572252]),
])

export function convertXyzToLinearSrgb(xyz) {
	return SB_XYZ_TO_LINEAR_SRGB_ROWS.map((row) => row[0] * xyz[0] + row[1] * xyz[1] + row[2] * xyz[2])
}


export const SB_SENSITIVITY_FLAT_RESPONSE = Object.freeze(convertXyzToLinearSrgb([1, 1, 1]))


export function spectralPhaseFromOpticalPathDifference(opticalPathDifferenceNanometers) {
	return (2 * Math.PI * opticalPathDifferenceNanometers) / SB_NANOMETERS_PER_METER
}


export function evaluateXyzSensitivity(opticalPathDifferenceNanometers, phaseShiftPerChannel) {
	const phase = spectralPhaseFromOpticalPathDifference(opticalPathDifferenceNanometers)
	const xyz = [0, 0, 0]
	for (const lobe of SB_SPECTRAL_SENSITIVITY_LOBES) {
		const phaseShift = Number(phaseShiftPerChannel?.[lobe.channelIndex]) || 0
		const lobeArea = Math.sqrt(2 * Math.PI * lobe.variance)
		const envelope = Math.exp(-lobe.variance * phase * phase)
		const oscillation = Math.cos(lobe.angularFrequency * phase + phaseShift)
		xyz[lobe.channelIndex] += lobe.amplitude * lobeArea * oscillation * envelope
	}
	return xyz.map((channel) => channel / SB_SENSITIVITY_NORMALIZATION)
}


export function evaluateSpectralSensitivity(opticalPathDifferenceNanometers, phaseShiftPerChannel) {
	const xyz = evaluateXyzSensitivity(opticalPathDifferenceNanometers, phaseShiftPerChannel)
	return convertXyzToLinearSrgb(xyz).map((channel, index) => channel / SB_SENSITIVITY_FLAT_RESPONSE[index])
}


export function describeSpectralSensitivity() {
	return {
		lobeCount: SB_SPECTRAL_SENSITIVITY_LOBES.length,
		normalization: SB_SENSITIVITY_NORMALIZATION,
		flatSpectrumResponse: evaluateSpectralSensitivity(0, [0, 0, 0]),
		lobes: SB_SPECTRAL_SENSITIVITY_LOBES.map((lobe) => ({ ...lobe })),
	}
}
