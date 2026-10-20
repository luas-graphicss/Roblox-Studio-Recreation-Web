import { SB_GATES, SB_TIER_NAMES } from "./sbMaterialContract.js"
import {
	SB_RADIANCE_CHANNEL_COUNT,
	accumulateDispatchPlan,
	isBitIdenticalRadiance,
	radianceDifference,
} from "./sbClosureAccumulationCore.js"
import { buildDispatchPlan, resolveTierName, tierClosureCeiling } from "./sbClosureDispatchCore.js"
import { buildCostReport, isCostMeasured } from "./sbClosureCostModelCore.js"
import {
	SB_AVERAGE_FRESNEL_TAIL_WEIGHT,
	multiScatterEnergyScaleForChannel,
	whiteFurnaceDirectionalAlbedo,
} from "./sbEnvBrdfCore.js"
import { diffuseEnergyScaleFromSpecularAlbedo, energyNormalizedRetroDiffuseWeight } from "./sbSlabDiffuseCore.js"
import { fresnelSchlickF0ToF90, normalizeSlabSpecular } from "./sbSlabSpecularCore.js"

export const SB_LIGHTING_BRIDGE_PHASE_ID = "SB-F31"


export const SB_LUMINANCE_WEIGHTS = Object.freeze([0.2126, 0.7152, 0.0722])


export const SB_LIGHTING_TERM_NAMES = Object.freeze(["direct", "ibl", "globalIllumination"])


export const SB_LIGHTING_GATE_CLOSURE_COUNT = 2


export const SB_LIGHTING_GATE_TIER_NAME = "medio"


export const SB_LIGHTING_GATE_ROUGHNESS_SPLIT = 0.1


export const SB_LIGHTING_GATE_SURFACE = Object.freeze({
	albedo: Object.freeze([0.62, 0.51, 0.37]),
	f0: Object.freeze([0.04, 0.04, 0.04]),
	f90: 1,
	roughness: 0.4,
	cosThetaView: 0.72,
	cosThetaLight: 0.55,
})


export const SB_LIGHTING_GATE_SAMPLE = Object.freeze({
	direct: Object.freeze({
		diffuse: Object.freeze([3.1, 2.9, 2.6]),
		specular: Object.freeze([3.1, 2.9, 2.6]),
	}),
	ibl: Object.freeze({
		diffuse: Object.freeze([0, 0, 0]),
		specular: Object.freeze([0.85, 0.92, 1.08]),
	}),
	globalIllumination: Object.freeze({
		diffuse: Object.freeze([0.44, 0.47, 0.55]),
		specular: Object.freeze([0, 0, 0]),
	}),
	shadowFactor: 0.82,
	photometricScale: 683,
})

const DEFAULT_SHADOW_FACTOR = 1
const DEFAULT_PHOTOMETRIC_SCALE = 1
const CLOSURE_KIND = "slab"

function clampToUnitRange(rawValue, fallbackValue) {
	const value = Number(rawValue)
	if (!Number.isFinite(value)) return fallbackValue
	if (value < 0) return 0
	if (value > 1) return 1
	return value
}

function asRadianceTriplet(candidate) {
	const source = Array.isArray(candidate) ? candidate : []
	const triplet = []
	for (let channel = 0; channel < SB_RADIANCE_CHANNEL_COUNT; channel += 1) {
		const value = Number(source[channel])
		triplet.push(Number.isFinite(value) && value > 0 ? value : 0)
	}
	return triplet
}

function multiplyTriplets(left, right) {
	return left.map((channelValue, channel) => channelValue * right[channel])
}

function addTriplets(left, right) {
	return left.map((channelValue, channel) => channelValue + right[channel])
}

function scaleTriplet(triplet, scalar) {
	return triplet.map((channelValue) => channelValue * scalar)
}

function percentText(value) {
	if (!Number.isFinite(value)) return "nao medido"
	return (value * 100).toFixed(4) + "%"
}


function relativeDeviation(measuredValue, referenceValue) {
	if (!Number.isFinite(measuredValue) || !Number.isFinite(referenceValue)) return Number.POSITIVE_INFINITY
	if (referenceValue === 0) return measuredValue === 0 ? 0 : Number.POSITIVE_INFINITY
	return Math.abs(measuredValue - referenceValue) / Math.abs(referenceValue)
}


export function luminanceOf(radianceTriplet) {
	const triplet = asRadianceTriplet(radianceTriplet)
	let luminance = 0
	for (let channel = 0; channel < SB_RADIANCE_CHANNEL_COUNT; channel += 1) {
		luminance += triplet[channel] * SB_LUMINANCE_WEIGHTS[channel]
	}
	return luminance
}


export function radianceEnergy(radiance) {
	return luminanceOf(radiance?.diffuse) + luminanceOf(radiance?.specular)
}


export function photometricNits(radiance, photometricScale) {
	const scale = Number(photometricScale)
	return radianceEnergy(radiance) * (Number.isFinite(scale) ? scale : DEFAULT_PHOTOMETRIC_SCALE)
}

function normalizeLightingTerm(rawTerm) {
	return {
		diffuse: asRadianceTriplet(rawTerm?.diffuse),
		specular: asRadianceTriplet(rawTerm?.specular),
	}
}


export function normalizeLightingSample(rawSample) {
	const sample = rawSample ?? {}
	const photometricScale = Number(sample.photometricScale)
	return {
		direct: normalizeLightingTerm(sample.direct),
		ibl: normalizeLightingTerm(sample.ibl),
		globalIllumination: normalizeLightingTerm(sample.globalIllumination),
		shadowFactor: clampToUnitRange(sample.shadowFactor, DEFAULT_SHADOW_FACTOR),
		photometricScale:
			Number.isFinite(photometricScale) && photometricScale > 0 ? photometricScale : DEFAULT_PHOTOMETRIC_SCALE,
	}
}


export function normalizeShadingSurface(rawSurface) {
	const surface = rawSurface ?? {}
	const specular = normalizeSlabSpecular({
		f0: surface.f0,
		f90: surface.f90,
		roughness: surface.roughness,
	})
	return {
		albedo: asRadianceTriplet(surface.albedo),
		f0: specular.f0,
		f90: specular.f90,
		roughness: specular.roughness,
		cosThetaView: clampToUnitRange(surface.cosThetaView, 1),
		cosThetaLight: clampToUnitRange(surface.cosThetaLight, 1),
	}
}


function averageFresnelForChannel(f0Channel, f90) {
	return f0Channel + (f90 - f0Channel) * SB_AVERAGE_FRESNEL_TAIL_WEIGHT
}


export function closureSpecularEnvBrdf(rawSurface) {
	const surface = normalizeShadingSurface(rawSurface)
	const directionalAlbedo = whiteFurnaceDirectionalAlbedo(surface.cosThetaView, surface.roughness)
	const fresnel = fresnelSchlickF0ToF90(surface.f0, surface.f90, surface.cosThetaView)
	const envBrdf = []
	for (let channel = 0; channel < SB_RADIANCE_CHANNEL_COUNT; channel += 1) {
		const averageFresnel = averageFresnelForChannel(surface.f0[channel], surface.f90)
		const multiScatterScale = multiScatterEnergyScaleForChannel(directionalAlbedo, averageFresnel)
		envBrdf.push(fresnel[channel] * directionalAlbedo * multiScatterScale)
	}
	return envBrdf
}


export function factorClosureShadingWeights(rawSurface) {
	const surface = normalizeShadingSurface(rawSurface)
	const specularEnvBrdf = closureSpecularEnvBrdf(surface)
	const diffuseEnergyScale = diffuseEnergyScaleFromSpecularAlbedo(specularEnvBrdf)
	return {
		diffuseAlbedo: multiplyTriplets(surface.albedo, diffuseEnergyScale),
		specularEnvBrdf,
		diffuseEnergyScale,
		diffuseShaping: energyNormalizedRetroDiffuseWeight(surface.roughness, surface.cosThetaLight),
	}
}


export function evaluateClosureLighting(input) {
	const surface = normalizeShadingSurface(input?.surface)
	const lighting = normalizeLightingSample(input?.lighting)
	const weights = factorClosureShadingWeights(surface)
	const shadedDirectDiffuse = scaleTriplet(lighting.direct.diffuse, lighting.shadowFactor * weights.diffuseShaping)
	const shadedDirectSpecular = scaleTriplet(lighting.direct.specular, lighting.shadowFactor)
	const unfactoredDiffuse = addTriplets(
		addTriplets(shadedDirectDiffuse, lighting.ibl.diffuse),
		lighting.globalIllumination.diffuse,
	)
	const unfactoredSpecular = addTriplets(
		addTriplets(shadedDirectSpecular, lighting.ibl.specular),
		lighting.globalIllumination.specular,
	)
	return {
		diffuse: multiplyTriplets(weights.diffuseAlbedo, unfactoredDiffuse),
		specular: multiplyTriplets(weights.specularEnvBrdf, unfactoredSpecular),
		weights,
		unfactored: { diffuse: unfactoredDiffuse, specular: unfactoredSpecular },
	}
}


export function shadeForwardSurface(input) {
	return evaluateClosureLighting(input)
}


export function splitSurfaceIntoClosures(input) {
	const surface = normalizeShadingSurface(input?.surface)
	const requestedCount = Number(input?.closureCount)
	const closureCount = Number.isInteger(requestedCount) && requestedCount > 0 ? requestedCount : 1
	const requestedSplit = Number(input?.roughnessSplit)
	const roughnessSplit = Number.isFinite(requestedSplit) ? requestedSplit : SB_LIGHTING_GATE_ROUGHNESS_SPLIT
	const weight = 1 / closureCount
	const closures = []
	for (let index = 0; index < closureCount; index += 1) {
		const spread = closureCount === 1 ? 0 : (index / (closureCount - 1)) * 2 - 1
		closures.push({
			label: "lightingBridgeClosure" + index,
			weight,
			surface: { ...surface, roughness: clampToUnitRange(surface.roughness * (1 + spread * roughnessSplit), 0) },
		})
	}
	return closures
}


export function buildLightingBridgePlan(input) {
	const closures = Array.isArray(input?.closures) ? input.closures : []
	const tierName = resolveTierName(input?.tierName)
	const plan = buildDispatchPlan({
		tierName,
		closures: closures.map((closure) => ({
			kind: CLOSURE_KIND,
			weight: closure.weight,
			label: closure.label,
		})),
	})
	return { tierName, closureCeiling: tierClosureCeiling(tierName), plan, closures }
}


function surfaceForDispatchedClosure(closures, dispatchedClosure, fallbackIndex) {
	const slot = dispatchedClosure?.slot
	if (Number.isInteger(slot) && slot >= 0 && slot < closures.length) return closures[slot]?.surface ?? null
	const sourceIndex = dispatchedClosure?.sourceIndex
	if (Number.isInteger(sourceIndex) && sourceIndex >= 0 && sourceIndex < closures.length) {
		return closures[sourceIndex]?.surface ?? null
	}
	if (fallbackIndex >= 0 && fallbackIndex < closures.length) return closures[fallbackIndex]?.surface ?? null
	return null
}


export function shadeClosurePlan(input) {
	const closures = Array.isArray(input?.closures) ? input.closures : []
	const lighting = normalizeLightingSample(input?.lighting)
	const dispatchedClosures = Array.isArray(input?.plan?.dispatched) ? input.plan.dispatched : []
	return accumulateDispatchPlan({
		plan: input?.plan,
		evaluateClosure: (dispatchedClosure) => {
			const fallbackIndex = dispatchedClosures.indexOf(dispatchedClosure)
			const surface = surfaceForDispatchedClosure(closures, dispatchedClosure, fallbackIndex)
			if (!surface) return null
			return evaluateClosureLighting({ surface, lighting })
		},
	})
}


function shadeBridgeSample(input) {
	const rawSurface = input?.surface ?? SB_LIGHTING_GATE_SURFACE
	const rawLighting = input?.lighting ?? SB_LIGHTING_GATE_SAMPLE
	const requestedCount = Number(input?.closureCount)
	const closureCount = Number.isInteger(requestedCount) && requestedCount > 0 ? requestedCount : SB_LIGHTING_GATE_CLOSURE_COUNT
	const surface = normalizeShadingSurface(rawSurface)
	const lighting = normalizeLightingSample(rawLighting)
	const closures = splitSurfaceIntoClosures({
		surface,
		closureCount,
		roughnessSplit: input?.roughnessSplit,
	})
	const bridgePlan = buildLightingBridgePlan({
		closures,
		tierName: input?.tierName ?? SB_LIGHTING_GATE_TIER_NAME,
	})
	const accumulated = shadeClosurePlan({ plan: bridgePlan.plan, closures, lighting })
	const forward = shadeForwardSurface({ surface, lighting })
	return {
		surface,
		lighting,
		rawPhotometricScale: Number(rawLighting?.photometricScale),
		closures,
		tierName: bridgePlan.tierName,
		closureCeiling: bridgePlan.closureCeiling,
		plan: bridgePlan.plan,
		accumulated,
		forward,
	}
}

function energyFromShadedSample(shadedSample) {
	const closureEnergy = radianceEnergy(shadedSample.accumulated)
	const forwardEnergy = radianceEnergy(shadedSample.forward)
	const deviation = relativeDeviation(closureEnergy, forwardEnergy)
	const gate = SB_GATES.maxClosureLightingEnergyDeviation
	return {
		closureCount: Array.isArray(shadedSample.plan?.dispatched) ? shadedSample.plan.dispatched.length : 0,
		tierName: shadedSample.tierName,
		closureEnergy,
		forwardEnergy,
		deviation,
		gate,
		withinGate: deviation <= gate,
		worstChannelDifference: radianceDifference(shadedSample.accumulated, shadedSample.forward),
		evaluationFailures: shadedSample.accumulated?.evaluationFailures ?? null,
	}
}

function photometryFromShadedSample(shadedSample) {
	const photometricScale = shadedSample.lighting.photometricScale
	const closureNits = photometricNits(shadedSample.accumulated, photometricScale)
	const forwardNits = photometricNits(shadedSample.forward, photometricScale)
	const deviation = relativeDeviation(closureNits, forwardNits)
	const gate = SB_GATES.maxPhotometryDeviation
	return {
		photometricScale,
		photometricScaleUnchanged: Number.isFinite(shadedSample.rawPhotometricScale)
			? shadedSample.rawPhotometricScale === photometricScale
			: true,
		closureNits,
		forwardNits,
		deviation,
		gate,
		withinGate: deviation <= gate,
	}
}


export function measureClosureLightingEnergy(input) {
	return energyFromShadedSample(shadeBridgeSample(input))
}


export function measurePhotometry(input) {
	return photometryFromShadedSample(shadeBridgeSample(input))
}


export function measureClosureLightingCost(input) {
	return buildCostReport({ plan: input?.plan, samples: input?.samples })
}


export function proveSingleClosureIdentity(input) {
	const surface = normalizeShadingSurface(input?.surface ?? SB_LIGHTING_GATE_SURFACE)
	const lighting = normalizeLightingSample(input?.lighting ?? SB_LIGHTING_GATE_SAMPLE)
	const closures = [{ label: "lightingBridgeForward", weight: 1, surface }]
	const bridgePlan = buildLightingBridgePlan({
		closures,
		tierName: input?.tierName ?? SB_LIGHTING_GATE_TIER_NAME,
	})
	const accumulated = shadeClosurePlan({ plan: bridgePlan.plan, closures, lighting })
	const forward = shadeForwardSurface({ surface, lighting })
	return {
		bitIdentical: isBitIdenticalRadiance(accumulated, forward),
		worstChannelDifference: radianceDifference(accumulated, forward),
		dispatchedCount: Array.isArray(bridgePlan.plan?.dispatched) ? bridgePlan.plan.dispatched.length : 0,
	}
}


export function evaluateLightingBridgeGate(input) {
	const shadedSample = shadeBridgeSample({
		surface: input?.surface,
		lighting: input?.lighting,
		closureCount: SB_LIGHTING_GATE_CLOSURE_COUNT,
		roughnessSplit: input?.roughnessSplit,
		tierName: input?.tierName ?? SB_LIGHTING_GATE_TIER_NAME,
	})
	const energy = energyFromShadedSample(shadedSample)
	const photometry = photometryFromShadedSample(shadedSample)
	const cost = measureClosureLightingCost({ plan: shadedSample.plan, samples: input?.costSamples })
	const identity = proveSingleClosureIdentity({
		surface: shadedSample.surface,
		lighting: shadedSample.lighting,
		tierName: shadedSample.tierName,
	})
	const costMeasured = isCostMeasured(cost)
	const problems = []
	if (energy.closureCount !== SB_LIGHTING_GATE_CLOSURE_COUNT) {
		problems.push(
			"o portao pede " + SB_LIGHTING_GATE_CLOSURE_COUNT + " closures despachadas e veio " + energy.closureCount,
		)
	}
	if (energy.evaluationFailures) {
		problems.push(energy.evaluationFailures + " closure(s) nao avaliada(s) pela ponte")
	}
	if (!energy.withinGate) {
		problems.push(
			"energia das closures desviou " + percentText(energy.deviation) + " do forward, acima de " + percentText(energy.gate),
		)
	}
	if (!photometry.withinGate) {
		problems.push(
			"fotometria desviou " + percentText(photometry.deviation) + " em nits, acima de " + percentText(photometry.gate),
		)
	}
	if (!photometry.photometricScaleUnchanged) {
		problems.push("a ponte alterou a escala fotometrica da amostra")
	}
	if (!identity.bitIdentical) {
		problems.push(
			"uma closure de peso 1 nao reproduz o forward bit a bit (pior canal " + identity.worstChannelDifference + ")",
		)
	}
	if (!costMeasured) {
		problems.push("custo por closure nao medido: " + (cost?.measured?.reason ?? "sem relatorio de custo"))
	}
	return {
		phaseId: SB_LIGHTING_BRIDGE_PHASE_ID,
		ok: problems.length === 0,
		problems,
		tierName: shadedSample.tierName,
		closureCeiling: shadedSample.closureCeiling,
		energy,
		photometry,
		cost,
		costMeasured,
		singleClosureIdentity: identity,
	}
}


export function describeLightingBridge() {
	return {
		phaseId: SB_LIGHTING_BRIDGE_PHASE_ID,
		lightingTerms: [...SB_LIGHTING_TERM_NAMES],
		factoredOutOfLighting: ["diffuseAlbedo", "specularEnvBrdf"],
		gateClosureCount: SB_LIGHTING_GATE_CLOSURE_COUNT,
		energyGate: SB_GATES.maxClosureLightingEnergyDeviation,
		photometryGate: SB_GATES.maxPhotometryDeviation,
		closureCeilingByTier: SB_TIER_NAMES.map((tierName) => ({
			tierName,
			closureCeiling: tierClosureCeiling(tierName),
		})),
	}
}
