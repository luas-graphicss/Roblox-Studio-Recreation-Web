import { getSubstrateHostSurface } from "../runtime/substrateHostSurface.js";


import { SB_TIER_NAMES, patchOrderFor, tierDefaults } from "../sbMaterialContract.js"
import {
	SB_REFLECTION_CONSUMER_IDS,
	describeRoughnessTracking,
	lightingBridgeStateFromPasses,
	resolveReflectionRoughness,
	trackedStackSignature,
} from "../sbRoughnessTrackingCore.js"
import {
	SB_PLAN_GATE_STACK_ID,
	certifyRoughnessTracking,
	measureRoughnessTrackingStack,
	roughnessTrackingStackIds,
} from "../sbRoughnessTrackingCertificationCore.js"

export const PHASE_ID = "SB-F32"
export const FLAG_ID = "SubstrateRoughnessTracking"
export const FRAME_STAGE_NAME = "beforeMaterials"
export const FRAME_STAGE_ID = "sbRoughnessTrackingResolve"
export const RESERVED_PATCH_SUB_SLOT = 0
export const GLSL_PATCH_COUNT = 0
export const TEXTURE_UNITS_CONSUMED_BY_PHASE = 0
export const CLOSURE_BYTES_ADDED_BY_PHASE = 0

const CONSOLE_SURFACE_NAME = "roughnessTracking"
const FALLBACK_TIER_NAME = "forte"


function flagDefaultsByTier() {
	const defaults = {}
	for (const tierName of SB_TIER_NAMES) {
		defaults[tierName] = Boolean(tierDefaults(tierName)?.substrateEnabled)
	}
	return defaults
}

function benchTierName(installContext) {
	const readTier = installContext?.bench?.tier
	const tierName = typeof readTier === "function" ? readTier() : null
	return typeof tierName === "string" ? tierName : FALLBACK_TIER_NAME
}

function trackingIsActive(installContext) {
	const isFlagActive = installContext?.flags?.isFlagActive
	if (typeof isFlagActive !== "function") return false
	return isFlagActive(FLAG_ID, benchTierName(installContext)) === true
}


function trackedStackFromFrameContext(frameContext) {
	return frameContext?.substrateStack ?? frameContext?.materialStack ?? null
}









function trackedStackOf(frameContext, registeredStack) {
	return trackedStackFromFrameContext(frameContext) ?? registeredStack ?? null
}


export function createRoughnessTrackingResolver(installContext) {
	const state = { signature: null, plan: null, resolveCount: 0, skippedFrameCount: 0, registeredStack: null }

	function run(frameContext) {
		const stack = trackedStackOf(frameContext, state.registeredStack)
		if (stack === null || !trackingIsActive(installContext)) {
			state.skippedFrameCount += 1
			return state.plan
		}
		const viewCosine = frameContext?.viewCosine
		const signature = trackedStackSignature({ stack, viewCosine })
		if (signature === state.signature) return state.plan
		state.signature = signature
		state.plan = resolveReflectionRoughness({
			stack,
			viewCosine,
			lightingBridgeState: lightingBridgeStateFromPasses(frameContext?.passes),
		})
		state.resolveCount += 1
		return state.plan
	}


	function trackStack(stack) {
		state.registeredStack = stack ?? null
		return state.registeredStack
	}


	function clearTrackedStack() {
		state.registeredStack = null
	}

	return { state, run, lastPlan: () => state.plan, trackStack, clearTrackedStack }
}


export function createRoughnessTrackingConsoleSurface(installContext, resolver) {
	return {
		owner: PHASE_ID,
		flagId: FLAG_ID,
		reservedPatchOrder: patchOrderFor(PHASE_ID, RESERVED_PATCH_SUB_SLOT),
		glslPatchCount: GLSL_PATCH_COUNT,
		consumers: () => [...SB_REFLECTION_CONSUMER_IDS],
		stacks: () => roughnessTrackingStackIds(),
		measure: (stackId, viewCosine) => measureRoughnessTrackingStack(stackId, viewCosine),
		planGate: () => measureRoughnessTrackingStack(SB_PLAN_GATE_STACK_ID),
		certify: () => certifyRoughnessTracking(),
		describe: (request) => describeRoughnessTracking(request),
		resolveNow: (frameContext) => resolver.run(frameContext),
		trackStack: (stack) => resolver.trackStack(stack),
		clearTrackedStack: () => resolver.clearTrackedStack(),
		trackedStack: () => resolver.state.registeredStack,
		lastPlan: () => resolver.lastPlan(),
		frameState: () => ({ ...resolver.state }),
		isActive: () => trackingIsActive(installContext),
	}
}


function publishConsoleSurface(consoleSurface) {
	const lab = getSubstrateHostSurface()
	if (!lab || typeof lab !== "object") return false
	lab[CONSOLE_SURFACE_NAME] = consoleSurface
	return true
}

function registerTrackingFlag(installContext, refusals) {
	const registerFlag = installContext?.flags?.registerFlag
	if (typeof registerFlag !== "function") {
		refusals.push("bancada sem flags.registerFlag: a fase ficou sem chave de ignicao")
		return null
	}
	return registerFlag({
		id: FLAG_ID,
		owner: PHASE_ID,
		description: "Rastreia a rugosidade da camada certa para SSR, probes e planar.",
		defaultsByTier: flagDefaultsByTier(),
	})
}

function registerTrackingFrameStage(installContext, resolver, refusals) {
	const registerFrameStage = installContext?.frameStages?.registerFrameStage
	if (typeof registerFrameStage !== "function") {
		refusals.push("bancada sem frameStages.registerFrameStage: o rastreamento nao roda por quadro")
		return null
	}
	const registration = registerFrameStage(FRAME_STAGE_NAME, {
		id: FRAME_STAGE_ID,
		owner: PHASE_ID,
		run: (frameContext) => resolver.run(frameContext),
	})
	if (registration?.accepted !== true) {
		refusals.push("estagio de frame recusado: " + (registration?.reason ?? "motivo nao informado"))
	}
	return registration
}


function declareBudget(installContext) {
	installContext?.telemetry?.closureBytes?.(PHASE_ID, CLOSURE_BYTES_ADDED_BY_PHASE)
	installContext?.telemetry?.textureUnit?.(PHASE_ID, TEXTURE_UNITS_CONSUMED_BY_PHASE)
}


function summarizeInstall(certification, reservedPatchOrder, refusals) {
	const planGate = certification.planGate
	const head =
		PHASE_ID +
		": " +
		(planGate?.label ?? SB_PLAN_GATE_STACK_ID) +
		" rastreia a camada " +
		(planGate?.trackedLayer ?? "sem camada") +
		" em " +
		(planGate ? planGate.trackedRoughness.toFixed(5) : "sem medida") +
		" (crua " +
		(planGate ? planGate.trackedOwnRoughness.toFixed(5) : "sem medida") +
		"), " +
		certification.reflectionResolveCount +
		" resolucao por pixel para " +
		SB_REFLECTION_CONSUMER_IDS.length +
		" consumidores, ordem " +
		reservedPatchOrder +
		" reservada e " +
		GLSL_PATCH_COUNT +
		" patch de GLSL"
	if (refusals.length === 0) return head
	return head + " -- com " + refusals.length + " recusa(s), a primeira: " + refusals[0]
}


export function installPhase(installContext = {}) {
	const refusals = []
	try {
		const reservedPatchOrder = patchOrderFor(PHASE_ID, RESERVED_PATCH_SUB_SLOT)
		if (typeof reservedPatchOrder !== "number") {
			refusals.push("contrato sem ordem de patch reservada para " + PHASE_ID)
		}

		const flag = registerTrackingFlag(installContext, refusals)
		const resolver = createRoughnessTrackingResolver(installContext)
		const frameStage = registerTrackingFrameStage(installContext, resolver, refusals)
		declareBudget(installContext)

		const certification = certifyRoughnessTracking()
		for (const problem of certification.problems) {
			refusals.push("portao da certificacao: " + problem)
		}

		const consoleSurface = createRoughnessTrackingConsoleSurface(installContext, resolver)
		const consolePublished = publishConsoleSurface(consoleSurface)

		for (const refusal of refusals) {
			installContext?.telemetry?.error?.(PHASE_ID, refusal)
		}

		return {
			phaseId: PHASE_ID,
			installed: refusals.length === 0,
			flagId: flag?.id ?? FLAG_ID,
			frameStageName: frameStage?.stageName ?? null,
			frameStageId: frameStage?.id ?? null,
			reservedPatchOrder,
			glslPatchCount: GLSL_PATCH_COUNT,
			textureUnitsConsumed: TEXTURE_UNITS_CONSUMED_BY_PHASE,
			closureBytesAdded: CLOSURE_BYTES_ADDED_BY_PHASE,
			reflectionResolveCount: certification.reflectionResolveCount,
			addsReflectionPass: certification.addsReflectionPass,
			consolePublished,
			consoleSurface,
			resolver,
			certification,
			refusals,
			summary: summarizeInstall(certification, reservedPatchOrder, refusals),
		}
	} catch (installError) {
		const message = "instalacao falhou: " + (installError?.message ?? String(installError))
		installContext?.telemetry?.error?.(PHASE_ID, message)
		return {
			phaseId: PHASE_ID,
			installed: false,
			refusals: [...refusals, message],
			summary: PHASE_ID + " nao instalou: " + message,
		}
	}
}
