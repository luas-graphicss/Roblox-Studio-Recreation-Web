import { describeThinFilmInterference } from "./sbThinFilmCore.js"
import { SB_SPECTRAL_CHANNEL_COUNT, convertXyzToLinearSrgb } from "./sbThinFilmSpectralSensitivityCore.js"

export const SB_REFERENCE_SPECTRUM_START_NANOMETERS = 360
export const SB_REFERENCE_SPECTRUM_END_NANOMETERS = 830
export const SB_REFERENCE_SPECTRUM_STEP_NANOMETERS = 1


export const SB_REFERENCE_HARMONIC_COUNT = 12

const LAB_WHITE_POINT = Object.freeze([0.95047, 1, 1.08883])
const LAB_EPSILON = 0.008856
const LAB_KAPPA = 7.787

function gaussianLobe(wavelengthNanometers, peak, leftSlope, rightSlope, amplitude) {
	const slope = peak > wavelengthNanometers ? leftSlope : rightSlope
	const distance = (wavelengthNanometers - peak) * slope
	return amplitude * Math.exp(-0.5 * distance * distance)
}


export function evaluateColorMatchingX(wavelengthNanometers) {
	return (
		gaussianLobe(wavelengthNanometers, 442, 0.0624, 0.0374, 0.362) +
		gaussianLobe(wavelengthNanometers, 599.8, 0.0264, 0.0323, 1.056) -
		gaussianLobe(wavelengthNanometers, 501.1, 0.049, 0.0382, 0.065)
	)
}

export function evaluateColorMatchingY(wavelengthNanometers) {
	return (
		gaussianLobe(wavelengthNanometers, 568.8, 0.0213, 0.0247, 0.821) +
		gaussianLobe(wavelengthNanometers, 530.9, 0.0613, 0.0322, 0.286)
	)
}

export function evaluateColorMatchingZ(wavelengthNanometers) {
	return (
		gaussianLobe(wavelengthNanometers, 437, 0.0845, 0.0278, 1.217) +
		gaussianLobe(wavelengthNanometers, 459, 0.0385, 0.0725, 0.681)
	)
}

const COLOR_MATCHING_FUNCTIONS = Object.freeze([
	evaluateColorMatchingX,
	evaluateColorMatchingY,
	evaluateColorMatchingZ,
])


export function integrateSpectrumToXyz(evaluateReflectance) {
	return COLOR_MATCHING_FUNCTIONS.map((colorMatchingFunction, channelIndex) => {
		let weightedSum = 0
		let weightSum = 0
		for (
			let wavelengthNanometers = SB_REFERENCE_SPECTRUM_START_NANOMETERS;
			SB_REFERENCE_SPECTRUM_END_NANOMETERS >= wavelengthNanometers;
			wavelengthNanometers += SB_REFERENCE_SPECTRUM_STEP_NANOMETERS
		) {
			const weight = colorMatchingFunction(wavelengthNanometers)
			weightedSum += weight * evaluateReflectance(wavelengthNanometers, channelIndex)
			weightSum += weight
		}
		return weightSum === 0 ? 0 : weightedSum / weightSum
	})
}


export function evaluateRgbResponse(wavelengthNanometers) {
	return convertXyzToLinearSrgb([
		evaluateColorMatchingX(wavelengthNanometers),
		evaluateColorMatchingY(wavelengthNanometers),
		evaluateColorMatchingZ(wavelengthNanometers),
	])
}


function computeRgbResponseAreas() {
	const areas = [0, 0, 0]
	for (
		let wavelengthNanometers = SB_REFERENCE_SPECTRUM_START_NANOMETERS;
		SB_REFERENCE_SPECTRUM_END_NANOMETERS >= wavelengthNanometers;
		wavelengthNanometers += SB_REFERENCE_SPECTRUM_STEP_NANOMETERS
	) {
		const response = evaluateRgbResponse(wavelengthNanometers)
		for (let channelIndex = 0; SB_SPECTRAL_CHANNEL_COUNT > channelIndex; channelIndex += 1) {
			areas[channelIndex] += response[channelIndex]
		}
	}
	return areas
}

const RGB_RESPONSE_AREAS = Object.freeze(computeRgbResponseAreas())


export function integrateSpectrumToLinearSrgb(evaluateReflectance) {
	const weightedSums = [0, 0, 0]
	for (
		let wavelengthNanometers = SB_REFERENCE_SPECTRUM_START_NANOMETERS;
		SB_REFERENCE_SPECTRUM_END_NANOMETERS >= wavelengthNanometers;
		wavelengthNanometers += SB_REFERENCE_SPECTRUM_STEP_NANOMETERS
	) {
		const response = evaluateRgbResponse(wavelengthNanometers)
		for (let channelIndex = 0; SB_SPECTRAL_CHANNEL_COUNT > channelIndex; channelIndex += 1) {
			weightedSums[channelIndex] +=
				response[channelIndex] * evaluateReflectance(wavelengthNanometers, channelIndex)
		}
	}
	return weightedSums.map((weightedSum, channelIndex) => weightedSum / RGB_RESPONSE_AREAS[channelIndex])
}


export function airyReflectance(firstInterfaceReflectance, secondInterfaceReflectance, interferencePhase) {
	const compound = firstInterfaceReflectance * secondInterfaceReflectance
	const interference = 2 * Math.sqrt(compound) * Math.cos(interferencePhase)
	return (firstInterfaceReflectance + secondInterfaceReflectance - interference) / (1 + compound - interference)
}


export function interferencePhaseAt(interference, channelIndex, wavelengthNanometers) {
	return (
		(2 * Math.PI * interference.opticalPathDifferenceNanometers) / wavelengthNanometers +
		interference.phaseShiftPerChannel[channelIndex]
	)
}


export function referenceReflectanceAtWavelength(interference, channelIndex, wavelengthNanometers) {
	return airyReflectance(
		interference.firstInterfaceReflectance,
		interference.secondInterfaceReflectance[channelIndex],
		interferencePhaseAt(interference, channelIndex, wavelengthNanometers),
	)
}


export function seriesReflectanceAtWavelength(interference, channelIndex, wavelengthNanometers, harmonicCount) {
	const totalHarmonics = Number.isFinite(harmonicCount) ? harmonicCount : SB_REFERENCE_HARMONIC_COUNT
	const phase = interferencePhaseAt(interference, channelIndex, wavelengthNanometers)
	let reflectance = interference.constantTerm[channelIndex]
	let harmonicAmplitude = interference.harmonicAmplitude[channelIndex]
	for (let harmonicIndex = 1; totalHarmonics >= harmonicIndex; harmonicIndex += 1) {
		harmonicAmplitude *= interference.compoundAmplitude[channelIndex]
		reflectance += 2 * harmonicAmplitude * Math.cos(harmonicIndex * phase)
	}
	return reflectance
}


export function integrateThinFilmSpectralColor(options) {
	const interference = describeThinFilmInterference(options)
	if (interference.bypassed) return interference.baseFresnel.slice()
	if (interference.totalInternalReflection) return [1, 1, 1]
	return integrateSpectrumToLinearSrgb((wavelengthNanometers, channelIndex) =>
		referenceReflectanceAtWavelength(interference, channelIndex, wavelengthNanometers),
	)
}


export function clampToDisplayRange(linearSrgb) {
	return [0, 1, 2].map((channelIndex) => {
		const channel = Number(linearSrgb?.[channelIndex])
		if (!Number.isFinite(channel)) return 0
		return Math.min(1, Math.max(0, channel))
	})
}

function labTransfer(ratio) {
	return ratio > LAB_EPSILON ? Math.cbrt(ratio) : LAB_KAPPA * ratio + 16 / 116
}


export function convertLinearSrgbToLab(linearSrgb) {
	const [red, green, blue] = clampToDisplayRange(linearSrgb)
	const xyz = [
		0.4124564 * red + 0.3575761 * green + 0.1804375 * blue,
		0.2126729 * red + 0.7151522 * green + 0.072175 * blue,
		0.0193339 * red + 0.119192 * green + 0.9503041 * blue,
	]
	const transferred = xyz.map((channel, channelIndex) => labTransfer(channel / LAB_WHITE_POINT[channelIndex]))
	return [
		116 * transferred[1] - 16,
		500 * (transferred[0] - transferred[1]),
		200 * (transferred[1] - transferred[2]),
	]
}


export function computeColorDeltaE76(leftLinearSrgb, rightLinearSrgb) {
	const left = convertLinearSrgbToLab(leftLinearSrgb)
	const right = convertLinearSrgbToLab(rightLinearSrgb)
	let sumOfSquares = 0
	for (let channelIndex = 0; SB_SPECTRAL_CHANNEL_COUNT > channelIndex; channelIndex += 1) {
		const difference = left[channelIndex] - right[channelIndex]
		sumOfSquares += difference * difference
	}
	return Math.sqrt(sumOfSquares)
}
