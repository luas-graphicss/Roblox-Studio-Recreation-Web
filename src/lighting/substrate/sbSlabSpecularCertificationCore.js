import { SB_GATES } from "./sbMaterialContract.js"
import { SB_FURNACE_ROUGHNESSES, SB_FURNACE_VIEW_COSINES, createWhiteFurnaceSlab } from "./sbFurnaceTestCore.js"
import { SB_REFERENCE_SEED } from "./sbReferenceSamplingCore.js"
import { directionFromCosineAndAzimuth, evaluateSlabBsdf, viewDirectionFromCosine } from "./sbSlabBsdfReferenceCore.js"
import { integrateDirectionalAlbedoByImportanceSampling } from "./sbSlabReferenceIntegratorCore.js"
import {
	SB_WHITE_FURNACE_FIT_MEASUREMENT,
	multiScatterEnergyScaleForChannel,
	whiteFurnaceDirectionalAlbedo,
} from "./sbEnvBrdfCore.js"
import { SB_SLAB_SPECULAR_GLSL, SB_SLAB_SPECULAR_PROTECTED_SYMBOLS } from "./sbSlabSpecularGlsl.js"
import { evaluateSlabSpecularBrdf, slabSpecularEnergyCompensation } from "./sbSlabSpecularCore.js"


export const SB_SLAB_SPECULAR_DEFAULT_SAMPLE_COUNT = 2048


export const SB_BRDF_PARITY_GATE = 1e-8


const MONOTONIC_ROUGHNESS_FLOOR = 0.3


const NEUTRAL_SCALE_TOLERANCE = 0.02

const GAIN_ROUGHNESS_SWEEP = Object.freeze([0.05, 0.2, 0.4, 0.6, 0.8, 1])

export const SB_SLAB_SPECULAR_CERTIFICATION_SLABS = Object.freeze([
	Object.freeze({ id: "dieletrico", slab: Object.freeze({ albedo: [0, 0, 0], f0: [0.04, 0.04, 0.04], f90: 1, roughness: 0.3 }) }),
	Object.freeze({ id: "metal", slab: Object.freeze({ albedo: [0, 0, 0], f0: [0.95, 0.64, 0.54], f90: 1, roughness: 0.35 }) }),
	Object.freeze({ id: "metalRugoso", slab: Object.freeze({ albedo: [0, 0, 0], f0: [0.56, 0.57, 0.58], f90: 1, roughness: 0.8 }) }),
])

export const formatPercent = (value) => (value * 100).toFixed(2) + "%"

const averageChannel = (triplet) => (triplet[0] + triplet[1] + triplet[2]) / 3

function resolveGates(options) {
	return options?.gates ?? SB_GATES
}

function resolveSampling(options) {
	return {
		sampleCount: options?.sampleCount ?? SB_SLAB_SPECULAR_DEFAULT_SAMPLE_COUNT,
		seed: options?.seed ?? SB_REFERENCE_SEED,
	}
}


function referenceWhiteFurnaceAlbedo(roughness, cosThetaView, sampleCount, seed) {
	const measurement = integrateDirectionalAlbedoByImportanceSampling({
		slab: createWhiteFurnaceSlab(roughness),
		cosThetaView,
		sampleCount,
		seed,
	})
	return averageChannel(measurement.specular)
}

export function measureWhiteFurnaceAgreement(options = {}) {
	const { sampleCount, seed } = resolveSampling(options)
	const gate = resolveGates(options).maxReferenceEnergyDeviation
	const perPoint = []
	let worstDeviation = 0
	let worstPoint = null
	for (const roughness of SB_FURNACE_ROUGHNESSES) {
		for (const cosThetaView of SB_FURNACE_VIEW_COSINES) {
			const reference = referenceWhiteFurnaceAlbedo(roughness, cosThetaView, sampleCount, seed)
			const model = whiteFurnaceDirectionalAlbedo(cosThetaView, roughness)
			const deviation = Math.abs(model - reference) / Math.max(reference, 1e-6)
			const point = { roughness, cosThetaView, reference, model, deviation }
			perPoint.push(point)
			if (deviation > worstDeviation) {
				worstDeviation = deviation
				worstPoint = point
			}
		}
	}
	return { sampleCount, seed, gate, perPoint, worstDeviation, worstPoint, ok: worstDeviation <= gate }
}

export function measureCompensatedFurnaceClosure(options = {}) {
	const { sampleCount, seed } = resolveSampling(options)
	const gates = resolveGates(options)
	const perPoint = []
	let minimum = Number.POSITIVE_INFINITY
	let maximum = Number.NEGATIVE_INFINITY
	for (const roughness of SB_FURNACE_ROUGHNESSES) {
		for (const cosThetaView of SB_FURNACE_VIEW_COSINES) {
			const reference = referenceWhiteFurnaceAlbedo(roughness, cosThetaView, sampleCount, seed)
			const modelAlbedo = whiteFurnaceDirectionalAlbedo(cosThetaView, roughness)

			const compensated = reference * multiScatterEnergyScaleForChannel(modelAlbedo, 1)
			perPoint.push({ roughness, cosThetaView, reference, modelAlbedo, compensated })
			minimum = Math.min(minimum, compensated)
			maximum = Math.max(maximum, compensated)
		}
	}
	return {
		sampleCount,
		seed,
		roughnessCount: SB_FURNACE_ROUGHNESSES.length,
		perPoint,
		minimum,
		maximum,
		worstDeviationFromOne: Math.max(Math.abs(1 - minimum), Math.abs(maximum - 1)),
		ok: minimum >= gates.furnaceMinimum && maximum <= gates.furnaceMaximum,
	}
}

export function measureBrdfParity(options = {}) {
	const viewCosines = options.viewCosines ?? [0.15, 0.4, 0.7, 1]
	const lightCosines = options.lightCosines ?? [0.1, 0.3, 0.6, 0.9]
	const azimuths = options.azimuths ?? [0, Math.PI / 3, Math.PI]
	let worstDifference = 0
	let comparisonCount = 0
	for (const entry of SB_SLAB_SPECULAR_CERTIFICATION_SLABS) {
		for (const cosThetaView of viewCosines) {
			const viewDirection = viewDirectionFromCosine(cosThetaView)
			for (const cosThetaLight of lightCosines) {
				for (const azimuth of azimuths) {
					const lightDirection = directionFromCosineAndAzimuth(cosThetaLight, azimuth)
					const model = evaluateSlabSpecularBrdf({ slab: entry.slab, viewDirection, lightDirection })
					const reference = evaluateSlabBsdf({ slab: entry.slab, viewDirection, lightDirection }).specular
					for (let channel = 0; channel < 3; channel += 1) {
						const difference = Math.abs(model[channel] - reference[channel]) / Math.max(Math.abs(reference[channel]), 1e-9)
						worstDifference = Math.max(worstDifference, difference)
					}
					comparisonCount += 1
				}
			}
		}
	}
	return { comparisonCount, worstDifference, gate: SB_BRDF_PARITY_GATE, ok: worstDifference <= SB_BRDF_PARITY_GATE }
}

export function measureDirectSpecularGain(options = {}) {
	const roughnessSweep = options.roughnessSweep ?? GAIN_ROUGHNESS_SWEEP
	const cosThetaView = options.cosThetaView ?? 1
	const perSlab = SB_SLAB_SPECULAR_CERTIFICATION_SLABS.map((entry) => {
		const samples = roughnessSweep.map((roughness) => {
			const compensation = slabSpecularEnergyCompensation({ slab: { ...entry.slab, roughness }, cosThetaView })
			return { roughness, whiteAlbedo: compensation.whiteAlbedo, scale: averageChannel(compensation.scale) }
		})
		const aboveFloor = samples.filter((sample) => sample.roughness >= MONOTONIC_ROUGHNESS_FLOOR)
		const belowFloor = samples.filter((sample) => sample.roughness < MONOTONIC_ROUGHNESS_FLOOR)
		return {
			id: entry.id,
			samples,
			neverRemovesLight: samples.every((sample) => sample.scale >= 1 - 1e-9),
			growsWithRoughness: aboveFloor.every((sample, index) => index === 0 || sample.scale >= aboveFloor[index - 1].scale - 1e-9),
			neutralWhereLossIsNegligible: belowFloor.every((sample) => sample.scale <= 1 + NEUTRAL_SCALE_TOLERANCE),
			maximumScale: samples.reduce((worst, sample) => Math.max(worst, sample.scale), 0),
		}
	})
	return {
		cosThetaView,
		perSlab,
		maximumScale: perSlab.reduce((worst, entry) => Math.max(worst, entry.maximumScale), 0),
		ok: perSlab.every((entry) => entry.neverRemovesLight && entry.growsWithRoughness && entry.neutralWhereLossIsNegligible),
	}
}

export function measureModelDomainSafety(options = {}) {
	const stepCount = options.stepCount ?? 24
	let minimumAlbedo = Number.POSITIVE_INFINITY
	let maximumAlbedo = Number.NEGATIVE_INFINITY
	let pointCount = 0
	let allFinite = true
	for (let roughnessStep = 0; roughnessStep <= stepCount; roughnessStep += 1) {
		const roughness = roughnessStep / stepCount
		for (let cosineStep = 0; cosineStep <= stepCount; cosineStep += 1) {
			const cosThetaView = cosineStep / stepCount
			const albedo = whiteFurnaceDirectionalAlbedo(cosThetaView, roughness)
			const scale = multiScatterEnergyScaleForChannel(albedo, 1)
			if (!Number.isFinite(albedo) || !Number.isFinite(scale)) allFinite = false
			minimumAlbedo = Math.min(minimumAlbedo, albedo)
			maximumAlbedo = Math.max(maximumAlbedo, albedo)
			pointCount += 1
		}
	}
	return {
		pointCount,
		minimumAlbedo,
		maximumAlbedo,
		allFinite,
		ok: allFinite && minimumAlbedo > 0 && maximumAlbedo <= 1,
	}
}

function isWordCharacter(character) {
	if (character === undefined) return false
	if (character >= "a" && character <= "z") return true
	if (character >= "A" && character <= "Z") return true
	if (character >= "0" && character <= "9") return true
	return character === "_"
}

function skipWhitespace(text, index) {
	let position = index
	while (position < text.length && (text[position] === " " || text[position] === "\t" || text[position] === "\n" || text[position] === "\r")) {
		position += 1
	}
	return position
}


function isAssignmentAt(text, index) {
	const character = text[index]
	const next = text[index + 1]
	if (character === "=") return next !== "="
	if (character === "+" || character === "-") return next === "=" || next === character
	if (character === "*" || character === "/") return next === "="
	return false
}


function skipAccessChain(text, index) {
	let position = index
	while (position < text.length) {
		const character = text[position]
		if (character === "." || isWordCharacter(character)) {
			position += 1
			continue
		}
		if (character === "[") {
			const closing = text.indexOf("]", position)
			if (closing < 0) return position
			position = closing + 1
			continue
		}
		return position
	}
	return position
}


export function findSymbolWrite(glslText, symbol) {
	let index = glslText.indexOf(symbol)
	while (index >= 0) {
		const characterBefore = glslText[index - 1]
		const isStandaloneSymbol = !isWordCharacter(characterBefore) && characterBefore !== "."
		if (isStandaloneSymbol) {
			const afterChain = skipAccessChain(glslText, index + symbol.length)
			const assignmentIndex = skipWhitespace(glslText, afterChain)
			if (isAssignmentAt(glslText, assignmentIndex)) {
				return { symbol, index, excerpt: glslText.slice(Math.max(0, index - 24), assignmentIndex + 12).trim() }
			}
		}
		index = glslText.indexOf(symbol, index + 1)
	}
	return null
}

export function findSpecularAntiAliasingRisks(glslText, protectedSymbols = SB_SLAB_SPECULAR_PROTECTED_SYMBOLS) {
	const risks = []
	for (const symbol of protectedSymbols) {
		const write = findSymbolWrite(glslText, symbol)
		if (write) risks.push(write)
	}
	return risks
}

export function certifySpecularAntiAliasing() {
	const risks = []
	for (const blockName of Object.keys(SB_SLAB_SPECULAR_GLSL)) {
		for (const risk of findSpecularAntiAliasingRisks(SB_SLAB_SPECULAR_GLSL[blockName])) {
			risks.push({ blockName, ...risk })
		}
	}
	return { protectedSymbols: SB_SLAB_SPECULAR_PROTECTED_SYMBOLS, risks, ok: risks.length === 0 }
}

export function certifySlabSpecular(options = {}) {
	const whiteFurnaceAgreement = measureWhiteFurnaceAgreement(options)
	const furnaceClosure = measureCompensatedFurnaceClosure(options)
	const brdfParity = measureBrdfParity(options)
	const directSpecularGain = measureDirectSpecularGain(options)
	const domainSafety = measureModelDomainSafety(options)
	const specularAntiAliasing = certifySpecularAntiAliasing()
	const problems = []
	if (!whiteFurnaceAgreement.ok) {
		problems.push(
			"albedo do forno discorda da SB-F5 em " +
				formatPercent(whiteFurnaceAgreement.worstDeviation) +
				" (portao " +
				formatPercent(whiteFurnaceAgreement.gate) +
				")",
		)
	}
	if (!furnaceClosure.ok) {
		problems.push("forno compensado fora da faixa: " + furnaceClosure.minimum.toFixed(4) + ".." + furnaceClosure.maximum.toFixed(4))
	}
	if (!brdfParity.ok) problems.push("lobo do modelo difere do lobo da SB-F5 em " + brdfParity.worstDifference.toExponential(3))
	if (!directSpecularGain.ok) problems.push("compensacao no direto nao se comporta: ver perSlab")
	if (!domainSafety.ok) problems.push("modelo sai da fisica no dominio: albedo " + domainSafety.minimumAlbedo.toFixed(4) + ".." + domainSafety.maximumAlbedo.toFixed(4))
	if (!specularAntiAliasing.ok) problems.push("GLSL escreve em simbolo do specular AA: " + specularAntiAliasing.risks.map((risk) => risk.symbol).join(", "))
	return {
		phaseId: "SB-F10",
		fit: SB_WHITE_FURNACE_FIT_MEASUREMENT,
		whiteFurnaceAgreement,
		furnaceClosure,
		brdfParity,
		directSpecularGain,
		domainSafety,
		specularAntiAliasing,
		problems,
		ok: problems.length === 0,
	}
}
