import { SB_GATES } from "./sbMaterialContract.js"
import { SB_REFERENCE_SEED, deriveSeed, generateStratifiedSamples } from "./sbReferenceSamplingCore.js"
import {
	SB_REFERENCE_DEFAULT_SAMPLE_COUNT,
	buildDirectionalAlbedoTable,
	integrateDirectionalAlbedoByImportanceSampling,
	integrateDirectionalAlbedoByUniformHemisphere,
	integrateHemisphericalAlbedo,
	interpolateDirectionalAlbedo,
	isDirectionalAlbedoDeterministic,
} from "./sbSlabReferenceIntegratorCore.js"


export const SB_FURNACE_VIEW_COSINES = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1]


export const SB_FURNACE_ROUGHNESSES = [0.1, 0.25, 0.45, 0.65, 0.9]


export const SB_PURE_DIFFUSE_TOLERANCE = 0.005

const DEFAULT_DIFFUSE_SAMPLE_COUNT = 1024
const SATURATED_ENERGY_LIMIT = 1e-4


export function createWhiteFurnaceSlab(roughness) {
	const numericRoughness = Number(roughness)
	return {
		albedo: [0, 0, 0],
		f0: [1, 1, 1],
		f90: [1, 1, 1],
		roughness: Number.isFinite(numericRoughness) ? numericRoughness : 0.5,
	}
}


export function createPureDiffuseSlab() {
	return { albedo: [1, 1, 1], f0: [0, 0, 0], f90: [0, 0, 0], roughness: 1 }
}


function integrateMultiScatterEnergy(options) {
	const { table, singleScatterAlbedo, missingAverageEnergy, sampleCount, seed } = options


	if (missingAverageEnergy <= SATURATED_ENERGY_LIMIT) return 0
	const { samples, sampleCount: effectiveSampleCount } = generateStratifiedSamples({ sampleCount, seed })
	const missingViewEnergy = 1 - singleScatterAlbedo
	let accumulatedEnergy = 0
	for (const sample of samples) {
		const cosThetaLight = Math.sqrt(Math.max(0, sample.u))
		const lightAlbedo = interpolateDirectionalAlbedo(table, cosThetaLight)
		accumulatedEnergy += (missingViewEnergy * (1 - lightAlbedo)) / missingAverageEnergy
	}
	return accumulatedEnergy / effectiveSampleCount
}


export function runWhiteFurnaceTest(options) {
	const slab = createWhiteFurnaceSlab(options?.roughness)
	const sampleCount = options?.sampleCount ?? SB_REFERENCE_DEFAULT_SAMPLE_COUNT
	const seed = options?.seed ?? SB_REFERENCE_SEED
	const table = buildDirectionalAlbedoTable({
		slab,
		sampleCount,
		seed,
		viewCosineCount: options?.viewCosineCount,
	})
	const hemispherical = integrateHemisphericalAlbedo({ table })
	const missingAverageEnergy = 1 - hemispherical.average

	const perAngle = SB_FURNACE_VIEW_COSINES.map((cosThetaView, angleIndex) => {
		const directional = integrateDirectionalAlbedoByImportanceSampling({
			slab,
			cosThetaView,
			sampleCount,
			seed: deriveSeed(seed, angleIndex + 41),
		})
		const singleScatterAlbedo = directional.totalAverage
		const multiScatterEnergy = integrateMultiScatterEnergy({
			table,
			singleScatterAlbedo,
			missingAverageEnergy,
			sampleCount,
			seed: deriveSeed(seed, angleIndex + 97),
		})
		return {
			cosThetaView,
			singleScatter: singleScatterAlbedo,
			missingEnergy: 1 - singleScatterAlbedo,
			multiScatterEnergy,
			compensated: singleScatterAlbedo + multiScatterEnergy,
		}
	})

	const compensatedValues = perAngle.map((entry) => entry.compensated)
	const singleScatterValues = perAngle.map((entry) => entry.singleScatter)
	return {
		source: "SB-F5 reference integrator",
		roughness: slab.roughness,
		sampleCount,
		seed,
		averageAlbedo: hemispherical.average,
		missingAverageEnergy,
		perAngle,
		worstSingleScatter: Math.min(...singleScatterValues),
		compensatedMinimum: Math.min(...compensatedValues),
		compensatedMaximum: Math.max(...compensatedValues),
	}
}


export function measurePureDiffuseFurnace(options) {
	const slab = createPureDiffuseSlab()
	const sampleCount = options?.sampleCount ?? DEFAULT_DIFFUSE_SAMPLE_COUNT
	const seed = options?.seed ?? SB_REFERENCE_SEED
	const perAngle = SB_FURNACE_VIEW_COSINES.map((cosThetaView, angleIndex) => {
		const bruteForce = integrateDirectionalAlbedoByUniformHemisphere({
			slab,
			cosThetaView,
			sampleCount,
			seed: deriveSeed(seed, angleIndex + 11),
		})
		return { cosThetaView, energy: bruteForce.totalAverage }
	})
	const energies = perAngle.map((entry) => entry.energy)
	const minimum = Math.min(...energies)
	const maximum = Math.max(...energies)
	const worstDeviationFromUnity = Math.max(Math.abs(1 - minimum), Math.abs(1 - maximum))
	return {
		strategy: "uniformHemisphere",
		sampleCount,
		seed,
		perAngle,
		minimum,
		maximum,
		worstDeviationFromUnity,
		tolerance: SB_PURE_DIFFUSE_TOLERANCE,
		withinTolerance: worstDeviationFromUnity <= SB_PURE_DIFFUSE_TOLERANCE,
	}
}


export function furnaceTestVerdict(furnaceResult, gates) {
	const activeGates = gates ?? SB_GATES
	const minimum = furnaceResult.compensatedMinimum
	const maximum = furnaceResult.compensatedMaximum
	const withinRange = minimum >= activeGates.furnaceMinimum && maximum <= activeGates.furnaceMaximum
	return {
		ok: withinRange,
		minimum,
		maximum,
		allowedMinimum: activeGates.furnaceMinimum,
		allowedMaximum: activeGates.furnaceMaximum,
		detail: withinRange
			? "energia conservada dentro da faixa do contrato"
			: "forno fora da faixa do contrato: " + minimum.toFixed(4) + ".." + maximum.toFixed(4),
	}
}


export function certifyReferenceIntegrator(options) {
	const sampleCount = options?.sampleCount ?? SB_REFERENCE_DEFAULT_SAMPLE_COUNT
	const seed = options?.seed ?? SB_REFERENCE_SEED
	const gates = options?.gates ?? SB_GATES
	const roughnesses = options?.roughnesses ?? SB_FURNACE_ROUGHNESSES
	const problems = []

	const pureDiffuse = measurePureDiffuseFurnace({
		sampleCount: options?.diffuseSampleCount ?? DEFAULT_DIFFUSE_SAMPLE_COUNT,
		seed,
	})
	if (!pureDiffuse.withinTolerance) {
		problems.push(
			"slab difuso puro fora de 1,00 +-" +
				SB_PURE_DIFFUSE_TOLERANCE +
				": " +
				pureDiffuse.minimum.toFixed(5) +
				".." +
				pureDiffuse.maximum.toFixed(5),
		)
	}

	const byRoughness = roughnesses.map((roughness) => {
		const furnace = runWhiteFurnaceTest({ roughness, sampleCount, seed })
		return { roughness, furnace, verdict: furnaceTestVerdict(furnace, gates) }
	})
	for (const entry of byRoughness) {
		if (!entry.verdict.ok) {
			problems.push("forno GGX na rugosidade " + entry.roughness + ": " + entry.verdict.detail)
		}
	}

	const deterministic = isDirectionalAlbedoDeterministic({
		slab: createWhiteFurnaceSlab(0.4),
		cosThetaView: 0.6,
		sampleCount,
		seed,
	})
	if (!deterministic) {
		problems.push("o integrador nao e deterministico: a mesma semente devolveu numeros diferentes")
	}

	const compensatedValues = byRoughness.map((entry) => entry.furnace.compensatedMinimum)
	const compensatedMaximums = byRoughness.map((entry) => entry.furnace.compensatedMaximum)
	const worstSingleScatters = byRoughness.map((entry) => entry.furnace.worstSingleScatter)
	return {
		ok: problems.length === 0,
		problems,
		seed,
		sampleCount,
		deterministic,
		pureDiffuse,
		byRoughness,
		compensatedMinimum: Math.min(...compensatedValues),
		compensatedMaximum: Math.max(...compensatedMaximums),
		worstSingleScatter: Math.min(...worstSingleScatters),
		gates: { furnaceMinimum: gates.furnaceMinimum, furnaceMaximum: gates.furnaceMaximum },
	}
}
