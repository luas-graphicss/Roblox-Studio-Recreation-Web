import { SB_REFERENCE_SEED, deriveSeed, generateStratifiedSamples } from "./sbReferenceSamplingCore.js"
import {
	directionFromCosineAndAzimuth,
	evaluateSlabBsdf,
	lambertDiffuseBsdf,
	normalizeSlabForReference,
	reflectAroundHalfVector,
	sampleGgxVisibleNormal,
	viewDirectionFromCosine,
	visibleNormalSampleWeight,
} from "./sbSlabBsdfReferenceCore.js"

export const SB_REFERENCE_DEFAULT_SAMPLE_COUNT = 256
export const SB_REFERENCE_DEFAULT_VIEW_COSINE_COUNT = 32

const MINIMUM_COSINE = 1e-6
const FULL_HEMISPHERE_SOLID_ANGLE = 2 * Math.PI

function addScaledTriplet(target, triplet, scale) {
	target[0] += triplet[0] * scale
	target[1] += triplet[1] * scale
	target[2] += triplet[2] * scale
}

function sumTriplets(left, right) {
	return [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
}

function averageChannels(triplet) {
	return (triplet[0] + triplet[1] + triplet[2]) / 3
}

function tripletsAreIdentical(left, right) {
	return left[0] === right[0] && left[1] === right[1] && left[2] === right[2]
}

function resolveIntegrationInput(options) {
	return {
		normalizedSlab: options.normalizedSlab ?? normalizeSlabForReference(options.slab),
		cosThetaView: Math.min(1, Math.max(MINIMUM_COSINE, Number(options.cosThetaView))),
		sampleCount: options.sampleCount ?? SB_REFERENCE_DEFAULT_SAMPLE_COUNT,
		seed: options.seed ?? SB_REFERENCE_SEED,
	}
}


export function integrateDirectionalAlbedoByImportanceSampling(options) {
	const { normalizedSlab, cosThetaView, sampleCount, seed } = resolveIntegrationInput(options)
	const viewDirection = viewDirectionFromCosine(cosThetaView)

	const diffuseSamples = generateStratifiedSamples({ sampleCount, seed: deriveSeed(seed, 1) })
	const diffuseBsdf = lambertDiffuseBsdf(normalizedSlab.albedo)
	const diffuse = [0, 0, 0]
	for (const sample of diffuseSamples.samples) {


		const cosThetaLight = Math.sqrt(Math.max(0, sample.u))
		const probabilityDensity = cosThetaLight / Math.PI
		if (probabilityDensity <= MINIMUM_COSINE) continue
		addScaledTriplet(diffuse, diffuseBsdf, cosThetaLight / probabilityDensity / diffuseSamples.sampleCount)
	}

	const specularSamples = generateStratifiedSamples({ sampleCount, seed: deriveSeed(seed, 2) })
	const specular = [0, 0, 0]
	for (const sample of specularSamples.samples) {
		const halfVector = sampleGgxVisibleNormal({
			alpha: normalizedSlab.alpha,
			viewDirection,
			u: sample.u,
			v: sample.v,
		})
		const lightDirection = reflectAroundHalfVector(viewDirection, halfVector)
		if (lightDirection[2] <= MINIMUM_COSINE) continue
		const sampleWeight = visibleNormalSampleWeight({
			alpha: normalizedSlab.alpha,
			f0: normalizedSlab.f0,
			f90: normalizedSlab.f90,
			viewDirection,
			halfVector,
			lightDirection,
		})
		addScaledTriplet(specular, sampleWeight, 1 / specularSamples.sampleCount)
	}

	const total = sumTriplets(diffuse, specular)
	return {
		strategy: "importanceSampling",
		cosThetaView,
		roughness: normalizedSlab.roughness,
		sampleCount: specularSamples.sampleCount,
		seed,
		diffuse,
		specular,
		total,
		totalAverage: averageChannels(total),
	}
}


export function integrateDirectionalAlbedoByUniformHemisphere(options) {
	const { normalizedSlab, cosThetaView, sampleCount, seed } = resolveIntegrationInput(options)
	const viewDirection = viewDirectionFromCosine(cosThetaView)
	const hemisphereSamples = generateStratifiedSamples({ sampleCount, seed: deriveSeed(seed, 7) })
	const diffuse = [0, 0, 0]
	const specular = [0, 0, 0]
	for (const sample of hemisphereSamples.samples) {
		const cosThetaLight = sample.u
		if (cosThetaLight <= MINIMUM_COSINE) continue
		const lightDirection = directionFromCosineAndAzimuth(cosThetaLight, 2 * Math.PI * sample.v)
		const bsdf = evaluateSlabBsdf({ normalizedSlab, viewDirection, lightDirection })
		const sampleWeight = (cosThetaLight * FULL_HEMISPHERE_SOLID_ANGLE) / hemisphereSamples.sampleCount
		addScaledTriplet(diffuse, bsdf.diffuse, sampleWeight)
		addScaledTriplet(specular, bsdf.specular, sampleWeight)
	}
	const total = sumTriplets(diffuse, specular)
	return {
		strategy: "uniformHemisphere",
		cosThetaView,
		roughness: normalizedSlab.roughness,
		sampleCount: hemisphereSamples.sampleCount,
		seed,
		diffuse,
		specular,
		total,
		totalAverage: averageChannels(total),
	}
}


export function buildDirectionalAlbedoTable(options) {
	const normalizedSlab = options.normalizedSlab ?? normalizeSlabForReference(options.slab)
	const sampleCount = options.sampleCount ?? SB_REFERENCE_DEFAULT_SAMPLE_COUNT
	const seed = options.seed ?? SB_REFERENCE_SEED
	const viewCosineCount = Math.max(2, Math.floor(options.viewCosineCount ?? SB_REFERENCE_DEFAULT_VIEW_COSINE_COUNT))
	const entries = []
	for (let index = 0; index < viewCosineCount; index += 1) {
		const cosThetaView = (index + 0.5) / viewCosineCount
		const directional = integrateDirectionalAlbedoByImportanceSampling({
			normalizedSlab,
			cosThetaView,
			sampleCount,
			seed: deriveSeed(seed, index + 3),
		})
		entries.push({ cosThetaView, total: directional.total, average: directional.totalAverage })
	}
	return { entries, viewCosineCount, sampleCount, seed, roughness: normalizedSlab.roughness }
}


export function interpolateDirectionalAlbedo(table, cosThetaView) {
	const entries = table.entries
	const entryCount = entries.length
	const gridPosition = cosThetaView * entryCount - 0.5
	if (gridPosition <= 0) return entries[0].average
	if (gridPosition >= entryCount - 1) return entries[entryCount - 1].average
	const lowerIndex = Math.floor(gridPosition)
	const blend = gridPosition - lowerIndex
	return entries[lowerIndex].average * (1 - blend) + entries[lowerIndex + 1].average * blend
}


export function integrateHemisphericalAlbedo(options) {
	const table = options.table ?? buildDirectionalAlbedoTable(options)
	const entryCount = table.entries.length
	const total = [0, 0, 0]
	for (const entry of table.entries) {
		addScaledTriplet(total, entry.total, (2 * entry.cosThetaView) / entryCount)
	}
	return { total, average: averageChannels(total), table }
}


export function isDirectionalAlbedoDeterministic(options) {
	const firstRun = integrateDirectionalAlbedoByImportanceSampling(options)
	const secondRun = integrateDirectionalAlbedoByImportanceSampling(options)
	return (
		tripletsAreIdentical(firstRun.diffuse, secondRun.diffuse) &&
		tripletsAreIdentical(firstRun.specular, secondRun.specular) &&
		tripletsAreIdentical(firstRun.total, secondRun.total)
	)
}
