import { getSubstrateHostSurface } from "../runtime/substrateHostSurface.js";


import { SB_TIER_NAMES, tierDefaults } from "../sbMaterialContract.js"
import {
	SB_FUTURE_INTEGRATION_FLAG_ID,
	SB_FUTURE_INTEGRATION_PHASE_ID,
	SB_GATE_DOOR_IDS,
	SB_RENDER_BRANCH_IDS,
	SB_RENDER_TECHNOLOGY_IDS,
	createBranchPatchPlan,
	describeFutureIntegration,
	evaluateBranchPixelParity,
	futureIntegrationGateSignature,
	resolveFutureIntegrationGate,
	technologyFromRendererCapabilities,
} from "../sbFutureIntegrationCore.js"
import {
	SB_FUTURE_INTEGRATION_DECLARATIONS_BY_BRANCH,
	futureIntegrationGlslProblems,
} from "../sbFutureIntegrationGlsl.js"
import { createPatchRegistryBridge } from "../sbPatchRegistryBridge.js"
import { certifyFutureIntegration } from "../sbFutureIntegrationCertificationCore.js"

export const PHASE_ID = SB_FUTURE_INTEGRATION_PHASE_ID
export const FLAG_ID = SB_FUTURE_INTEGRATION_FLAG_ID
export const FRAME_STAGE_NAME = "beforeMaterials"
export const FRAME_STAGE_ID = "sbFutureIntegrationGate"
export const GLSL_PATCH_COUNT = SB_RENDER_BRANCH_IDS.length
export const TEXTURE_UNITS_CONSUMED_BY_PHASE = 0
export const CLOSURE_BYTES_ADDED_BY_PHASE = 0

const CONSOLE_SURFACE_NAME = "futureIntegration"
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
	const tierName = typeof readTier === "function" ? readTier() : readTier
	return typeof tierName === "string" ? tierName : FALLBACK_TIER_NAME
}

function rendererFrom(candidate) {
	if (!candidate) return null
	if (typeof candidate !== "function") return candidate
	try {
		return candidate()
	} catch {
		return null
	}
}


function rendererCapabilities(installContext, frameContext) {
	const renderer = rendererFrom(frameContext?.renderer) ?? rendererFrom(installContext?.bench?.renderer)
	return renderer?.capabilities ?? null
}





function flagOverrideOf(installContext) {
	const flagState = installContext?.flags?.flagState
	if (typeof flagState !== "function") return null
	const state = flagState(FLAG_ID, benchTierName(installContext))
	if (state?.override === true) return true
	if (state?.override === false) return false
	return null
}


export function createFutureIntegrationGateResolver(installContext, bridge) {
	const state = { signature: null, gate: null, resolveCount: 0, frameCount: 0 }

	function gateRequestFor(frameContext) {
		return {
			tier: typeof frameContext?.tier === "string" ? frameContext.tier : benchTierName(installContext),
			technology: technologyFromRendererCapabilities(rendererCapabilities(installContext, frameContext)),
			safeMode: bridge.isSafeMode(),
			flagOverride: flagOverrideOf(installContext),
			coveredBranchIds: bridge.coveredBranchIds(),
		}
	}

	function resolve(request) {
		const signature = futureIntegrationGateSignature(request)
		if (signature === state.signature) return state.gate
		state.signature = signature
		state.gate = resolveFutureIntegrationGate(request)
		state.resolveCount += 1
		return state.gate
	}

	function run(frameContext) {
		state.frameCount += 1
		return resolve(gateRequestFor(frameContext))
	}


	function resolveNow(request = {}) {
		return resolve({ ...gateRequestFor(null), ...request })
	}

	return { state, run, resolveNow, lastGate: () => state.gate }
}


export function createFutureIntegrationConsoleSurface(installContext, bridge, resolver, plan) {
	return {
		owner: PHASE_ID,
		flagId: FLAG_ID,
		patchOrders: [...plan.orders],
		glslPatchCount: GLSL_PATCH_COUNT,
		gateDoorIds: [...SB_GATE_DOOR_IDS],
		technologyIds: [...SB_RENDER_TECHNOLOGY_IDS],
		gate: (request) => resolver.resolveNow(request),
		doors: () => resolver.lastGate()?.doors ?? [],
		branches: () => describeFutureIntegration({ plan }).branches,
		plan: () => plan,
		declarations: () => ({ ...SB_FUTURE_INTEGRATION_DECLARATIONS_BY_BRANCH }),
		bridge: () => bridge.report(),
		safeMode: (reason) => bridge.enterSafeMode(reason ?? "modo seguro pedido no console"),
		restore: () => bridge.leaveSafeMode(),
		pixelParity: (ssim) => evaluateBranchPixelParity({ ssim }),
		certify: (pixelParity) => certifyFutureIntegration({ pixelParity }),
		describe: (request) => describeFutureIntegration({ plan, ...request }),
		frameState: () => ({ ...resolver.state }),
		isActive: () => resolver.lastGate()?.substrateActive === true,
	}
}


function publishConsoleSurface(consoleSurface) {
	const lab = getSubstrateHostSurface()
	if (!lab || typeof lab !== "object") return false
	lab[CONSOLE_SURFACE_NAME] = consoleSurface
	return true
}

function registerIntegrationFlag(installContext, refusals) {
	const registerFlag = installContext?.flags?.registerFlag
	if (typeof registerFlag !== "function") {
		refusals.push("bancada sem flags.registerFlag: a fase ficou sem chave de ignicao")
		return null
	}
	return registerFlag({
		id: FLAG_ID,
		owner: PHASE_ID,
		description: "Liga o caminho Substrate nas duas ramificacoes de render, com modo seguro no legado.",
		defaultsByTier: flagDefaultsByTier(),
	})
}

function registerGateFrameStage(installContext, resolver, refusals) {
	const registerFrameStage = installContext?.frameStages?.registerFrameStage
	if (typeof registerFrameStage !== "function") {
		refusals.push("bancada sem frameStages.registerFrameStage: o gate nao roda por quadro")
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


function summarizeInstall(certification, bridgeReport, plan, refusals) {
	const strip = certification.safeModeStrip
	const head =
		PHASE_ID +
		": " +
		bridgeReport.registeredBranchIds.length +
		"/" +
		SB_RENDER_BRANCH_IDS.length +
		" ramificacoes costuradas nas ordens " +
		plan.orders.join(" e ") +
		", gate de " +
		SB_GATE_DOOR_IDS.length +
		" portas com " +
		certification.gateMatrix.substrateRowCount +
		"/" +
		certification.gateMatrix.rowCount +
		" combinacoes no Substrate e " +
		certification.gateMatrix.weakTierSubstrateRowCount +
		" no tier fraco, modo seguro deixa " +
		strip.activeCountAfterStrip +
		" patch ativo com geracao " +
		strip.generationBefore +
		" para " +
		strip.generationAfterStrip +
		", portao de pixel peca x pool " +
		(certification.pixelParity.pending ? "PENDENTE" : String(certification.pixelParity.measured)) +
		" (gate " +
		certification.pixelParity.gate +
		"), material-lite do IL-F11 " +
		(certification.legacyMaterialLite.retired ? "aposentado" : "mantido")
	if (refusals.length === 0) return head
	return head + " -- com " + refusals.length + " recusa(s), a primeira: " + refusals[0]
}






export function installPhase(installContext = {}) {
	const refusals = []
	try {
		for (const problem of futureIntegrationGlslProblems()) {
			refusals.push("GLSL da fase: " + problem)
		}

		const plan = createBranchPatchPlan({ declarationsByBranch: SB_FUTURE_INTEGRATION_DECLARATIONS_BY_BRANCH })
		for (const refusal of plan.refusals) {
			refusals.push("plano de patch: " + refusal)
		}

		const flag = registerIntegrationFlag(installContext, refusals)

		const bridge = createPatchRegistryBridge({
			patchApi: installContext?.patch,
			flagsApi: installContext?.flags,
			three: installContext?.bench?.THREE,
			flagId: FLAG_ID,
			owner: PHASE_ID,
		})
		const bridgeReport = bridge.registerBranchPlan(plan)
		for (const refusal of bridgeReport.refusals) {
			refusals.push("registro de patch: " + refusal)
		}
		if (bridgeReport.safeMode) {
			refusals.push("a fase nasceu em modo seguro: " + bridgeReport.safeModeReason)
		}

		const resolver = createFutureIntegrationGateResolver(installContext, bridge)
		const frameStage = registerGateFrameStage(installContext, resolver, refusals)
		declareBudget(installContext)

		const certification = certifyFutureIntegration()
		for (const problem of certification.problems) {
			refusals.push("portao da certificacao: " + problem)
		}

		const gate = resolver.resolveNow()
		const consoleSurface = createFutureIntegrationConsoleSurface(installContext, bridge, resolver, plan)
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
			patchOrders: [...plan.orders],
			glslPatchCount: GLSL_PATCH_COUNT,
			textureUnitsConsumed: TEXTURE_UNITS_CONSUMED_BY_PHASE,
			closureBytesAdded: CLOSURE_BYTES_ADDED_BY_PHASE,
			registeredBranchIds: [...bridgeReport.registeredBranchIds],
			safeMode: bridgeReport.safeMode,
			safeModeReason: bridgeReport.safeModeReason,
			programGeneration: bridgeReport.programGeneration,
			gateMode: gate?.mode ?? null,
			gateReason: gate?.reason ?? null,
			pendingGates: [...certification.pendingGates],
			legacyMaterialLiteRetired: certification.legacyMaterialLite.retired,
			consolePublished,
			consoleSurface,
			bridge,
			resolver,
			certification,
			refusals,
			summary: summarizeInstall(certification, bridgeReport, plan, refusals),
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
