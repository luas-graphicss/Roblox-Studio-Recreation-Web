import { SB_GATES } from "./sbMaterialContract.js"
import { SB_REFERENCE_SEED, deriveSeed, generateStratifiedSamples } from "./sbReferenceSamplingCore.js"
import {
	directionFromCosineAndAzimuth,
	evaluateSlabBsdf,
	viewDirectionFromCosine,
} from "./sbSlabBsdfReferenceCore.js"
import { integrateDirectionalAlbedoByImportanceSampling } from "./sbSlabReferenceIntegratorCore.js"
import { createWhiteFurnaceSlab } from "./sbFurnaceTestCore.js"
import { evaluateDualSpecularLobeBsdf, normalizeDualSpecularLobe } from "./sbDualSpecularLobeCore.js"


export const SB_DUAL_LOBE_DEFAULT_SAMPLE_COUNT = 512


export const SB_DUAL_LOBE_ENERGY_SAMPLE_COUNT = 4096


export const SB_DUAL_LOBE_ENERGY_FLOOR = 0.05


export const SB_DUAL_LOBE_LINEARITY_TOLERANCE = 1e-9


export const SB_DUAL_LOBE_CONVEXITY_TOLERANCE = 1e-9

export const SB_DUAL_LOBE_VIEW_COSINES = [0.35, 0.6, 0.85]


export const SB_DUAL_LOBE_MIXTURE_CASES = [
	{ baseRoughness: 0.1, secondRoughness: 0.35, secondWeight: 0.25 },
	{ baseRoughness: 0.3, secondRoughness: 0.7, secondWeight: 0.5 },
	{ baseRoughness: 0.45, secondRoughness: 0.9, secondWeight: 0.75 },
	{ baseRoughness: 0.2, secondRoughness: 0.6, secondWeight: 1 },
]


export const SB_DUAL_LOBE_ENERGY_CASES = [
	{ baseRoughness: 0.5, secondRoughness: 0.8, secondWeight: 0.25 },
	{ baseRoughness: 0.6, secondRoughness: 0.9, secondWeight: 0.5 },
	{ baseRoughness: 0.65, secondRoughness: 0.95, secondWeight: 1 },
]


export const SB_DUAL_LOBE_PARITY_SLABS = [
	{ albedo: [0.72, 0.72, 0.74], f0: [0.04, 0.04, 0.04], f90: 1 },
	{ albedo: [0, 0, 0], f0: [0.95, 0.93, 0.88], f90: 1 },
]

export const SB_DUAL_LOBE_PARITY_ROUGHNESSES = [0.05, 0.2, 0.4, 0.7, 1]
export const SB_DUAL_LOBE_PARITY_VIEW_COSINES = [0.15, 0.5, 0.95]
export const SB_DUAL_LOBE_PARITY_LIGHT_COSINES = [0.25, 0.8]
export const SB_DUAL_LOBE_PARITY_AZIMUTHS = [0, 2.2]

const MINIMUM_COSINE = 1e-6
const FULL_HEMISPHERE_SOLID_ANGLE = 2 * Math.PI
const FULL_WEIGHT = 1
const NO_WEIGHT = 0

function averageChannels(triplet) {
	return (triplet[0] + triplet[1] + triplet[2]) / 3
}

function relativeDeviation(measured, reference) {
	return Math.abs(measured - reference) / Math.max(Math.abs(reference), SB_DUAL_LOBE_ENERGY_FLOOR)
}


export function createDualLobeFurnaceSlab(caseDefinition) {
	return {
		...createWhiteFurnaceSlab(caseDefinition.baseRoughness),
		secondRoughness: caseDefinition.secondRoughness,
		secondRoughnessWeight: caseDefinition.secondWeight,
	}
}


function integrateSpecularEnergyByUniformHemisphere(options) {
	const { normalizedLobes, cosThetaView, samples } = options
	const viewDirection = viewDirectionFromCosine(cosThetaView)
	let accumulatedEnergy = 0
	for (const sample of samples) {
		const cosThetaLight = sample.u
		if (MINIMUM_COSINE >= cosThetaLight) continue
		const lightDirection = directionFromCosineAndAzimuth(cosThetaLight, 2 * Math.PI * sample.v)
		const bsdf = evaluateDualSpecularLobeBsdf({ normalizedLobes, viewDirection, lightDirection })
		accumulatedEnergy += averageChannels(bsdf.specular) * cosThetaLight * FULL_HEMISPHERE_SOLID_ANGLE
	}
	return accumulatedEnergy / samples.length
}

function lobesForWeight(caseDefinition, secondWeight) {
	return normalizeDualSpecularLobe(createDualLobeFurnaceSlab({ ...caseDefinition, secondWeight }))
}


export function measureDualLobeMixture(options) {
	const caseDefinition = options.case
	const cosThetaView = options.cosThetaView
	const sampleCount = options.sampleCount ?? SB_DUAL_LOBE_DEFAULT_SAMPLE_COUNT
	const seed = options.seed ?? SB_REFERENCE_SEED
	const stratified = generateStratifiedSamples({ sampleCount, seed: deriveSeed(seed, 12) })
	const samples = stratified.samples
	const secondWeight = caseDefinition.secondWeight
	const mixtureEnergy = integrateSpecularEnergyByUniformHemisphere({
		normalizedLobes: lobesForWeight(caseDefinition, secondWeight),
		cosThetaView,
		samples,
	})
	const baseLobeEnergy = integrateSpecularEnergyByUniformHemisphere({
		normalizedLobes: lobesForWeight(caseDefinition, NO_WEIGHT),
		cosThetaView,
		samples,
	})
	const secondLobeEnergy = integrateSpecularEnergyByUniformHemisphere({
		normalizedLobes: lobesForWeight(caseDefinition, FULL_WEIGHT),
		cosThetaView,
		samples,
	})
	const expectedEnergy = baseLobeEnergy * (FULL_WEIGHT - secondWeight) + secondLobeEnergy * secondWeight
	const lowestLobeEnergy = Math.min(baseLobeEnergy, secondLobeEnergy)
	const highestLobeEnergy = Math.max(baseLobeEnergy, secondLobeEnergy)
	return {
		cosThetaView,
		baseRoughness: caseDefinition.baseRoughness,
		secondRoughness: caseDefinition.secondRoughness,
		secondWeight,
		sampleCount: stratified.sampleCount,
		seed,
		mixtureEnergy,
		baseLobeEnergy,
		secondLobeEnergy,
		expectedEnergy,
		linearityDeviation: relativeDeviation(mixtureEnergy, expectedEnergy),
		isWithinLobeRange:
			mixtureEnergy + SB_DUAL_LOBE_CONVEXITY_TOLERANCE >= lowestLobeEnergy &&
			highestLobeEnergy + SB_DUAL_LOBE_CONVEXITY_TOLERANCE >= mixtureEnergy,
	}
}


export function measureDualLobeCrossStrategyEnergy(options) {
	const caseDefinition = options.case
	const cosThetaView = options.cosThetaView
	const sampleCount = options.sampleCount ?? SB_DUAL_LOBE_ENERGY_SAMPLE_COUNT
	const seed = options.seed ?? SB_REFERENCE_SEED
	const bruteForce = measureDualLobeMixture({ case: caseDefinition, cosThetaView, sampleCount, seed })
	const importanceBaseLobe = integrateDirectionalAlbedoByImportanceSampling({
		slab: createWhiteFurnaceSlab(caseDefinition.baseRoughness),
		cosThetaView,
		sampleCount,
		seed: deriveSeed(seed, 21),
	})
	const importanceSecondLobe = integrateDirectionalAlbedoByImportanceSampling({
		slab: createWhiteFurnaceSlab(caseDefinition.secondRoughness),
		cosThetaView,
		sampleCount,
		seed: deriveSeed(seed, 22),
	})
	const importanceEnergy =
		averageChannels(importanceBaseLobe.specular) * (FULL_WEIGHT - caseDefinition.secondWeight) +
		averageChannels(importanceSecondLobe.specular) * caseDefinition.secondWeight
	return {
		...bruteForce,
		importanceEnergy,
		energyDeviation: relativeDeviation(bruteForce.mixtureEnergy, importanceEnergy),
	}
}


export function measureZeroWeightParity(options) {
	const slabs = options?.slabs ?? SB_DUAL_LOBE_PARITY_SLABS
	const roughnesses = options?.roughnesses ?? SB_DUAL_LOBE_PARITY_ROUGHNESSES
	const viewCosines = options?.viewCosines ?? SB_DUAL_LOBE_PARITY_VIEW_COSINES
	const lightCosines = options?.lightCosines ?? SB_DUAL_LOBE_PARITY_LIGHT_COSINES
	const azimuths = options?.azimuths ?? SB_DUAL_LOBE_PARITY_AZIMUTHS
	const differences = []
	let comparisonCount = 0
	for (const paritySlab of slabs) {
		for (const roughness of roughnesses) {
			const singleLobeSlab = { ...paritySlab, roughness }
			const zeroWeightLobes = normalizeDualSpecularLobe({
				...singleLobeSlab,
				secondRoughness: 0.9,
				secondRoughnessWeight: NO_WEIGHT,
			})
			for (const cosThetaView of viewCosines) {
				const viewDirection = viewDirectionFromCosine(cosThetaView)
				for (const cosThetaLight of lightCosines) {
					for (const azimuth of azimuths) {
						const lightDirection = directionFromCosineAndAzimuth(cosThetaLight, azimuth)
						const singleLobe = evaluateSlabBsdf({ slab: singleLobeSlab, viewDirection, lightDirection })
						const dualLobe = evaluateDualSpecularLobeBsdf({
							normalizedLobes: zeroWeightLobes,
							viewDirection,
							lightDirection,
						})
						comparisonCount += 1
						if (JSON.stringify(dualLobe) !== JSON.stringify(singleLobe)) {
							differences.push(
								`rugosidade ${roughness}, vista ${cosThetaView}, luz ${cosThetaLight}: ${JSON.stringify(dualLobe)} != ${JSON.stringify(singleLobe)}`,
							)
						}
					}
				}
			}
		}
	}
	return { comparisonCount, differences, isIdentical: differences.length === 0 }
}


export function measureFullWeightParity(options) {
	const roughness = options?.baseRoughness ?? 0.2
	const secondRoughness = options?.secondRoughness ?? 0.7
	const viewCosines = options?.viewCosines ?? SB_DUAL_LOBE_PARITY_VIEW_COSINES
	const lightCosines = options?.lightCosines ?? SB_DUAL_LOBE_PARITY_LIGHT_COSINES
	const paritySlab = { ...SB_DUAL_LOBE_PARITY_SLABS[1], roughness }
	const fullWeightLobes = normalizeDualSpecularLobe({
		...paritySlab,
		secondRoughness,
		secondRoughnessWeight: FULL_WEIGHT,
	})
	const wideLobeSlab = { ...paritySlab, roughness: secondRoughness }
	const differences = []
	let comparisonCount = 0
	for (const cosThetaView of viewCosines) {
		const viewDirection = viewDirectionFromCosine(cosThetaView)
		for (const cosThetaLight of lightCosines) {
			const lightDirection = directionFromCosineAndAzimuth(cosThetaLight, 0)
			const wideLobe = evaluateSlabBsdf({ slab: wideLobeSlab, viewDirection, lightDirection })
			const dualLobe = evaluateDualSpecularLobeBsdf({
				normalizedLobes: fullWeightLobes,
				viewDirection,
				lightDirection,
			})
			comparisonCount += 1
			if (JSON.stringify(dualLobe.specular) !== JSON.stringify(wideLobe.specular)) {
				differences.push(
					`vista ${cosThetaView}, luz ${cosThetaLight}: ${JSON.stringify(dualLobe.specular)} != ${JSON.stringify(wideLobe.specular)}`,
				)
			}
		}
	}
	return { comparisonCount, differences, isIdentical: differences.length === 0 }
}

function measurementsFor(cases, viewCosines, measure) {
	const measurements = []
	for (const caseDefinition of cases) {
		for (const cosThetaView of viewCosines) {
			measurements.push(measure(caseDefinition, cosThetaView))
		}
	}
	return measurements
}


export function certifyDualSpecularLobeMixture(options) {
	const sampleCount = options?.sampleCount ?? SB_DUAL_LOBE_DEFAULT_SAMPLE_COUNT
	const seed = options?.seed ?? SB_REFERENCE_SEED
	const cases = options?.cases ?? SB_DUAL_LOBE_MIXTURE_CASES
	const viewCosines = options?.viewCosines ?? SB_DUAL_LOBE_VIEW_COSINES
	const problems = []

	const zeroWeightParity = measureZeroWeightParity()
	if (!zeroWeightParity.isIdentical) {
		problems.push(`peso zero mudou o lobo base em ${zeroWeightParity.differences.length} pares`)
	}
	const fullWeightParity = measureFullWeightParity()
	if (!fullWeightParity.isIdentical) {
		problems.push(`peso cheio nao reproduziu o lobo largo em ${fullWeightParity.differences.length} pares`)
	}

	const measurements = measurementsFor(cases, viewCosines, (caseDefinition, cosThetaView) =>
		measureDualLobeMixture({ case: caseDefinition, cosThetaView, sampleCount, seed }),
	)
	for (const measurement of measurements) {
		if (measurement.linearityDeviation > SB_DUAL_LOBE_LINEARITY_TOLERANCE) {
			problems.push(
				`mistura nao linear em rugosidade ${measurement.baseRoughness}/${measurement.secondRoughness}, peso ${measurement.secondWeight}: desvio ${measurement.linearityDeviation}`,
			)
		}
		if (!measurement.isWithinLobeRange) {
			problems.push(
				`mistura fora da faixa dos dois lobos em rugosidade ${measurement.baseRoughness}/${measurement.secondRoughness}: ${measurement.mixtureEnergy}`,
			)
		}
	}

	const linearityDeviations = measurements.map((measurement) => measurement.linearityDeviation)
	return {
		ok: problems.length === 0,
		problems,
		sampleCount,
		seed,
		zeroWeightParity,
		fullWeightParity,
		measurements,
		worstLinearityDeviation: Math.max(...linearityDeviations),
		linearityTolerance: SB_DUAL_LOBE_LINEARITY_TOLERANCE,
	}
}


export function certifyDualSpecularLobeEnergy(options) {
	const sampleCount = options?.sampleCount ?? SB_DUAL_LOBE_ENERGY_SAMPLE_COUNT
	const seed = options?.seed ?? SB_REFERENCE_SEED
	const gates = options?.gates ?? SB_GATES
	const gate = gates.maxDualLobeEnergyDeviation
	const cases = options?.cases ?? SB_DUAL_LOBE_ENERGY_CASES
	const viewCosines = options?.viewCosines ?? SB_DUAL_LOBE_VIEW_COSINES
	const measurements = measurementsFor(cases, viewCosines, (caseDefinition, cosThetaView) =>
		measureDualLobeCrossStrategyEnergy({ case: caseDefinition, cosThetaView, sampleCount, seed }),
	)
	const problems = []
	for (const measurement of measurements) {
		if (measurement.energyDeviation > gate) {
			problems.push(
				`energia fora do portao em rugosidade ${measurement.baseRoughness}/${measurement.secondRoughness}, peso ${measurement.secondWeight}, vista ${measurement.cosThetaView}: desvio ${measurement.energyDeviation} acima de ${gate}`,
			)
		}
		if (measurement.linearityDeviation > SB_DUAL_LOBE_LINEARITY_TOLERANCE) {
			problems.push(
				`mistura nao linear em rugosidade ${measurement.baseRoughness}/${measurement.secondRoughness}: desvio ${measurement.linearityDeviation}`,
			)
		}
	}
	const energyDeviations = measurements.map((measurement) => measurement.energyDeviation)
	return {
		ok: problems.length === 0,
		problems,
		gate,
		sampleCount,
		seed,
		measurements,
		worstEnergyDeviation: Math.max(...energyDeviations),
	}
}
