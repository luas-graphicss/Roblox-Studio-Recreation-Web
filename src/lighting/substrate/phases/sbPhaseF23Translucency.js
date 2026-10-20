import { SB_GATES, SB_PASS_OWNERS, patchOrderFor } from "../sbMaterialContract.js"
import { SB_SORTED_PIXELS_MODE, resolveSortedPixels } from "../sbOitSortedPixelsCore.js"
import { resolveWeightedBlended } from "../sbOitWeightedBlendedCore.js"
import {
	describeTranslucencyModes,
	resolveTranslucency,
	translucencyModeForTier,
	translucencyModeProblems,
} from "../sbTranslucencyModeCore.js"
import { compareTranslucencyModesOnBattery, runOrderingBattery } from "../sbOitOrderingBattery.js"
import {
	SB_OIT_ACCUMULATION_ANCHOR_ID,
	SB_OIT_ACCUMULATION_GLSL,
	SB_OIT_TRANSLUCENCY_UNIFORM_NAME,
	oitGlslProblems,
} from "../sbOitResolveGlsl.js"

export const PHASE_ID = "SB-F23"
export const TRANSLUCENCY_FLAG_ID = "SubstrateOrderedTranslucency"
export const TRANSLUCENCY_PASS_NAME = "translucencyResolve"
export const TRANSLUCENCY_PATCH_ID = "sbOitAccumulate"


const TEXTURE_CONSUMER_ID = "translucency"
const TEXTURE_UNIT_COUNT = 1


const CLOSURE_BYTES = 0

const REQUIRED_ANGLE_COUNT = 6
const REQUIRED_PANE_COUNT = 4
const MINIMUM_DISTINCT_ORDERS = 2
const OPAQUE_PROBE_BACKGROUND = [0.21, 0.37, 0.64]
const OPAQUE_PROBE_COLOR = [0.8, 0.12, 0.1]


const IDLE_STATE_BY_MODE = new Map()

function idleStateForMode(mode) {
	let idleState = IDLE_STATE_BY_MODE.get(mode)
	if (!idleState) {
		idleState = Object.freeze({ mode, fragmentCount: 0, resolved: false })
		IDLE_STATE_BY_MODE.set(mode, idleState)
	}
	return idleState
}


export function executeTranslucencyResolve(passContext) {
	if (!passContext) return passContext
	const mode = translucencyModeForTier(passContext.tier).mode
	const fragments = passContext.translucentFragments

	if (!Array.isArray(fragments) || fragments.length === 0) {
		passContext.translucency = idleStateForMode(mode)
		return passContext
	}

	const resolved = resolveTranslucency({
		fragments,
		backgroundColor: passContext.backgroundColor,
		tierName: passContext.tier,
		mode,
	})

	passContext.translucency = {
		mode: resolved.mode,
		fragmentCount: resolved.fragmentCount,
		resolved: true,
		color: resolved.color,
		order: resolved.order ?? null,
		overflowCount: resolved.overflowCount ?? 0,
	}
	return passContext
}


export function measureOpaquePassthrough() {
	const emptySorted = resolveSortedPixels({ fragments: [], backgroundColor: OPAQUE_PROBE_BACKGROUND })
	const emptyWeighted = resolveWeightedBlended({ fragments: [], backgroundColor: OPAQUE_PROBE_BACKGROUND })
	const opaqueFragment = {
		id: "opaqueProbe",
		depth: 3,
		color: OPAQUE_PROBE_COLOR,
		coverage: 1,
		transmittanceColor: [0, 0, 0],
	}
	const covered = resolveSortedPixels({ fragments: [opaqueFragment], backgroundColor: OPAQUE_PROBE_BACKGROUND })

	const matchesBackground = (color) =>
		color.every((channel, channelIndex) => Object.is(channel, OPAQUE_PROBE_BACKGROUND[channelIndex]))

	return {
		sortedBackgroundUntouched: matchesBackground(emptySorted.color),
		weightedBackgroundUntouched: matchesBackground(emptyWeighted.color),
		opaqueFragmentHidesBackground: covered.color.every((channel, channelIndex) =>
			Object.is(channel, OPAQUE_PROBE_COLOR[channelIndex]),
		),
	}
}


export function evaluateTranslucencyGate(options) {
	const gates = options?.gates ?? SB_GATES
	const ordering = runOrderingBattery(options)
	const fallback = compareTranslucencyModesOnBattery(options)
	const opaque = measureOpaquePassthrough()
	const tierModes = describeTranslucencyModes()
	const problems = []

	if (REQUIRED_ANGLE_COUNT > ordering.angleCount) problems.push("a bateria tem menos de " + REQUIRED_ANGLE_COUNT + " angulos")
	if (REQUIRED_PANE_COUNT > ordering.paneCount) problems.push("a bateria tem menos de " + REQUIRED_PANE_COUNT + " vidros")
	if (!ordering.everyAngleHitsAllPanes) problems.push("algum angulo nao atravessa os " + REQUIRED_PANE_COUNT + " vidros")
	if (!ordering.allOrdersCorrect) {
		problems.push("ordem errada em " + (ordering.angleCount - ordering.correctAngleCount) + " angulo(s)")
	}
	if (!ordering.allShufflesStable) problems.push("a cor mudou com a ordem de entrada dos fragmentos")
	if (MINIMUM_DISTINCT_ORDERS > ordering.distinctOrderCount) {
		problems.push("a ordem nao muda com o angulo: a bateria nao prova nada")
	}
	if (!opaque.sortedBackgroundUntouched) problems.push("pixel opaco nao voltou byte a byte no modo ordenado")
	if (!opaque.weightedBackgroundUntouched) problems.push("pixel opaco nao voltou byte a byte no fallback")
	if (!opaque.opaqueFragmentHidesBackground) problems.push("fragmento opaco nao apagou o fundo exatamente")
	if (!Number.isFinite(fallback.worstModeDifference)) problems.push("o erro do fallback nao foi medido")

	for (const problem of translucencyModeProblems()) problems.push(problem)
	for (const problem of oitGlslProblems()) problems.push(problem)

	if (patchOrderFor(PHASE_ID, 0) === null) problems.push("o contrato nao da ordem de patch para " + PHASE_ID)
	if (SB_PASS_OWNERS[TRANSLUCENCY_PASS_NAME] !== PHASE_ID) problems.push("o passe " + TRANSLUCENCY_PASS_NAME + " nao e desta fase")

	return {
		ok: problems.length === 0,
		problems,
		ordering,
		fallback,
		opaque,
		tierModes,
		maxTransmittanceAbsoluteError: gates?.maxTransmittanceAbsoluteError ?? null,
	}
}

function installFlag(installContext) {
	installContext?.flags?.registerFlag({
		id: TRANSLUCENCY_FLAG_ID,
		owner: PHASE_ID,
		description: "Translucidez ordenada por pixel (OIT) com transmitancia colorida",
		defaultsByTier: { fraco: false, medio: true, forte: true },
	})
}

function installAccumulationPatch(installContext, patchOrder) {
	const patch = installContext?.patch
	if (!patch?.registerPatch) return { accepted: false, reason: "harness de patch indisponivel" }
	if (patchOrder === null) return { accepted: false, reason: "ordem de patch fora da faixa do contrato" }

	const three = installContext?.bench?.THREE ?? null
	if (three && patch.checkAnchor) {
		const anchorReport = patch.checkAnchor(three, SB_OIT_ACCUMULATION_ANCHOR_ID)
		if (anchorReport && anchorReport.present === false) {
			return { accepted: false, reason: "ancora ausente: " + SB_OIT_ACCUMULATION_ANCHOR_ID }
		}
	}

	return patch.registerPatch({
		id: TRANSLUCENCY_PATCH_ID,
		owner: PHASE_ID,
		anchor: SB_OIT_ACCUMULATION_ANCHOR_ID,
		order: patchOrder,
		flagId: TRANSLUCENCY_FLAG_ID,
		declarations: SB_OIT_ACCUMULATION_GLSL.declarations,
		code: SB_OIT_ACCUMULATION_GLSL.code,
	})
}

function installResolvePass(installContext) {
	const registerPass = installContext?.passes?.registerPass
	if (typeof registerPass !== "function") return { accepted: false, reason: "grafo de passes indisponivel" }
	return registerPass(TRANSLUCENCY_PASS_NAME, { owner: PHASE_ID, execute: executeTranslucencyResolve })
}

function describeInstallation(gate, patchReport, passReport) {
	const weakTierMode = translucencyModeForTier("fraco").mode
	const fallbackError = gate.fallback.worstModeDifference.toFixed(4)
	const parts = [
		PHASE_ID + ": " + gate.ordering.paneCount + " vidros interpenetrados em " + gate.ordering.angleCount + " angulos",
		"ordem correta em " + gate.ordering.correctAngleCount + "/" + gate.ordering.angleCount,
		gate.ordering.distinctOrderCount + " ordens distintas",
		"opaco byte a byte " + (gate.opaque.sortedBackgroundUntouched && gate.opaque.opaqueFragmentHidesBackground ? "ok" : "FALHOU"),
		"fallback do tier fraco = " + weakTierMode + " (erro maximo medido " + fallbackError + ")",
		"patch " + (patchReport?.accepted ? "aceito na ordem " + patchOrderFor(PHASE_ID, 0) : "recusado: " + (patchReport?.reason ?? "sem motivo")),
		"passe " + (passReport?.accepted ? "assumido" : "recusado: " + (passReport?.reason ?? "sem motivo")),
		TEXTURE_UNIT_COUNT + " unidade de textura, " + CLOSURE_BYTES + " byte de closure",
	]
	if (!gate.ok) parts.push("portao aberto com pendencia: " + gate.problems.join("; "))
	return parts.join(" | ")
}

export function installPhase(installContext) {
	try {
		installFlag(installContext)
		installContext?.patch?.registerUniform(SB_OIT_TRANSLUCENCY_UNIFORM_NAME, { owner: PHASE_ID, value: null })

		const patchReport = installAccumulationPatch(installContext, patchOrderFor(PHASE_ID, 0))
		const passReport = installResolvePass(installContext)

		installContext?.telemetry?.textureUnit(TEXTURE_CONSUMER_ID, TEXTURE_UNIT_COUNT)
		installContext?.telemetry?.closureBytes(PHASE_ID, CLOSURE_BYTES)

		const gate = evaluateTranslucencyGate({ gates: installContext?.contract?.SB_GATES ?? SB_GATES })
		if (!gate.ok) {
			installContext?.telemetry?.error(PHASE_ID, "portao com pendencia: " + gate.problems.join("; "))
		}

		return { summary: describeInstallation(gate, patchReport, passReport), gate, mode: SB_SORTED_PIXELS_MODE }
	} catch (installError) {
		return { summary: PHASE_ID + " nao instalou: " + (installError?.message ?? String(installError)) }
	}
}
