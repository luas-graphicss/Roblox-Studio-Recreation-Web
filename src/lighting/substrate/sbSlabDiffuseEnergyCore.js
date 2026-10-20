import { SB_GATES } from "./sbMaterialContract.js"
import { SB_REFERENCE_SEED, generateStratifiedSamples } from "./sbReferenceSamplingCore.js"
import {
	directionFromCosineAndAzimuth,
	normalizeSlabForReference,
	viewDirectionFromCosine,
} from "./sbSlabBsdfReferenceCore.js"
import { integrateDirectionalAlbedoByImportanceSampling } from "./sbSlabReferenceIntegratorCore.js"
import {
	SB_SLAB_DIFFUSE_DEFAULT_MODEL,
	diffuseEnergyScaleFromSpecularAlbedo,
	evaluateSlabDiffuseBsdf,
} from "./sbSlabDiffuseCore.js"

export const SB_SLAB_DIFFUSE_DEFAULT_SAMPLE_COUNT = 256


export const SB_SLAB_DIFFUSE_GATE_ROUGHNESSES = [0.15, 0.45, 0.85]


export const SB_SLAB_DIFFUSE_GATE_VIEW_COSINES = [0.1, 0.3, 0.5, 0.7, 0.95]


export const SB_SLAB_DIFFUSE_ENERGY_SUM_TOLERANCE = 1e-6


export const SB_SLAB_DIFFUSE_MINIMUM_COMPARABLE_ENERGY = 1e-3


export const SB_SLAB_DIFFUSE_CERTIFICATION_SLAB = {
	albedo: [0.72, 0.72, 0.74],
	f0: [0.04, 0.04, 0.04],
	f90: [1, 1, 1],
	roughness: 0.3,
}


export const SB_SLAB_DIFFUSE_ENERGY_SUM_FIXTURES = [
	{ id: "dielectricChart", slab: SB_SLAB_DIFFUSE_CERTIFICATION_SLAB },
	{
		id: "brightDielectric",
		slab: { albedo: [0.95, 0.95, 0.95], f0: [0.08, 0.08, 0.08], f90: [1, 1, 1], roughness: 0.3 },
	},
	{
		id: "polishedMetal",
		slab: { albedo: [0, 0, 0], f0: [0.95, 0.93, 0.88], f90: [1, 1, 1], roughness: 0.3 },
	},
]

const CHANNEL_TOTAL = 3
const VIEW_COSINE_FLOOR = 1e-4
const PERCENT_DECIMALS = 3

function clampViewCosine(cosThetaView) {
	if (!Number.isFinite(cosThetaView)) return 1
	if (cosThetaView > 1) return 1
	return cosThetaView > VIEW_COSINE_FLOOR ? cosThetaView : VIEW_COSINE_FLOOR
}

function averageOfChannels(triplet) {
	return triplet.reduce((total, channel) => total + channel, 0) / triplet.length
}

function worstChannel(triplet) {
	return triplet.reduce((worst, channel) => (channel > worst ? channel : worst), 0)
}

function relativeErrorPerChannel(measured, reference) {
	return measured.map((channel, channelIndex) => {
		const referenceChannel = reference[channelIndex]
		const divisor = referenceChannel > SB_SLAB_DIFFUSE_MINIMUM_COMPARABLE_ENERGY ? referenceChannel : 1
		return Math.abs(channel - referenceChannel) / divisor
	})
}


export function formatEnergyRatioAsPercent(ratio) {
	return (ratio * 100).toFixed(PERCENT_DECIMALS) + "%"
}


export function integrateSlabDiffuseDirectionalAlbedo(options) {
	const normalizedSlab = options.normalizedSlab ?? normalizeSlabForReference(options.slab)
	const model = options.model ?? SB_SLAB_DIFFUSE_DEFAULT_MODEL
	const cosThetaView = clampViewCosine(options.cosThetaView ?? 1)
	const seed = options.seed ?? SB_REFERENCE_SEED
	const viewDirection = viewDirectionFromCosine(cosThetaView)
	const stratified = generateStratifiedSamples({
		sampleCount: options.sampleCount ?? SB_SLAB_DIFFUSE_DEFAULT_SAMPLE_COUNT,
		seed,
	})

	const accumulated = new Array(CHANNEL_TOTAL).fill(0)
	for (const sample of stratified.samples) {
		const lightDirection = directionFromCosineAndAzimuth(Math.sqrt(sample.u), 2 * Math.PI * sample.v)
		const diffuseBsdf = evaluateSlabDiffuseBsdf({ normalizedSlab, viewDirection, lightDirection, model })
		diffuseBsdf.forEach((channel, channelIndex) => {
			accumulated[channelIndex] += channel * Math.PI
		})
	}

	const diffuse = accumulated.map((total) => total / stratified.sampleCount)
	return {
		model,
		strategy: "cosineImportance",
		cosThetaView,
		roughness: normalizedSlab.roughness,
		sampleCount: stratified.sampleCount,
		gridSize: stratified.gridSize,
		seed,
		diffuse,
		average: averageOfChannels(diffuse),
	}
}


function referenceDirectionalAlbedo(slab, cosThetaView, sampleCount, seed) {
	return integrateDirectionalAlbedoByImportanceSampling({ slab, cosThetaView, sampleCount, seed })
}


export function measureSlabDiffuseEnergyError(options = {}) {
	const slab = options.slab ?? SB_SLAB_DIFFUSE_CERTIFICATION_SLAB
	const normalizedSlab = normalizeSlabForReference(slab)
	const model = options.model ?? SB_SLAB_DIFFUSE_DEFAULT_MODEL
	const sampleCount = options.sampleCount ?? SB_SLAB_DIFFUSE_DEFAULT_SAMPLE_COUNT
	const seed = options.seed ?? SB_REFERENCE_SEED
	const viewCosines = options.viewCosines ?? SB_SLAB_DIFFUSE_GATE_VIEW_COSINES

	const perView = viewCosines.map((cosThetaView) => {
		const measured = integrateSlabDiffuseDirectionalAlbedo({ normalizedSlab, cosThetaView, model, sampleCount, seed })
		const reference = referenceDirectionalAlbedo(slab, cosThetaView, sampleCount, seed)
		return {
			cosThetaView: measured.cosThetaView,
			measuredDiffuse: measured.diffuse,
			referenceDiffuse: reference.diffuse,
			relativeError: worstChannel(relativeErrorPerChannel(measured.diffuse, reference.diffuse)),
		}
	})

	const worstView = perView.reduce(
		(worst, entry) => (entry.relativeError > worst.relativeError ? entry : worst),
		perView[0],
	)
	return {
		model,
		roughness: normalizedSlab.roughness,
		sampleCount,
		seed,
		perView,
		worstRelativeError: worstView.relativeError,
		worstCosThetaView: worstView.cosThetaView,
	}
}


export function measureDiffuseSpecularEnergySum(options = {}) {
	const slab = options.slab ?? SB_SLAB_DIFFUSE_CERTIFICATION_SLAB
	const normalizedSlab = normalizeSlabForReference(slab)
	const model = options.model ?? SB_SLAB_DIFFUSE_DEFAULT_MODEL
	const sampleCount = options.sampleCount ?? SB_SLAB_DIFFUSE_DEFAULT_SAMPLE_COUNT
	const seed = options.seed ?? SB_REFERENCE_SEED
	const viewCosines = options.viewCosines ?? SB_SLAB_DIFFUSE_GATE_VIEW_COSINES

	const perView = viewCosines.map((cosThetaView) => {
		const reference = referenceDirectionalAlbedo(slab, cosThetaView, sampleCount, seed)
		const measured = integrateSlabDiffuseDirectionalAlbedo({ normalizedSlab, cosThetaView, model, sampleCount, seed })
		const energyScale = diffuseEnergyScaleFromSpecularAlbedo(reference.specular)
		const coupledDiffuse = measured.diffuse.map((channel, channelIndex) => channel * energyScale[channelIndex])
		const totalPerChannel = coupledDiffuse.map((channel, channelIndex) => channel + reference.specular[channelIndex])
		return {
			cosThetaView: measured.cosThetaView,
			specular: reference.specular,
			energyScale,
			coupledDiffuse,
			totalPerChannel,
			worstChannelTotal: worstChannel(totalPerChannel),
		}
	})

	const worstView = perView.reduce(
		(worst, entry) => (entry.worstChannelTotal > worst.worstChannelTotal ? entry : worst),
		perView[0],
	)
	return {
		model,
		roughness: normalizedSlab.roughness,
		sampleCount,
		seed,
		perView,
		worstSum: worstView.worstChannelTotal,
		worstCosThetaView: worstView.cosThetaView,
	}
}


export function isSlabDiffuseIntegrationDeterministic(options = {}) {
	const integrationOptions = { slab: options.slab ?? SB_SLAB_DIFFUSE_CERTIFICATION_SLAB, ...options }
	const first = integrateSlabDiffuseDirectionalAlbedo(integrationOptions)
	const second = integrateSlabDiffuseDirectionalAlbedo(integrationOptions)
	return first.diffuse.every((channel, channelIndex) => channel === second.diffuse[channelIndex])
}


export function certifySlabDiffuse(options = {}) {
	const gates = options.gates ?? SB_GATES
	const model = options.model ?? SB_SLAB_DIFFUSE_DEFAULT_MODEL
	const sampleCount = options.sampleCount ?? SB_SLAB_DIFFUSE_DEFAULT_SAMPLE_COUNT
	const seed = options.seed ?? SB_REFERENCE_SEED
	const roughnesses = options.roughnesses ?? SB_SLAB_DIFFUSE_GATE_ROUGHNESSES
	const viewCosines = options.viewCosines ?? SB_SLAB_DIFFUSE_GATE_VIEW_COSINES
	const energySlab = options.slab ?? SB_SLAB_DIFFUSE_CERTIFICATION_SLAB
	const fixtures = options.fixtures ?? SB_SLAB_DIFFUSE_ENERGY_SUM_FIXTURES
	const maxRelativeError = gates.maxReferenceEnergyDeviation
	const maxEnergySum = 1 + SB_SLAB_DIFFUSE_ENERGY_SUM_TOLERANCE

	const byRoughness = roughnesses.map((roughness) => {
		const energy = measureSlabDiffuseEnergyError({
			slab: { ...energySlab, roughness },
			model,
			viewCosines,
			sampleCount,
			seed,
		})
		return {
			roughness,
			worstRelativeError: energy.worstRelativeError,
			worstCosThetaView: energy.worstCosThetaView,
		}
	})

	const byFixture = []
	for (const fixture of fixtures) {
		for (const roughness of roughnesses) {
			const sum = measureDiffuseSpecularEnergySum({
				slab: { ...fixture.slab, roughness },
				model,
				viewCosines,
				sampleCount,
				seed,
			})
			byFixture.push({
				fixtureId: fixture.id,
				roughness,
				worstSum: sum.worstSum,
				worstCosThetaView: sum.worstCosThetaView,
			})
		}
	}

	const worstRelativeError = byRoughness.reduce(
		(worst, entry) => (entry.worstRelativeError > worst ? entry.worstRelativeError : worst),
		0,
	)
	const worstEnergySum = byFixture.reduce((worst, entry) => (entry.worstSum > worst ? entry.worstSum : worst), 0)
	const deterministic = isSlabDiffuseIntegrationDeterministic({
		slab: energySlab,
		model,
		cosThetaView: viewCosines[0],
		sampleCount,
		seed,
	})

	const problems = []
	if (worstRelativeError > maxRelativeError) {
		problems.push(
			"erro de energia da difusa em " +
				formatEnergyRatioAsPercent(worstRelativeError) +
				", portao em " +
				formatEnergyRatioAsPercent(maxRelativeError),
		)
	}
	if (worstEnergySum > maxEnergySum) {
		problems.push("difusa + especular chegou a " + worstEnergySum.toFixed(6) + ", o teto e 1")
	}
	if (!deterministic) {
		problems.push("a integracao da difusa nao repetiu o mesmo numero com o mesmo seed")
	}

	return {
		model,
		sampleCount,
		seed,
		roughnesses: [...roughnesses],
		viewCosineCount: viewCosines.length,
		energySampleTotal: byRoughness.length * viewCosines.length * sampleCount,
		sumSampleTotal: byFixture.length * viewCosines.length * sampleCount,
		maxRelativeError,
		maxEnergySum,
		worstRelativeError,
		worstEnergySum,
		byRoughness,
		byFixture,
		deterministic,
		ok: problems.length === 0,
		problems,
	}
}
