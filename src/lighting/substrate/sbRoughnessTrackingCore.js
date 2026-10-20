import { SB_MAX_TREE_DEPTH, SB_PASS_OWNERS } from "./sbMaterialContract.js"
import {
	bottomAttenuationFor,
	isVerticalLayeringNode,
	layerParametersOf,
	layeringOperandsOf,
	sanitizeLayer,
} from "./sbVerticalLayeringCore.js"
import { meanChannel, sanitizeViewCosine } from "./sbLayerTransmittanceCore.js"

export const SB_ROUGHNESS_TRACKING_OWNER = "SB-F32"


export const SB_LIGHTING_BRIDGE_PASS_NAME = "lightingBridge"

export const SB_COAT_LAYER_NAME = "coat"
export const SB_BASE_LAYER_NAME = "base"
export const SB_BASE_LOBE_ID = "base"
export const SB_COAT_LOBE_ID_PREFIX = "coat"

export const SB_MINIMUM_ROUGHNESS = 0
export const SB_MAXIMUM_ROUGHNESS = 1


export const SB_UNKNOWN_ROUGHNESS = 1


export const SB_DEFAULT_SPECULAR_REFLECTANCE = 0.04


export const SB_REFLECTION_RESOLVE_COUNT = 1

export const SB_LIGHTING_BRIDGE_STATES = Object.freeze({ ready: "ready", stub: "stub" })


export const SB_REFLECTION_CONSUMERS = Object.freeze({
	screenSpaceReflection: Object.freeze({
		id: "screenSpaceReflection",
		maxTrackedRoughness: 0.6,
		why: "acima disso o traco em espaco de tela vira ruido no mesmo orcamento de raios",
	}),
	reflectionProbe: Object.freeze({
		id: "reflectionProbe",
		maxTrackedRoughness: 1,
		why: "a cadeia de mips do probe cobre a faixa inteira de rugosidade",
	}),
	planarReflection: Object.freeze({
		id: "planarReflection",
		maxTrackedRoughness: 0.25,
		why: "o alvo planar e um espelho unico, sem cadeia de mips para desfocar",
	}),
})

export const SB_REFLECTION_CONSUMER_IDS = Object.freeze(Object.keys(SB_REFLECTION_CONSUMERS))

function isPlainObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isUsableNumber(value) {
	return typeof value === "number" && Number.isFinite(value)
}

function clampToUnitRange(value, fallback) {
	if (!isUsableNumber(value)) return fallback
	if (SB_MINIMUM_ROUGHNESS > value) return SB_MINIMUM_ROUGHNESS
	if (value > SB_MAXIMUM_ROUGHNESS) return SB_MAXIMUM_ROUGHNESS
	return value
}


export function sanitizeRoughness(roughness) {
	return clampToUnitRange(roughness, SB_UNKNOWN_ROUGHNESS)
}

export function coatLobeId(coatIndex) {
	return SB_COAT_LOBE_ID_PREFIX + coatIndex
}

function readRoughness(operand) {
	if (!isPlainObject(operand)) return SB_UNKNOWN_ROUGHNESS
	const authored = operand.roughness === undefined ? operand.parameters?.roughness : operand.roughness
	return sanitizeRoughness(authored)
}


export function specularReflectanceOf(operand) {
	if (!isPlainObject(operand)) return SB_DEFAULT_SPECULAR_REFLECTANCE
	if (isUsableNumber(operand.specularReflectance)) {
		return clampToUnitRange(operand.specularReflectance, SB_DEFAULT_SPECULAR_REFLECTANCE)
	}
	const authored = operand.f0 === undefined ? operand.parameters?.f0 : operand.f0
	if (Array.isArray(authored)) {
		const channels = authored
			.filter((channel) => isUsableNumber(channel))
			.map((channel) => clampToUnitRange(channel, SB_DEFAULT_SPECULAR_REFLECTANCE))
		if (channels.length > 0) return meanChannel(channels)
	}
	if (isUsableNumber(authored)) return clampToUnitRange(authored, SB_DEFAULT_SPECULAR_REFLECTANCE)
	return SB_DEFAULT_SPECULAR_REFLECTANCE
}


export function normalizeCoat(source) {
	const layer = sanitizeLayer(source)
	return {
		roughness: readRoughness(source),
		specularReflectance: specularReflectanceOf(source),
		coverage: layer.coverage,
		thickness: layer.thickness,
		transmittanceColor: layer.transmittanceColor,
	}
}

export function normalizeBase(source) {
	return {
		roughness: readRoughness(source),
		specularReflectance: specularReflectanceOf(source),
	}
}


export function trackedStackFromLayeringNode(node) {
	const coats = []
	let current = node
	let remainingDepth = SB_MAX_TREE_DEPTH

	while (isVerticalLayeringNode(current) && remainingDepth > 0) {
		const { top, bottom } = layeringOperandsOf(current)
		const layerParameters = layerParametersOf(current)
		coats.push(
			normalizeCoat({
				roughness: readRoughness(top),
				specularReflectance: specularReflectanceOf(top),
				coverage: layerParameters.coverage,
				thickness: layerParameters.thickness,
				transmittanceColor: layerParameters.transmittanceColor,
			}),
		)
		current = bottom
		remainingDepth -= 1
	}

	return {
		coats,
		base: normalizeBase(current),
		depthTruncated: isVerticalLayeringNode(current),
	}
}


export function normalizeTrackedStack(source) {
	if (isVerticalLayeringNode(source)) return trackedStackFromLayeringNode(source)
	if (!isPlainObject(source)) return { coats: [], base: normalizeBase(null), depthTruncated: false }
	if (isVerticalLayeringNode(source.node)) return trackedStackFromLayeringNode(source.node)
	if (isPlainObject(source.stack)) return normalizeTrackedStack(source.stack)

	const authoredCoats = Array.isArray(source.coats)
		? source.coats
		: isPlainObject(source.coat)
			? [source.coat]
			: []
	return {
		coats: authoredCoats.slice(0, SB_MAX_TREE_DEPTH).map((coat) => normalizeCoat(coat)),
		base: normalizeBase(source.base),
		depthTruncated: authoredCoats.length > SB_MAX_TREE_DEPTH || source.depthTruncated === true,
	}
}


export function widenRoughnessThroughCoat(roughness, coat) {
	const normalizedCoat = normalizeCoat(coat)
	const startRoughness = sanitizeRoughness(roughness)
	const widening = normalizedCoat.roughness * normalizedCoat.coverage


	if (widening === 0) return startRoughness
	const widened = Math.sqrt(startRoughness * startRoughness + widening * widening)
	return Math.min(widened, SB_MAXIMUM_ROUGHNESS)
}


export function widenRoughnessThroughCoats(roughness, coats) {
	const coatList = Array.isArray(coats) ? coats : []
	return coatList.reduce((widened, coat) => widenRoughnessThroughCoat(widened, coat), sanitizeRoughness(roughness))
}


function coatInterfaceTransmission(coat) {
	return 1 - coat.specularReflectance * coat.coverage
}


function accumulatedCoatFactors(coats, viewCosine) {
	const factors = []
	let attenuation = 1
	let transmission = 1
	for (const coat of coats) {
		factors.push({ attenuation, transmission })
		attenuation *= meanChannel(bottomAttenuationFor(coat, viewCosine))
		transmission *= coatInterfaceTransmission(coat)
	}
	factors.push({ attenuation, transmission })
	return factors
}


export function reflectionLobesOf(request) {
	const stack = normalizeTrackedStack(request?.stack ?? request)
	const viewCosine = sanitizeViewCosine(request?.viewCosine)
	const factors = accumulatedCoatFactors(stack.coats, viewCosine)

	const lobes = stack.coats.map((coat, coatIndex) => ({
		id: coatLobeId(coatIndex),
		layer: SB_COAT_LAYER_NAME,
		layerIndex: coatIndex,
		ownRoughness: coat.roughness,
		roughness: widenRoughnessThroughCoats(coat.roughness, stack.coats.slice(0, coatIndex)),
		specularReflectance: coat.specularReflectance,
		coverage: coat.coverage,
		selectionWeight:
			coat.specularReflectance * coat.coverage * factors[coatIndex].attenuation * factors[coatIndex].transmission,
	}))

	const baseFactors = factors[stack.coats.length]
	lobes.push({
		id: SB_BASE_LOBE_ID,
		layer: SB_BASE_LAYER_NAME,
		layerIndex: stack.coats.length,
		ownRoughness: stack.base.roughness,
		roughness: widenRoughnessThroughCoats(stack.base.roughness, stack.coats),
		specularReflectance: stack.base.specularReflectance,
		coverage: 1,
		selectionWeight: stack.base.specularReflectance * baseFactors.attenuation * baseFactors.transmission,
	})

	return lobes
}


export function trackedLobeOf(lobes) {
	const lobeList = Array.isArray(lobes) ? lobes : []
	let tracked = null
	for (const lobe of lobeList) {
		if (tracked === null || lobe.selectionWeight > tracked.selectionWeight) tracked = lobe
	}
	return tracked
}


export function selectionMarginOf(lobes, trackedLobe) {
	const others = lobes.filter((lobe) => lobe.id !== trackedLobe.id)
	if (others.length === 0) return { absolute: trackedLobe.selectionWeight, relative: 1, runnerUpLobeId: null }
	const runnerUp = others.reduce((best, lobe) => (lobe.selectionWeight > best.selectionWeight ? lobe : best), others[0])
	const absolute = trackedLobe.selectionWeight - runnerUp.selectionWeight
	return {
		absolute,
		relative: trackedLobe.selectionWeight > 0 ? absolute / trackedLobe.selectionWeight : 0,
		runnerUpLobeId: runnerUp.id,
	}
}

function consumerPlanFor(consumerId, trackedRoughness) {
	const consumer = SB_REFLECTION_CONSUMERS[consumerId]
	return {
		id: consumerId,
		sharedTrackedRoughness: trackedRoughness,
		roughness: Math.min(trackedRoughness, consumer.maxTrackedRoughness),
		maxTrackedRoughness: consumer.maxTrackedRoughness,
		beyondCapability: trackedRoughness > consumer.maxTrackedRoughness,
	}
}

export function sanitizeLightingBridgeState(state) {
	return state === SB_LIGHTING_BRIDGE_STATES.ready
		? SB_LIGHTING_BRIDGE_STATES.ready
		: SB_LIGHTING_BRIDGE_STATES.stub
}


export function lightingBridgeStateFromPasses(passes) {
	const entry = isPlainObject(passes) ? passes[SB_LIGHTING_BRIDGE_PASS_NAME] : null
	if (!isPlainObject(entry)) return SB_LIGHTING_BRIDGE_STATES.stub
	return entry.stub === false ? SB_LIGHTING_BRIDGE_STATES.ready : SB_LIGHTING_BRIDGE_STATES.stub
}


export function trackedStackSignature(request) {
	const stack = normalizeTrackedStack(request?.stack ?? request)
	const viewCosine = sanitizeViewCosine(request?.viewCosine)
	const coatSignatures = stack.coats.map((coat) =>
		[coat.roughness, coat.specularReflectance, coat.coverage, coat.thickness, ...coat.transmittanceColor].join(","),
	)
	return [coatSignatures.join("|"), stack.base.roughness, stack.base.specularReflectance, viewCosine].join(";")
}


export function resolveReflectionRoughness(request) {
	const stack = normalizeTrackedStack(request?.stack ?? request)
	const viewCosine = sanitizeViewCosine(request?.viewCosine)
	const lobes = reflectionLobesOf({ stack, viewCosine })
	const trackedLobe = trackedLobeOf(lobes)
	const selectionMargin = selectionMarginOf(lobes, trackedLobe)
	const consumers = {}
	for (const consumerId of SB_REFLECTION_CONSUMER_IDS) {
		consumers[consumerId] = consumerPlanFor(consumerId, trackedLobe.roughness)
	}

	return {
		owner: SB_ROUGHNESS_TRACKING_OWNER,
		stack,
		viewCosine,
		coatCount: stack.coats.length,
		lobes,
		trackedRoughness: trackedLobe.roughness,
		trackedLobeId: trackedLobe.id,
		trackedLayer: trackedLobe.layer,
		trackedLayerIndex: trackedLobe.layerIndex,
		trackedOwnRoughness: trackedLobe.ownRoughness,
		selectionMargin,
		consumers,
		reflectionResolveCount: SB_REFLECTION_RESOLVE_COUNT,
		addsReflectionPass: false,
		lightingBridgeState: sanitizeLightingBridgeState(request?.lightingBridgeState),
		signature: trackedStackSignature({ stack, viewCosine }),
	}
}


export function reflectionPassDuplicationProblems(passOwners) {
	const owners = isPlainObject(passOwners) ? passOwners : SB_PASS_OWNERS
	const problems = []

	for (const [passName, owner] of Object.entries(owners)) {
		if (owner === SB_ROUGHNESS_TRACKING_OWNER) {
			problems.push(
				"a fase virou dona do passe " + passName + ": roughness tracking le o stack de reflexao, nao acrescenta passe",
			)
		}
	}
	if (!Object.hasOwn(owners, SB_LIGHTING_BRIDGE_PASS_NAME)) {
		problems.push("o grafo nao declara o passe " + SB_LIGHTING_BRIDGE_PASS_NAME + ", de que esta fase depende")
	}

	return problems
}


export function describeRoughnessTracking() {
	return {
		owner: SB_ROUGHNESS_TRACKING_OWNER,
		consumers: SB_REFLECTION_CONSUMER_IDS.map((consumerId) => ({ ...SB_REFLECTION_CONSUMERS[consumerId] })),
		reflectionResolveCount: SB_REFLECTION_RESOLVE_COUNT,
		addsReflectionPass: false,
		dependsOnPass: SB_LIGHTING_BRIDGE_PASS_NAME,
		unknownRoughnessFallback: SB_UNKNOWN_ROUGHNESS,
		defaultSpecularReflectance: SB_DEFAULT_SPECULAR_REFLECTANCE,
		maxTrackedCoats: SB_MAX_TREE_DEPTH,
		declaredResidues: [
			"o alargamento e convolucao quadratica aproximada: o lobo exato da refracao rugosa e da SB-F19",
			"o peso de selecao escolhe o lobo e NAO e particao de energia: o split de Fresnel e da SB-F10 com a SB-F31",
			"o contrato v1 nao reserva uniform para a SB-F32, entao o numero rastreado viaja pela CPU e o call site em GLSL e da SB-F31 com a SB-F33",
			"quantizar a rugosidade rastreada no byte da closure e da SB-F8",
		],
	}
}
