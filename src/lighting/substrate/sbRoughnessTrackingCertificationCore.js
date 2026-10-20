import { SB_GATES, SB_PASS_OWNERS } from "./sbMaterialContract.js"
import {
	SB_BASE_LOBE_ID,
	SB_BASE_LAYER_NAME,
	SB_LIGHTING_BRIDGE_STATES,
	SB_MAXIMUM_ROUGHNESS,
	SB_MINIMUM_ROUGHNESS,
	SB_REFLECTION_CONSUMERS,
	SB_REFLECTION_CONSUMER_IDS,
	SB_REFLECTION_RESOLVE_COUNT,
	SB_ROUGHNESS_TRACKING_OWNER,
	SB_UNKNOWN_ROUGHNESS,
	reflectionPassDuplicationProblems,
	resolveReflectionRoughness,
} from "./sbRoughnessTrackingCore.js"

const IDENTITY_TOLERANCE = 1e-12
const MONOTONIC_TOLERANCE = 1e-12
const VIEW_COSINE_SAMPLES = [1, 0.7, 0.3, 0.05]
const COAT_ROUGHNESS_SAMPLES = [0, 0.1, 0.25, 0.5, 0.75, 1]
const COVERAGE_SAMPLES = [0, 0.25, 0.5, 0.75, 1]
const CLEAR_TRANSMITTANCE_COLOR = [1, 1, 1]


export const SB_ROUGHNESS_TRACKING_STACKS = Object.freeze({
	clearCoatOverMetal: Object.freeze({
		label: "verniz incolor sobre metal (preset carPaint)",
		coats: Object.freeze([
			Object.freeze({
				roughness: 0.06,
				f0: Object.freeze([0.05, 0.05, 0.05]),
				coverage: 1,
				thickness: 0.08,
				transmittanceColor: Object.freeze([0.95, 0.92, 0.9]),
			}),
		]),
		base: Object.freeze({ roughness: 0.28, f0: Object.freeze([0.6, 0.58, 0.56]) }),
	}),

	varnishOverWood: Object.freeze({
		label: "verniz colorido sobre madeira (preset varnishedWood)",
		coats: Object.freeze([
			Object.freeze({
				roughness: 0.14,
				f0: Object.freeze([0.04, 0.04, 0.04]),
				coverage: 0.9,
				thickness: 0.2,
				transmittanceColor: Object.freeze([0.86, 0.72, 0.5]),
			}),
		]),
		base: Object.freeze({ roughness: 0.55, f0: Object.freeze([0.04, 0.04, 0.04]) }),
	}),

	oilOverSkin: Object.freeze({
		label: "oleo sobre pele (preset oiledSkin)",
		coats: Object.freeze([
			Object.freeze({
				roughness: 0.2,
				f0: Object.freeze([0.04, 0.04, 0.04]),
				coverage: 0.65,
				thickness: 0.03,
				transmittanceColor: Object.freeze([1, 0.98, 0.96]),
			}),
		]),
		base: Object.freeze({ roughness: 0.52, f0: Object.freeze([0.04, 0.04, 0.04]) }),
	}),

	bareMetal: Object.freeze({
		label: "metal polido sem camada (preset polishedMetal)",
		coats: Object.freeze([]),
		base: Object.freeze({ roughness: 0.08, f0: Object.freeze([0.95, 0.93, 0.88]) }),
	}),

	oilOverVarnishOverWood: Object.freeze({
		label: "duas camadas: oleo sobre verniz sobre madeira",
		coats: Object.freeze([
			Object.freeze({
				roughness: 0.2,
				f0: Object.freeze([0.04, 0.04, 0.04]),
				coverage: 0.65,
				thickness: 0.03,
				transmittanceColor: Object.freeze([1, 0.98, 0.96]),
			}),
			Object.freeze({
				roughness: 0.14,
				f0: Object.freeze([0.04, 0.04, 0.04]),
				coverage: 0.9,
				thickness: 0.2,
				transmittanceColor: Object.freeze([0.86, 0.72, 0.5]),
			}),
		]),
		base: Object.freeze({ roughness: 0.55, f0: Object.freeze([0.04, 0.04, 0.04]) }),
	}),

	uncoveredVarnish: Object.freeze({
		label: "verniz autorado com cobertura zero: o portao da identidade",
		coats: Object.freeze([
			Object.freeze({
				roughness: 0.14,
				f0: Object.freeze([0.04, 0.04, 0.04]),
				coverage: 0,
				thickness: 0.2,
				transmittanceColor: Object.freeze([0.86, 0.72, 0.5]),
			}),
		]),
		base: Object.freeze({ roughness: 0.55, f0: Object.freeze([0.04, 0.04, 0.04]) }),
	}),
})

export function roughnessTrackingStackIds() {
	return Object.keys(SB_ROUGHNESS_TRACKING_STACKS)
}

function isUsableRoughness(value) {
	if (typeof value !== "number" || !Number.isFinite(value)) return false
	if (SB_MINIMUM_ROUGHNESS > value) return false
	if (value > SB_MAXIMUM_ROUGHNESS) return false
	return true
}

function lobeById(plan, lobeId) {
	return plan.lobes.find((lobe) => lobe.id === lobeId) ?? null
}

function consumerProblems(stackLabel, plan) {
	const problems = []
	for (const consumerId of SB_REFLECTION_CONSUMER_IDS) {
		const consumerPlan = plan.consumers[consumerId]
		const maxTrackedRoughness = SB_REFLECTION_CONSUMERS[consumerId].maxTrackedRoughness
		if (consumerPlan.sharedTrackedRoughness !== plan.trackedRoughness) {
			problems.push(stackLabel + ": " + consumerId + " recebeu numero diferente do rastreado")
		}
		if (consumerPlan.roughness > plan.trackedRoughness + IDENTITY_TOLERANCE) {
			problems.push(stackLabel + ": " + consumerId + " inflou a rugosidade em vez de prender no teto")
		}
		if (consumerPlan.roughness > maxTrackedRoughness + IDENTITY_TOLERANCE) {
			problems.push(stackLabel + ": " + consumerId + " passou do teto da tecnica")
		}
		const shouldHandOver = plan.trackedRoughness > maxTrackedRoughness
		if (consumerPlan.beyondCapability !== shouldHandOver) {
			problems.push(stackLabel + ": " + consumerId + " mentiu sobre a propria capacidade")
		}
	}
	return problems
}

function wrongLayerProblems(stackLabel, plan, distinguishableRoughness) {
	const problems = []
	const trackedLobe = lobeById(plan, plan.trackedLobeId)
	for (const lobe of plan.lobes) {
		if (lobe.id === trackedLobe.id) continue
		const layersAreDistinguishable =
			Math.abs(lobe.ownRoughness - trackedLobe.ownRoughness) > distinguishableRoughness
		const trackedMatchesOtherLayer =
			distinguishableRoughness >= Math.abs(plan.trackedRoughness - lobe.ownRoughness)
		if (layersAreDistinguishable && trackedMatchesOtherLayer) {
			problems.push(
				stackLabel + ": o stack de reflexao recebeu a rugosidade crua da camada " + lobe.id + ", que nao e a rastreada",
			)
		}
	}
	return problems
}


const NORMAL_INCIDENCE_VIEW_COSINE = VIEW_COSINE_SAMPLES[0]


const JUNK_REQUESTS = Object.freeze([null, undefined, "verniz", 7, { stack: "verniz" }, { coats: "duas", base: null }])


function wideningDirectionProblems(stackLabel, plan) {
	const problems = []
	for (const lobe of plan.lobes) {
		if (!isUsableRoughness(lobe.roughness)) {
			problems.push(stackLabel + ": o lobo " + lobe.id + " saiu com rugosidade inutilizavel: " + lobe.roughness)
			continue
		}
		if (lobe.ownRoughness > lobe.roughness + IDENTITY_TOLERANCE) {
			problems.push(stackLabel + ": o lobo " + lobe.id + " ficou mais liso do que ele mesmo")
		}
	}
	return problems
}


function sharedResolveProblems(stackLabel, plan) {
	const problems = []
	if (plan.owner !== SB_ROUGHNESS_TRACKING_OWNER) {
		problems.push(stackLabel + ": o plano saiu com o dono " + plan.owner)
	}
	if (plan.reflectionResolveCount !== SB_REFLECTION_RESOLVE_COUNT) {
		problems.push(stackLabel + ": o pixel pediu " + plan.reflectionResolveCount + " resolucoes de reflexao")
	}
	if (plan.addsReflectionPass !== false) {
		problems.push(stackLabel + ": o plano declarou passe de reflexao novo")
	}
	return problems
}





function coatIdentityProblems() {
	const problems = []
	const uncoveredStack = SB_ROUGHNESS_TRACKING_STACKS.uncoveredVarnish
	const coveredStack = SB_ROUGHNESS_TRACKING_STACKS.varnishOverWood
	const uncoveredPlan = resolveReflectionRoughness(uncoveredStack)
	const coveredPlan = resolveReflectionRoughness(coveredStack)
	const bareBaseRoughness = uncoveredStack.base.roughness

	if (uncoveredPlan.trackedLobeId !== SB_BASE_LOBE_ID || uncoveredPlan.trackedLayer !== SB_BASE_LAYER_NAME) {
		problems.push("cobertura zero rastreou " + uncoveredPlan.trackedLobeId + " em vez da base")
	}
	if (uncoveredPlan.trackedRoughness !== bareBaseRoughness) {
		problems.push(
			"cobertura zero mexeu na base: " + uncoveredPlan.trackedRoughness + " no lugar de " + bareBaseRoughness,
		)
	}
	if (uncoveredPlan.trackedRoughness === coveredPlan.trackedRoughness) {
		problems.push("a mesma pilha com e sem cobertura devolveu o mesmo numero: o portao da identidade esta vazio")
	}
	return problems
}


function probeBaseLobe(probe) {
	const plan = resolveReflectionRoughness({
		stack: {
			coats: [
				{
					roughness: probe.coatRoughness,
					coverage: probe.coverage,
					thickness: 0,
					transmittanceColor: CLEAR_TRANSMITTANCE_COLOR,
				},
			],
			base: { roughness: probe.baseRoughness },
		},
		viewCosine: probe.viewCosine,
	})
	return lobeById(plan, SB_BASE_LOBE_ID)
}


function wideningMonotonicityProblems() {
	const problems = []
	const baseRoughness = SB_ROUGHNESS_TRACKING_STACKS.varnishOverWood.base.roughness

	for (const coverage of COVERAGE_SAMPLES) {
		let previousRoughness = null
		for (const coatRoughness of COAT_ROUGHNESS_SAMPLES) {
			const probeLabel = "cobertura " + coverage + " com camada de rugosidade " + coatRoughness
			const baseLobe = probeBaseLobe({ coatRoughness, coverage, baseRoughness })
			if (!isUsableRoughness(baseLobe.roughness)) {
				problems.push("alargamento inutilizavel em " + probeLabel + ": " + baseLobe.roughness)
				continue
			}
			if (baseRoughness > baseLobe.roughness + MONOTONIC_TOLERANCE) {
				problems.push("a camada alisou a base em " + probeLabel)
			}
			if (previousRoughness !== null && previousRoughness > baseLobe.roughness + MONOTONIC_TOLERANCE) {
				problems.push("camada mais rugosa alargou menos em " + probeLabel)
			}
			previousRoughness = baseLobe.roughness
		}
	}

	for (const coatRoughness of COAT_ROUGHNESS_SAMPLES) {
		let previousRoughness = null
		for (const coverage of COVERAGE_SAMPLES) {
			const probeLabel = "camada de rugosidade " + coatRoughness + " com cobertura " + coverage
			const baseLobe = probeBaseLobe({ coatRoughness, coverage, baseRoughness })
			if (previousRoughness !== null && previousRoughness > baseLobe.roughness + MONOTONIC_TOLERANCE) {
				problems.push("mais cobertura alargou menos em " + probeLabel)
			}
			previousRoughness = baseLobe.roughness
		}
	}

	const frontalProbe = { coatRoughness: 0.5, coverage: 1, baseRoughness, viewCosine: NORMAL_INCIDENCE_VIEW_COSINE }
	const frontalRoughness = probeBaseLobe(frontalProbe).roughness
	for (const viewCosine of VIEW_COSINE_SAMPLES) {
		const probedRoughness = probeBaseLobe({ ...frontalProbe, viewCosine }).roughness
		if (probedRoughness !== frontalRoughness) {
			problems.push("o alargamento mudou com a visada no cosseno " + viewCosine + ": " + probedRoughness)
		}
	}

	return problems
}


function lightingBridgeIndependenceProblems(stackLabel, stack) {
	const problems = []
	const withStub = resolveReflectionRoughness({ stack, lightingBridgeState: SB_LIGHTING_BRIDGE_STATES.stub })
	const withBridge = resolveReflectionRoughness({ stack, lightingBridgeState: SB_LIGHTING_BRIDGE_STATES.ready })

	if (withStub.trackedRoughness !== withBridge.trackedRoughness) {
		problems.push(stackLabel + ": o numero rastreado dependeu do estado da ponte de iluminacao")
	}
	if (withStub.trackedLobeId !== withBridge.trackedLobeId) {
		problems.push(stackLabel + ": o lobo rastreado dependeu do estado da ponte de iluminacao")
	}
	if (withStub.signature !== withBridge.signature) {
		problems.push(stackLabel + ": a assinatura da pilha dependeu do estado da ponte de iluminacao")
	}
	if (withStub.lightingBridgeState === withBridge.lightingBridgeState) {
		problems.push(stackLabel + ": o estado da ponte nao foi lido, os dois lados sairam iguais")
	}
	return problems
}


function junkInputProblems() {
	const problems = []
	for (const junkRequest of JUNK_REQUESTS) {
		const requestLabel = "entrada podre " + JSON.stringify(junkRequest ?? null)
		const plan = resolveReflectionRoughness(junkRequest)
		if (!isUsableRoughness(plan.trackedRoughness)) {
			problems.push(requestLabel + " devolveu rugosidade inutilizavel: " + plan.trackedRoughness)
			continue
		}
		if (plan.trackedLobeId !== SB_BASE_LOBE_ID || plan.trackedLayer !== SB_BASE_LAYER_NAME) {
			problems.push(requestLabel + " nao caiu na identidade da base: rastreou " + plan.trackedLobeId)
		}
		if (plan.trackedRoughness !== SB_UNKNOWN_ROUGHNESS) {
			problems.push(requestLabel + " inventou rugosidade em vez do fallback: " + plan.trackedRoughness)
		}
		problems.push(...consumerProblems(requestLabel, plan), ...sharedResolveProblems(requestLabel, plan))
	}
	return problems
}


export function distinguishableRoughnessFloor(gates) {
	return (gates ?? SB_GATES).maxQuantizationErrorPerChannel
}


export const SB_PLAN_GATE_STACK_ID = "clearCoatOverMetal"


export function measureRoughnessTrackingStack(stackId, viewCosine) {
	const stack = SB_ROUGHNESS_TRACKING_STACKS[stackId]
	if (!stack) return null

	const plan = resolveReflectionRoughness({ stack, viewCosine })
	const distinguishableRoughness = distinguishableRoughnessFloor()
	const widening = plan.trackedRoughness - plan.trackedOwnRoughness

	return {
		stackId,
		label: stack.label,
		viewCosine: plan.viewCosine,
		coatCount: plan.coatCount,
		trackedLobeId: plan.trackedLobeId,
		trackedLayer: plan.trackedLayer,
		trackedLayerIndex: plan.trackedLayerIndex,
		trackedRoughness: plan.trackedRoughness,
		trackedOwnRoughness: plan.trackedOwnRoughness,
		widening,
		wideningIsVisibleAfterQuantization: widening > distinguishableRoughness,
		selectionMargin: plan.selectionMargin,
		distinguishableRoughness,
		reflectionResolveCount: plan.reflectionResolveCount,
		addsReflectionPass: plan.addsReflectionPass,
		consumers: SB_REFLECTION_CONSUMER_IDS.map((consumerId) => ({
			id: consumerId,
			roughness: plan.consumers[consumerId].roughness,
			maxTrackedRoughness: SB_REFLECTION_CONSUMERS[consumerId].maxTrackedRoughness,
			beyondCapability: plan.consumers[consumerId].beyondCapability,
		})),
		problems: [
			...consumerProblems(stack.label, plan),
			...wrongLayerProblems(stack.label, plan, distinguishableRoughness),
			...wideningDirectionProblems(stack.label, plan),
			...sharedResolveProblems(stack.label, plan),
		],
	}
}


export function certifyRoughnessTracking() {
	const stackIds = roughnessTrackingStackIds()
	const measurements = stackIds.map((stackId) => measureRoughnessTrackingStack(stackId))
	const problems = [
		...stackIds.flatMap((stackId) =>
			VIEW_COSINE_SAMPLES.flatMap((viewCosine) => measureRoughnessTrackingStack(stackId, viewCosine).problems),
		),
		...stackIds.flatMap((stackId) => {
			const stack = SB_ROUGHNESS_TRACKING_STACKS[stackId]
			return lightingBridgeIndependenceProblems(stack.label, stack)
		}),
		...coatIdentityProblems(),
		...wideningMonotonicityProblems(),
		...junkInputProblems(),
		...reflectionPassDuplicationProblems(SB_PASS_OWNERS),
	]

	return {
		owner: SB_ROUGHNESS_TRACKING_OWNER,
		ok: problems.length === 0,
		problems,
		stackCount: measurements.length,
		viewCosineSamples: [...VIEW_COSINE_SAMPLES],
		distinguishableRoughness: distinguishableRoughnessFloor(),
		reflectionResolveCount: SB_REFLECTION_RESOLVE_COUNT,
		addsReflectionPass: false,
		planGate: measurements.find((measurement) => measurement.stackId === SB_PLAN_GATE_STACK_ID) ?? null,
		measurements,
	}
}
