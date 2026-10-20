import { sanitizeSlabParameter, slabParameterSchema } from "./sbSlabParametersCore.js"
import { evaluateSpectralSensitivity } from "./sbThinFilmSpectralSensitivityCore.js"


export const SB_THIN_FILM_THICKNESS_PARAMETER = "thinFilmThicknessNanometers"
export const SB_THIN_FILM_IOR_PARAMETER = "thinFilmIor"

const thicknessSchema = slabParameterSchema(SB_THIN_FILM_THICKNESS_PARAMETER)
const filmIorSchema = slabParameterSchema(SB_THIN_FILM_IOR_PARAMETER)

export const SB_THIN_FILM_MAXIMUM_THICKNESS_NANOMETERS = thicknessSchema === null ? 2000 : thicknessSchema.maximum
export const SB_THIN_FILM_DEFAULT_FILM_IOR = filmIorSchema === null ? 1.35 : filmIorSchema.defaultValue


export const SB_THIN_FILM_OUTSIDE_IOR = 1


export const SB_THIN_FILM_HARMONIC_COUNT = 2

export const SB_THIN_FILM_CHANNEL_COUNT = 3


export const SB_THIN_FILM_MINIMUM_VIEW_COSINE = 1e-4


export const SB_THIN_FILM_MINIMUM_BASE_FRESNEL = 1e-4


export const SB_THIN_FILM_TOTAL_REFLECTION_COLOR = Object.freeze([1, 1, 1])

export const SB_THIN_FILM_NEUTRAL_TINT = Object.freeze([1, 1, 1])


const MAXIMUM_COMPOUND_REFLECTANCE = 0.9999


const MAXIMUM_BASE_NORMAL_REFLECTANCE = 0.9999
const DEFAULT_BASE_NORMAL_REFLECTANCE = 0.04

function clampNumber(value, minimum, maximum) {
	const numeric = Number(value)
	if (!Number.isFinite(numeric)) return minimum
	return Math.min(maximum, Math.max(minimum, numeric))
}


export function asBaseReflectanceTriplet(baseNormalReflectance) {
	if (baseNormalReflectance === null || baseNormalReflectance === undefined) {
		return [DEFAULT_BASE_NORMAL_REFLECTANCE, DEFAULT_BASE_NORMAL_REFLECTANCE, DEFAULT_BASE_NORMAL_REFLECTANCE]
	}
	if (Array.isArray(baseNormalReflectance)) {
		return [0, 1, 2].map((channelIndex) =>
			clampNumber(baseNormalReflectance[channelIndex], 0, MAXIMUM_BASE_NORMAL_REFLECTANCE),
		)
	}
	const single = clampNumber(baseNormalReflectance, 0, MAXIMUM_BASE_NORMAL_REFLECTANCE)
	return [single, single, single]
}


export function sanitizeThinFilmParameters(parameters) {
	return {
		thicknessNanometers: sanitizeSlabParameter(SB_THIN_FILM_THICKNESS_PARAMETER, parameters?.thicknessNanometers),
		filmIor: sanitizeSlabParameter(SB_THIN_FILM_IOR_PARAMETER, parameters?.filmIor),
	}
}


export function iorToNormalIncidenceReflectance(transmittedIor, incidentIor) {
	const amplitude = (transmittedIor - incidentIor) / (transmittedIor + incidentIor)
	return amplitude * amplitude
}


export function normalIncidenceReflectanceToIor(normalIncidenceReflectance) {
	const amplitude = Math.sqrt(clampNumber(normalIncidenceReflectance, 0, MAXIMUM_BASE_NORMAL_REFLECTANCE))
	return (1 + amplitude) / (1 - amplitude)
}

export function fresnelSchlick(normalIncidenceReflectance, cosTheta) {
	const grazingWeight = Math.pow(1 - clampNumber(cosTheta, 0, 1), 5)
	return normalIncidenceReflectance + (1 - normalIncidenceReflectance) * grazingWeight
}


export function fresnelDielectricUnpolarized(
	incidentIor,
	transmittedIor,
	cosThetaIncident,
	cosThetaTransmitted,
) {
	const perpendicular =
		(incidentIor * cosThetaIncident - transmittedIor * cosThetaTransmitted) /
		(incidentIor * cosThetaIncident + transmittedIor * cosThetaTransmitted)
	const parallel =
		(transmittedIor * cosThetaIncident - incidentIor * cosThetaTransmitted) /
		(transmittedIor * cosThetaIncident + incidentIor * cosThetaTransmitted)
	return 0.5 * (perpendicular * perpendicular + parallel * parallel)
}


export function computeBaseFresnel(baseNormalReflectance, cosThetaView) {
	const base = asBaseReflectanceTriplet(baseNormalReflectance)
	const viewCosine = clampNumber(cosThetaView, SB_THIN_FILM_MINIMUM_VIEW_COSINE, 1)
	return base.map((channel) => fresnelSchlick(channel, viewCosine))
}


export function describeThinFilmInterference(options) {
	const viewCosine = clampNumber(options?.cosThetaView, SB_THIN_FILM_MINIMUM_VIEW_COSINE, 1)
	const { thicknessNanometers, filmIor } = sanitizeThinFilmParameters({
		thicknessNanometers: options?.thicknessNanometers,
		filmIor: options?.filmIor,
	})
	const baseNormalReflectance = asBaseReflectanceTriplet(options?.baseNormalReflectance)
	const baseFresnel = computeBaseFresnel(baseNormalReflectance, viewCosine)
	const shared = {
		cosThetaView: viewCosine,
		thicknessNanometers,
		filmIor,
		baseNormalReflectance,
		baseFresnel,
	}

	if (0 >= thicknessNanometers) {
		return { ...shared, bypassed: true, totalInternalReflection: false, reason: "espessura zero: nao existe filme" }
	}

	const sineFilmSquared = Math.pow(SB_THIN_FILM_OUTSIDE_IOR / filmIor, 2) * (1 - viewCosine * viewCosine)
	const cosineFilmSquared = 1 - sineFilmSquared
	if (0 >= cosineFilmSquared) {
		return { ...shared, bypassed: false, totalInternalReflection: true, reason: "reflexao interna total" }
	}

	const cosThetaFilm = Math.sqrt(cosineFilmSquared)
	const firstInterfaceReflectance = fresnelDielectricUnpolarized(
		SB_THIN_FILM_OUTSIDE_IOR,
		filmIor,
		viewCosine,
		cosThetaFilm,
	)

	const roundTripTransmittance = 1 - firstInterfaceReflectance

	const firstInterfacePhaseShift = SB_THIN_FILM_OUTSIDE_IOR > filmIor ? 0 : Math.PI
	const baseIor = baseNormalReflectance.map((channel) => normalIncidenceReflectanceToIor(channel))
	const secondInterfaceReflectance = baseIor.map((channelIor) =>
		fresnelSchlick(iorToNormalIncidenceReflectance(channelIor, filmIor), cosThetaFilm),
	)
	const phaseShiftPerChannel = baseIor.map(
		(channelIor) => firstInterfacePhaseShift + (filmIor > channelIor ? Math.PI : 0),
	)
	const compoundReflectance = secondInterfaceReflectance.map((channel) =>
		Math.min(firstInterfaceReflectance * channel, MAXIMUM_COMPOUND_REFLECTANCE),
	)
	const compoundAmplitude = compoundReflectance.map((channel) => Math.sqrt(channel))
	const multipleBounceReflectance = secondInterfaceReflectance.map(
		(channel, channelIndex) =>
			(roundTripTransmittance * roundTripTransmittance * channel) / (1 - compoundReflectance[channelIndex]),
	)
	return {
		...shared,
		bypassed: false,
		totalInternalReflection: false,
		cosThetaFilm,
		firstInterfaceReflectance,
		roundTripTransmittance,
		firstInterfacePhaseShift,
		baseIor,
		secondInterfaceReflectance,
		phaseShiftPerChannel,
		compoundReflectance,
		compoundAmplitude,
		multipleBounceReflectance,

		constantTerm: multipleBounceReflectance.map((channel) => firstInterfaceReflectance + channel),

		harmonicAmplitude: multipleBounceReflectance.map((channel) => channel - roundTripTransmittance),
		opticalPathDifferenceNanometers: 2 * filmIor * thicknessNanometers * cosThetaFilm,
	}
}


export function reflectanceFromInterference(interference) {
	if (interference.bypassed) return interference.baseFresnel.slice()
	if (interference.totalInternalReflection) return SB_THIN_FILM_TOTAL_REFLECTION_COLOR.slice()

	const reflectance = interference.constantTerm.slice()
	const harmonicAmplitude = interference.harmonicAmplitude.slice()
	for (let harmonicIndex = 1; SB_THIN_FILM_HARMONIC_COUNT >= harmonicIndex; harmonicIndex += 1) {
		const sensitivity = evaluateSpectralSensitivity(
			harmonicIndex * interference.opticalPathDifferenceNanometers,
			interference.phaseShiftPerChannel.map((phaseShift) => harmonicIndex * phaseShift),
		)
		for (let channelIndex = 0; SB_THIN_FILM_CHANNEL_COUNT > channelIndex; channelIndex += 1) {
			harmonicAmplitude[channelIndex] *= interference.compoundAmplitude[channelIndex]
			reflectance[channelIndex] += 2 * harmonicAmplitude[channelIndex] * sensitivity[channelIndex]
		}
	}


	return reflectance.map((channel) => clampNumber(channel, 0, 1))
}


export function computeThinFilmReflectance(options) {
	return reflectanceFromInterference(describeThinFilmInterference(options))
}


export function computeThinFilmSpecularTint(options) {
	const interference = describeThinFilmInterference(options)
	if (interference.bypassed) return SB_THIN_FILM_NEUTRAL_TINT.slice()
	const reflectance = reflectanceFromInterference(interference)
	return reflectance.map(
		(channel, channelIndex) =>
			channel / Math.max(interference.baseFresnel[channelIndex], SB_THIN_FILM_MINIMUM_BASE_FRESNEL),
	)
}
