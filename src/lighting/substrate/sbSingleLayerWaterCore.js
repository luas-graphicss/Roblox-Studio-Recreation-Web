import { closureLayoutBytes } from "./sbClosureLayouts.js"
import { SB_CLOSURE_BYTES_CEILING, SB_GATES, SB_PASS_OWNERS } from "./sbMaterialContract.js"

export const SB_WATER_PHASE_ID = "SB-F26"
export const SB_WATER_CLOSURE_KIND = "singleLayerWater"
export const SB_WATER_UNIFORM_NAME = "uSbWater"

const CHANNEL_COUNT = 3
const CHANNEL_INDEXES = Object.freeze([0, 1, 2])
const FULL_SPHERE_STERADIANS = 4 * Math.PI
const MINIMUM_VIEW_COSINE = 1e-4
const MAXIMUM_PHASE_ANISOTROPY = 0.95

export const SB_AIR_INDEX_OF_REFRACTION = 1
export const SB_WATER_INDEX_OF_REFRACTION = 1.333
export const SB_MAXIMUM_ENCODED_INDEX_OF_REFRACTION = 2


export const SB_MINIMUM_ENCODED_EXTINCTION_PER_METER = 0.0005
export const SB_MAXIMUM_ENCODED_EXTINCTION_PER_METER = 10


export const SB_EXTINCTION_ZERO_CODE = 0
export const SB_EXTINCTION_CODE_MINIMUM = 1
export const SB_EXTINCTION_CODE_MAXIMUM = 255

const EXTINCTION_CODE_SPAN = SB_EXTINCTION_CODE_MAXIMUM - SB_EXTINCTION_CODE_MINIMUM
const EXTINCTION_LOG_SPAN = Math.log(
	SB_MAXIMUM_ENCODED_EXTINCTION_PER_METER / SB_MINIMUM_ENCODED_EXTINCTION_PER_METER,
)

const SIGNED_UNIT_CODE_CENTER = 127.5
const UNIT_CODE_MAXIMUM = 255


export const SB_WATER_GATE_DEPTHS_METERS = Object.freeze([0.05, 0.25, 0.5, 1, 2, 4, 8, 16])
export const SB_WATER_GATE_VIEW_COSINES = Object.freeze([1, 0.7, 0.35, 0.1])


export const SB_WATER_BRIGHT_BAND_TRANSMITTANCE_FLOOR = 0.5

function clampNumber(value, minimum, maximum) {
	return Math.min(maximum, Math.max(minimum, value))
}

function toFiniteNumber(value, fallback) {
	const numericValue = Number(value)
	return Number.isFinite(numericValue) ? numericValue : fallback
}

function toChannelTriplet(value, fallback) {
	if (!Array.isArray(value)) return Object.freeze([fallback, fallback, fallback])
	return Object.freeze(CHANNEL_INDEXES.map((channel) => toFiniteNumber(value[channel], fallback)))
}

function toNonNegativeTriplet(value) {
	return Object.freeze(toChannelTriplet(value, 0).map((channelValue) => Math.max(0, channelValue)))
}

function largestValue(values) {
	return values.reduce((largest, value) => Math.max(largest, value), 0)
}


export function createWaterMedium(overrides) {
	return Object.freeze({
		absorptionPerMeter: toNonNegativeTriplet(overrides?.absorptionPerMeter),
		scatteringPerMeter: toNonNegativeTriplet(overrides?.scatteringPerMeter),
		phaseAnisotropy: clampNumber(
			toFiniteNumber(overrides?.phaseAnisotropy, 0),
			-MAXIMUM_PHASE_ANISOTROPY,
			MAXIMUM_PHASE_ANISOTROPY,
		),
		surfaceRoughness: clampNumber(toFiniteNumber(overrides?.surfaceRoughness, 0.03), 0, 1),
		indexOfRefraction: clampNumber(
			toFiniteNumber(overrides?.indexOfRefraction, SB_WATER_INDEX_OF_REFRACTION),
			SB_AIR_INDEX_OF_REFRACTION,
			SB_MAXIMUM_ENCODED_INDEX_OF_REFRACTION,
		),
	})
}


export const SB_WATER_MEDIUM_PRESETS = Object.freeze({
	clearOcean: createWaterMedium({
		absorptionPerMeter: [0.3, 0.06, 0.018],
		scatteringPerMeter: [0.005, 0.007, 0.012],
		phaseAnisotropy: 0.85,
		surfaceRoughness: 0.05,
	}),
	tropicalShallow: createWaterMedium({
		absorptionPerMeter: [0.35, 0.09, 0.04],
		scatteringPerMeter: [0.05, 0.08, 0.12],
		phaseAnisotropy: 0.8,
		surfaceRoughness: 0.06,
	}),
	murkyLake: createWaterMedium({
		absorptionPerMeter: [1.2, 0.9, 1.4],
		scatteringPerMeter: [0.9, 0.8, 0.6],
		phaseAnisotropy: 0.7,
		surfaceRoughness: 0.15,
	}),
	swimmingPool: createWaterMedium({
		absorptionPerMeter: [0.25, 0.045, 0.012],
		scatteringPerMeter: [0.02, 0.025, 0.03],
		phaseAnisotropy: 0.6,
		surfaceRoughness: 0.02,
	}),
})

export function waterMediumPresetIds() {
	return Object.keys(SB_WATER_MEDIUM_PRESETS).sort()
}

export function waterMediumPreset(presetId) {
	return SB_WATER_MEDIUM_PRESETS[presetId] ?? null
}

export function extinctionPerMeter(medium) {
	return medium.absorptionPerMeter.map((absorption, channel) => absorption + medium.scatteringPerMeter[channel])
}


export function scatteringAlbedoPerChannel(medium) {
	const extinction = extinctionPerMeter(medium)
	return medium.scatteringPerMeter.map((scattering, channel) =>
		extinction[channel] > 0 ? scattering / extinction[channel] : 0,
	)
}

export function averageScatteringAlbedo(medium) {
	const albedo = scatteringAlbedoPerChannel(medium)
	return albedo.reduce((total, channelAlbedo) => total + channelAlbedo, 0) / CHANNEL_COUNT
}


export function packedScatteringAlbedoResidue(medium) {
	const average = averageScatteringAlbedo(medium)
	return largestValue(scatteringAlbedoPerChannel(medium).map((channelAlbedo) => Math.abs(channelAlbedo - average)))
}


export function beerLambertTransmittance(extinctionTriplet, pathLengthMeters) {
	const pathLength = Math.max(0, toFiniteNumber(pathLengthMeters, 0))
	return extinctionTriplet.map((extinction) => Math.exp(-Math.max(0, extinction) * pathLength))
}


export function refractedPathLengthMeters(options) {
	const depthMeters = Math.max(0, toFiniteNumber(options?.depthMeters, 0))
	const cosThetaView = clampNumber(toFiniteNumber(options?.cosThetaView, 1), MINIMUM_VIEW_COSINE, 1)
	const indexOfRefraction = Math.max(
		SB_AIR_INDEX_OF_REFRACTION,
		toFiniteNumber(options?.indexOfRefraction, SB_WATER_INDEX_OF_REFRACTION),
	)
	const sinThetaView = Math.sqrt(Math.max(0, 1 - cosThetaView * cosThetaView))
	const sinThetaRefracted = sinThetaView / indexOfRefraction
	const cosThetaRefracted = Math.sqrt(Math.max(MINIMUM_VIEW_COSINE, 1 - sinThetaRefracted * sinThetaRefracted))
	return depthMeters / cosThetaRefracted
}

export function waterSurfaceReflectanceAtNormalIncidence(indexOfRefraction) {
	const ratio =
		(indexOfRefraction - SB_AIR_INDEX_OF_REFRACTION) / (indexOfRefraction + SB_AIR_INDEX_OF_REFRACTION)
	return ratio * ratio
}

export function schlickFresnelReflectance(cosTheta, reflectanceAtNormalIncidence) {
	const cosine = clampNumber(toFiniteNumber(cosTheta, 1), 0, 1)
	const oneMinusCosine = 1 - cosine
	const grazingCurve = oneMinusCosine * oneMinusCosine * oneMinusCosine * oneMinusCosine * oneMinusCosine
	return reflectanceAtNormalIncidence + (1 - reflectanceAtNormalIncidence) * grazingCurve
}


export function henyeyGreensteinPhase(cosScatterAngle, phaseAnisotropy) {
	const anisotropy = clampNumber(
		toFiniteNumber(phaseAnisotropy, 0),
		-MAXIMUM_PHASE_ANISOTROPY,
		MAXIMUM_PHASE_ANISOTROPY,
	)
	const cosine = clampNumber(toFiniteNumber(cosScatterAngle, 0), -1, 1)
	const squaredAnisotropy = anisotropy * anisotropy
	const denominator = Math.max(1e-6, 1 + squaredAnisotropy - 2 * anisotropy * cosine)
	return (1 - squaredAnisotropy) / (FULL_SPHERE_STERADIANS * Math.pow(denominator, 1.5))
}


export function singleScatterSourceRadiance(options) {
	const ambientRadiance = toChannelTriplet(options?.ambientRadiance, 0)
	const directionalIrradiance = toChannelTriplet(options?.directionalIrradiance, 0)
	const phaseWeight =
		henyeyGreensteinPhase(options?.cosScatterAngle, options?.phaseAnisotropy) * FULL_SPHERE_STERADIANS
	return ambientRadiance.map(
		(ambientChannel, channel) => ambientChannel + directionalIrradiance[channel] * phaseWeight,
	)
}


export function composeSingleLayerWater(options) {
	const medium = options?.medium ?? SB_WATER_MEDIUM_PRESETS.tropicalShallow
	const cosThetaView = clampNumber(toFiniteNumber(options?.cosThetaView, 1), 0, 1)
	const pathLengthMeters = refractedPathLengthMeters({
		depthMeters: options?.depthMeters,
		cosThetaView,
		indexOfRefraction: medium.indexOfRefraction,
	})
	const transmittance = beerLambertTransmittance(extinctionPerMeter(medium), pathLengthMeters)
	const scatteringAlbedo = scatteringAlbedoPerChannel(medium)
	const reflectedRadiance = toChannelTriplet(options?.reflectedRadiance, 0)
	const refractedRadiance = toChannelTriplet(options?.refractedRadiance, 0)
	const scatterSourceRadiance = toChannelTriplet(options?.scatterSourceRadiance, 0)
	const surfaceReflectance = schlickFresnelReflectance(
		cosThetaView,
		waterSurfaceReflectanceAtNormalIncidence(medium.indexOfRefraction),
	)
	const absorbedRadiance = transmittance.map(
		(channelTransmittance, channel) => channelTransmittance * refractedRadiance[channel],
	)
	const inScatteredRadiance = transmittance.map(
		(channelTransmittance, channel) =>
			scatteringAlbedo[channel] * (1 - channelTransmittance) * scatterSourceRadiance[channel],
	)
	const outgoingRadiance = absorbedRadiance.map(
		(channelAbsorbed, channel) =>
			surfaceReflectance * reflectedRadiance[channel] +
			(1 - surfaceReflectance) * (channelAbsorbed + inScatteredRadiance[channel]),
	)
	return {
		pathLengthMeters,
		surfaceReflectance,
		transmittance,
		scatteringAlbedo,
		absorbedRadiance,
		inScatteredRadiance,
		outgoingRadiance,
	}
}

export function encodeExtinctionCoefficient(extinctionValue) {
	const extinction = toFiniteNumber(extinctionValue, 0)
	if (0 >= extinction) return SB_EXTINCTION_ZERO_CODE
	const clampedExtinction = clampNumber(
		extinction,
		SB_MINIMUM_ENCODED_EXTINCTION_PER_METER,
		SB_MAXIMUM_ENCODED_EXTINCTION_PER_METER,
	)
	const normalized =
		Math.log(clampedExtinction / SB_MINIMUM_ENCODED_EXTINCTION_PER_METER) / EXTINCTION_LOG_SPAN
	return SB_EXTINCTION_CODE_MINIMUM + Math.round(normalized * EXTINCTION_CODE_SPAN)
}

export function decodeExtinctionCoefficient(code) {
	const integerCode = Math.round(
		clampNumber(toFiniteNumber(code, 0), SB_EXTINCTION_ZERO_CODE, SB_EXTINCTION_CODE_MAXIMUM),
	)
	if (integerCode === SB_EXTINCTION_ZERO_CODE) return 0
	const normalized = (integerCode - SB_EXTINCTION_CODE_MINIMUM) / EXTINCTION_CODE_SPAN
	return SB_MINIMUM_ENCODED_EXTINCTION_PER_METER * Math.exp(normalized * EXTINCTION_LOG_SPAN)
}

function encodeUnitByte(value) {
	return Math.round(clampNumber(toFiniteNumber(value, 0), 0, 1) * UNIT_CODE_MAXIMUM)
}

function decodeUnitByte(code) {
	return clampNumber(toFiniteNumber(code, 0), 0, UNIT_CODE_MAXIMUM) / UNIT_CODE_MAXIMUM
}

function encodeSignedUnitByte(value) {
	return Math.round((clampNumber(toFiniteNumber(value, 0), -1, 1) + 1) * SIGNED_UNIT_CODE_CENTER)
}

function decodeSignedUnitByte(code) {
	return clampNumber(toFiniteNumber(code, 0), 0, UNIT_CODE_MAXIMUM) / SIGNED_UNIT_CODE_CENTER - 1
}

function encodeIndexOfRefraction(value) {
	const normalized =
		(clampNumber(toFiniteNumber(value, SB_WATER_INDEX_OF_REFRACTION), SB_AIR_INDEX_OF_REFRACTION, SB_MAXIMUM_ENCODED_INDEX_OF_REFRACTION) -
			SB_AIR_INDEX_OF_REFRACTION) /
		(SB_MAXIMUM_ENCODED_INDEX_OF_REFRACTION - SB_AIR_INDEX_OF_REFRACTION)
	return Math.round(normalized * UNIT_CODE_MAXIMUM)
}

function decodeIndexOfRefraction(code) {
	const normalized = clampNumber(toFiniteNumber(code, 0), 0, UNIT_CODE_MAXIMUM) / UNIT_CODE_MAXIMUM
	return (
		SB_AIR_INDEX_OF_REFRACTION +
		normalized * (SB_MAXIMUM_ENCODED_INDEX_OF_REFRACTION - SB_AIR_INDEX_OF_REFRACTION)
	)
}


export function encodeWaterClosure(medium) {
	return {
		absorption: medium.absorptionPerMeter.map((value) => encodeExtinctionCoefficient(value)),
		scattering: medium.scatteringPerMeter.map((value) => encodeExtinctionCoefficient(value)),
		phaseG: encodeSignedUnitByte(medium.phaseAnisotropy),
		roughness: encodeUnitByte(medium.surfaceRoughness),
		ior: encodeIndexOfRefraction(medium.indexOfRefraction),
	}
}

export function decodeWaterClosure(encodedClosure) {
	return createWaterMedium({
		absorptionPerMeter: encodedClosure.absorption.map((code) => decodeExtinctionCoefficient(code)),
		scatteringPerMeter: encodedClosure.scattering.map((code) => decodeExtinctionCoefficient(code)),
		phaseAnisotropy: decodeSignedUnitByte(encodedClosure.phaseG),
		surfaceRoughness: decodeUnitByte(encodedClosure.roughness),
		indexOfRefraction: decodeIndexOfRefraction(encodedClosure.ior),
	})
}


export function singleLayerWaterClosureBytes() {
	return closureLayoutBytes(SB_WATER_CLOSURE_KIND)
}


export function packWaterUniform(options) {
	const medium = options?.medium ?? SB_WATER_MEDIUM_PRESETS.tropicalShallow
	const pathLengthMeters = refractedPathLengthMeters({
		depthMeters: options?.depthMeters,
		cosThetaView: options?.cosThetaView,
		indexOfRefraction: medium.indexOfRefraction,
	})
	const transmittance = beerLambertTransmittance(extinctionPerMeter(medium), pathLengthMeters)
	return [transmittance[0], transmittance[1], transmittance[2], averageScatteringAlbedo(medium)]
}


export function measureBeerLambertDeviation(options) {
	const medium = options?.medium ?? SB_WATER_MEDIUM_PRESETS.tropicalShallow
	const depthsMeters = options?.depthsMeters ?? SB_WATER_GATE_DEPTHS_METERS
	const viewCosines = options?.viewCosines ?? SB_WATER_GATE_VIEW_COSINES
	const referenceExtinction = extinctionPerMeter(medium)
	const encodedExtinction = extinctionPerMeter(decodeWaterClosure(encodeWaterClosure(medium)))
	const samples = []

	for (const depthMeters of depthsMeters) {
		for (const cosThetaView of viewCosines) {
			const pathLengthMeters = refractedPathLengthMeters({
				depthMeters,
				cosThetaView,
				indexOfRefraction: medium.indexOfRefraction,
			})
			const reference = beerLambertTransmittance(referenceExtinction, pathLengthMeters)
			const encoded = beerLambertTransmittance(encodedExtinction, pathLengthMeters)
			for (const channel of CHANNEL_INDEXES) {
				const absoluteDeviation = Math.abs(encoded[channel] - reference[channel])
				samples.push({
					depthMeters,
					cosThetaView,
					channel,
					pathLengthMeters,
					referenceTransmittance: reference[channel],
					encodedTransmittance: encoded[channel],
					absoluteDeviation,
					relativeDeviation: reference[channel] > 0 ? absoluteDeviation / reference[channel] : 0,
				})
			}
		}
	}

	const brightBandSamples = samples.filter(
		(sample) => sample.referenceTransmittance >= SB_WATER_BRIGHT_BAND_TRANSMITTANCE_FLOOR,
	)
	return {
		sampleCount: samples.length,
		worstAbsoluteDeviation: largestValue(samples.map((sample) => sample.absoluteDeviation)),
		worstBrightBandRelativeDeviation: largestValue(
			brightBandSamples.map((sample) => sample.relativeDeviation),
		),
		brightBandSampleCount: brightBandSamples.length,
		samples,
	}
}


export function measureEnergyConservation(options) {
	const mediums = options?.mediums ?? waterMediumPresetIds().map((presetId) => SB_WATER_MEDIUM_PRESETS[presetId])
	const depthsMeters = options?.depthsMeters ?? SB_WATER_GATE_DEPTHS_METERS
	const viewCosines = options?.viewCosines ?? SB_WATER_GATE_VIEW_COSINES
	const unitRadiance = [1, 1, 1]
	let worstOutgoingRadiance = 0

	for (const medium of mediums) {
		for (const depthMeters of depthsMeters) {
			for (const cosThetaView of viewCosines) {
				const composition = composeSingleLayerWater({
					medium,
					depthMeters,
					cosThetaView,
					reflectedRadiance: unitRadiance,
					refractedRadiance: unitRadiance,
					scatterSourceRadiance: unitRadiance,
				})
				worstOutgoingRadiance = Math.max(worstOutgoingRadiance, largestValue(composition.outgoingRadiance))
			}
		}
	}

	return { worstOutgoingRadiance, createsEnergy: worstOutgoingRadiance > 1 + 1e-6 }
}


export function reflectionStackIntegrationProblems(passOwners) {
	const owners = passOwners ?? SB_PASS_OWNERS
	return Object.entries(owners)
		.filter(([, owner]) => owner === SB_WATER_PHASE_ID)
		.map(([passName]) => "SB-F26 nao pode possuir passe do grafo: " + passName)
}


export function certifySingleLayerWater(options) {
	const gates = options?.gates ?? SB_GATES
	const absorptionGate = gates.maxWaterAbsorptionDeviation
	const presetIds = waterMediumPresetIds()
	const problems = []
	let worstAbsoluteDeviation = 0
	let worstBrightBandRelativeDeviation = 0
	let worstPackingResidue = 0

	for (const presetId of presetIds) {
		const medium = SB_WATER_MEDIUM_PRESETS[presetId]
		const deviation = measureBeerLambertDeviation({ medium })
		worstAbsoluteDeviation = Math.max(worstAbsoluteDeviation, deviation.worstAbsoluteDeviation)
		worstBrightBandRelativeDeviation = Math.max(
			worstBrightBandRelativeDeviation,
			deviation.worstBrightBandRelativeDeviation,
		)
		worstPackingResidue = Math.max(worstPackingResidue, packedScatteringAlbedoResidue(medium))
		if (deviation.worstAbsoluteDeviation > absorptionGate) {
			problems.push(
				"absorcao de " +
					presetId +
					" desvia " +
					deviation.worstAbsoluteDeviation.toFixed(5) +
					" de Beer-Lambert, acima do portao " +
					absorptionGate,
			)
		}
		if (deviation.worstBrightBandRelativeDeviation > absorptionGate) {
			problems.push(
				"absorcao de " +
					presetId +
					" desvia " +
					deviation.worstBrightBandRelativeDeviation.toFixed(5) +
					" em termos relativos na faixa clara, acima do portao " +
					absorptionGate,
			)
		}
	}

	const energy = measureEnergyConservation()
	if (energy.createsEnergy) {
		problems.push("a camada de agua cria energia: saida " + energy.worstOutgoingRadiance.toFixed(5))
	}

	const closureBytes = singleLayerWaterClosureBytes()
	if (closureBytes === null) {
		problems.push("layout de closure ausente para " + SB_WATER_CLOSURE_KIND)
	} else if (closureBytes > SB_CLOSURE_BYTES_CEILING) {
		problems.push("closure de agua com " + closureBytes + " B, acima do teto " + SB_CLOSURE_BYTES_CEILING)
	}

	problems.push(...reflectionStackIntegrationProblems(options?.passOwners))

	return {
		ok: problems.length === 0,
		absorptionGate,
		presetCount: presetIds.length,
		worstAbsorptionDeviation: worstAbsoluteDeviation,
		worstBrightBandRelativeDeviation,
		worstScatteringAlbedoPackingResidue: worstPackingResidue,
		worstOutgoingRadiance: energy.worstOutgoingRadiance,
		closureBytes,
		registersGraphPass: false,
		problems,
	}
}


export function describeSingleLayerWater(options) {
	const certification = certifySingleLayerWater(options)
	return {
		phaseId: SB_WATER_PHASE_ID,
		closureKind: SB_WATER_CLOSURE_KIND,
		closureBytes: certification.closureBytes,
		uniformName: SB_WATER_UNIFORM_NAME,
		presets: waterMediumPresetIds(),
		absorptionGate: certification.absorptionGate,
		worstAbsorptionDeviation: certification.worstAbsorptionDeviation,
		registersGraphPass: certification.registersGraphPass,
		ok: certification.ok,
		problems: certification.problems,
	}
}
