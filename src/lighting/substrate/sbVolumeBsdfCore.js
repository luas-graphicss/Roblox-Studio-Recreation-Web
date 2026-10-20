export const SB_VOLUME_BSDF_KIND = "volume"


export const SB_VOLUME_PARAMETER_NAMES = Object.freeze(["extinction", "albedo", "phaseG", "emissive"])


export const SB_MAXIMUM_EXTINCTION_PER_UNIT = 64


export const SB_MAXIMUM_PHASE_ANISOTROPY = 0.99


export const SB_PHASE_INTEGRAL_TOLERANCE = 0.01

const DEFAULT_PHASE_SAMPLE_COUNT = 4096
const MINIMUM_SAMPLES_ACROSS_PHASE_PEAK = 400
const MINIMUM_PHASE_DENOMINATOR = 1e-6
const MINIMUM_PHASE_PEAK_WIDTH = 1 - SB_MAXIMUM_PHASE_ANISOTROPY


export const SB_VOLUME_PARAMETER_RANGES = Object.freeze({
	extinction: Object.freeze({ componentCount: 3, minimum: 0, maximum: SB_MAXIMUM_EXTINCTION_PER_UNIT }),
	phaseG: Object.freeze({
		componentCount: 1,
		minimum: -SB_MAXIMUM_PHASE_ANISOTROPY,
		maximum: SB_MAXIMUM_PHASE_ANISOTROPY,
	}),
})

export const SB_VOLUME_DEFAULT_PARAMETERS = Object.freeze({
	extinction: Object.freeze([0.32, 0.36, 0.46]),
	albedo: Object.freeze([0.9, 0.93, 0.97]),
	phaseG: 0.55,
	emissive: Object.freeze([0, 0, 0]),
})


export const SB_VOLUME_REFERENCE_LIGHT = Object.freeze({
	irradiance: Object.freeze([2.6, 2.35, 2.0]),
	cosineToView: 0.4,
})

function isFiniteNumber(value) {
	return typeof value === "number" && Number.isFinite(value)
}

function readScalar(value, fallback) {
	return isFiniteNumber(value) ? value : fallback
}

function readColor(value, fallback) {
	if (!Array.isArray(value) || value.length !== fallback.length) return [...fallback]
	return value.map((component, index) => (isFiniteNumber(component) ? component : fallback[index]))
}

function clamp(value, minimum, maximum) {
	if (minimum > value) return minimum
	if (value > maximum) return maximum
	return value
}


export function volumeParameters(parameters) {
	const authored = parameters ?? {}
	return {
		extinction: readColor(authored.extinction, SB_VOLUME_DEFAULT_PARAMETERS.extinction),
		albedo: readColor(authored.albedo, SB_VOLUME_DEFAULT_PARAMETERS.albedo),
		phaseG: readScalar(authored.phaseG, SB_VOLUME_DEFAULT_PARAMETERS.phaseG),
		emissive: readColor(authored.emissive, SB_VOLUME_DEFAULT_PARAMETERS.emissive),
	}
}


export function henyeyGreensteinPhase(cosineAngle, anisotropy) {
	const forwardness = clamp(readScalar(anisotropy, 0), -SB_MAXIMUM_PHASE_ANISOTROPY, SB_MAXIMUM_PHASE_ANISOTROPY)
	const cosine = clamp(readScalar(cosineAngle, 0), -1, 1)
	const squared = forwardness * forwardness
	const denominator = Math.max(1 + squared - 2 * forwardness * cosine, MINIMUM_PHASE_DENOMINATOR)
	return (1 - squared) / (4 * Math.PI * Math.pow(denominator, 1.5))
}


function adaptivePhaseSampleCount(anisotropy) {
	const forwardness = Math.abs(clamp(readScalar(anisotropy, 0), -SB_MAXIMUM_PHASE_ANISOTROPY, SB_MAXIMUM_PHASE_ANISOTROPY))
	const peakWidth = Math.max(1 - forwardness, MINIMUM_PHASE_PEAK_WIDTH)
	return Math.max(DEFAULT_PHASE_SAMPLE_COUNT, Math.ceil(MINIMUM_SAMPLES_ACROSS_PHASE_PEAK / peakWidth))
}


export function phaseFunctionIntegral(anisotropy, sampleCount) {
	const samples = Math.max(16, Math.floor(readScalar(sampleCount, adaptivePhaseSampleCount(anisotropy))))
	const step = 2 / samples
	let accumulated = 0
	for (let index = 0; samples > index; index += 1) {
		accumulated += henyeyGreensteinPhase(-1 + step * (index + 0.5), anisotropy) * step
	}
	return accumulated * 2 * Math.PI
}


export function beerLambertTransmittance(extinction, distance) {
	const extinctionPerChannel = readColor(extinction, SB_VOLUME_DEFAULT_PARAMETERS.extinction)
	const traveled = Math.max(0, readScalar(distance, 0))
	return extinctionPerChannel.map((component) => Math.exp(-Math.max(0, component) * traveled))
}


export function volumeScatteringColor(parameters, light) {
	const volume = volumeParameters(parameters)
	const irradiance = readColor(light?.irradiance, SB_VOLUME_REFERENCE_LIGHT.irradiance)
	const cosineToView = readScalar(light?.cosineToView, SB_VOLUME_REFERENCE_LIGHT.cosineToView)
	const phase = henyeyGreensteinPhase(cosineToView, volume.phaseG)
	return volume.albedo.map((albedo, index) => albedo * phase * irradiance[index] + volume.emissive[index])
}


export function volumeClosurePayload(parameters, light) {
	const volume = volumeParameters(parameters)
	return { extinction: volume.extinction, scattering: volumeScatteringColor(parameters, light) }
}


export function volumeAppliedColor(sourceColor, payload, distance) {
	const source = readColor(sourceColor, [0, 0, 0])
	const scattering = readColor(payload?.scattering, [0, 0, 0])
	const transmittance = beerLambertTransmittance(payload?.extinction, distance)
	return source.map((component, index) => component * transmittance[index] + scattering[index] * (1 - transmittance[index]))
}


export function volumeEnergyProblems(parameters) {
	const volume = volumeParameters(parameters)
	const problems = []
	volume.extinction.forEach((component, index) => {
		if (0 > component) problems.push(`extincao negativa no canal ${index}: o meio devolveria mais luz do que recebeu`)
		if (component > SB_MAXIMUM_EXTINCTION_PER_UNIT) {
			problems.push(`extincao ${component} no canal ${index} passou do teto ${SB_MAXIMUM_EXTINCTION_PER_UNIT}`)
		}
	})
	volume.albedo.forEach((component, index) => {
		if (0 > component || component > 1) {
			problems.push(`albedo ${component} no canal ${index} fora de 0..1: espalhamento nao cria energia`)
		}
	})
	volume.emissive.forEach((component, index) => {
		if (0 > component) problems.push(`emissao negativa no canal ${index}`)
	})
	if (Math.abs(volume.phaseG) > SB_MAXIMUM_PHASE_ANISOTROPY) {
		problems.push(`anisotropia ${volume.phaseG} passou de ${SB_MAXIMUM_PHASE_ANISOTROPY}: a fase fica singular`)
	}
	const integral = phaseFunctionIntegral(volume.phaseG)
	if (Math.abs(integral - 1) > SB_PHASE_INTEGRAL_TOLERANCE) {
		problems.push(`a fase integra ${integral.toFixed(4)} na esfera e deveria integrar 1`)
	}
	return problems
}

export function describeVolumeBsdf(parameters, light) {
	const volume = volumeParameters(parameters)
	return {
		kind: SB_VOLUME_BSDF_KIND,
		parameters: volume,
		scattering: volumeScatteringColor(parameters, light),
		transmittanceAtOneUnit: beerLambertTransmittance(volume.extinction, 1),
		phaseIntegral: phaseFunctionIntegral(volume.phaseG),
		problems: volumeEnergyProblems(parameters),
	}
}
