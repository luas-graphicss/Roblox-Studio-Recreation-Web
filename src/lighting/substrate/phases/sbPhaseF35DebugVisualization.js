import { getSubstrateHostSurface } from "../runtime/substrateHostSurface.js";


import { SB_TIER_NAMES, passOwner, patchOrderFor, tierDefaults } from "../sbMaterialContract.js"
import {
	SB_DEBUG_MODES,
	SB_DEBUG_MODE_IDS,
	debugModeEntry,
	debugVisualizationSignature,
	evaluateDebugVisualization,
	isKnownDebugMode,
} from "../sbDebugVisualizationCore.js"
import { SB_DEBUG_MODE_UNIFORM_NAME, buildDebugVisualizationGlsl, debugVisualizationGlslProblems } from "../sbDebugVisualizationGlsl.js"
import { certifyDebugVisualization } from "../sbDebugVisualizationCertificationCore.js"
import { createClosureInspectorPanel } from "../support/src/ui/sbClosureInspector.js"

export const PHASE_ID = "SB-F35"
export const FLAG_ID = "SubstrateDebugVisualization"
export const PASS_NAME = "debugVisualization"
export const DECLARATIONS_PATCH_ID = "sbDebugVisualizationDeclarations"
export const APPLY_PATCH_ID = "sbDebugVisualizationApply"
export const DECLARATIONS_ANCHOR_ID = "common"
export const APPLY_ANCHOR_ID = "opaqueFragment"
export const DECLARATIONS_PATCH_SUB_SLOT = 0
export const APPLY_PATCH_SUB_SLOT = 1
export const PATCHED_MATERIAL_PATHS = Object.freeze(["standard", "physical"])
export const TEXTURE_UNITS_CONSUMED_BY_PHASE = 0
export const CLOSURE_BYTES_ADDED_BY_PHASE = 0
export const PANEL_CONTAINER_ID = "sb-hud"
export const CONSOLE_SURFACE_NAME = "debugVisualization"

const FALLBACK_TIER_NAME = "forte"


export function debugFlagDefaultsByTier() {
	const defaultsByTier = {}
	for (const tierName of SB_TIER_NAMES) {
		defaultsByTier[tierName] = Boolean(tierDefaults(tierName)?.debugVisualization)
	}
	return defaultsByTier
}

function benchTierName(installContext) {
	const readTier = installContext?.bench?.tier
	const tierName = typeof readTier === "function" ? readTier() : null
	return typeof tierName === "string" ? tierName : FALLBACK_TIER_NAME
}

function debugIsActive(installContext) {
	const isFlagActive = installContext?.flags?.isFlagActive
	if (typeof isFlagActive !== "function") return false
	return isFlagActive(FLAG_ID, benchTierName(installContext)) === true
}

function registerDebugFlag(installContext, refusals) {
	const registerFlag = installContext?.flags?.registerFlag
	const defaultsByTier = debugFlagDefaultsByTier()
	if (typeof registerFlag !== "function") {
		refusals.push("bancada sem flags.registerFlag: o operador nao consegue ligar o debug")
		return { accepted: false, defaultsByTier }
	}
	registerFlag({
		id: FLAG_ID,
		owner: PHASE_ID,
		description: "modos de debug de material: contagem por pixel, bytes por pixel e inspetor de closures",
		defaultsByTier,
	})
	return { accepted: true, flagId: FLAG_ID, defaultsByTier }
}

function registerDebugUniform(installContext, refusals) {
	const registerUniform = installContext?.patch?.registerUniform
	if (typeof registerUniform !== "function") {
		refusals.push("bancada sem patch.registerUniform: o modo nao chega ao shader")
		return { accepted: false, name: SB_DEBUG_MODE_UNIFORM_NAME }
	}
	registerUniform(SB_DEBUG_MODE_UNIFORM_NAME, { owner: PHASE_ID, value: 0 })
	return { accepted: true, name: SB_DEBUG_MODE_UNIFORM_NAME }
}


export function inspectPatchAnchor(installContext, anchorId) {
	const three = installContext?.bench?.THREE ?? null
	const checkAnchor = installContext?.patch?.checkAnchor
	if (!three || typeof checkAnchor !== "function") {
		return { anchorId, present: null, reason: "ancora nao verificada aqui: contexto sem three.js" }
	}
	return checkAnchor(three, anchorId) ?? { anchorId, present: false, reason: "verificacao sem resposta" }
}

function registerGlslPatches(installContext, refusals) {
	const glsl = buildDebugVisualizationGlsl()
	const declarationsOrder = patchOrderFor(PHASE_ID, DECLARATIONS_PATCH_SUB_SLOT)
	const applyOrder = patchOrderFor(PHASE_ID, APPLY_PATCH_SUB_SLOT)
	const anchors = {
		declarations: inspectPatchAnchor(installContext, DECLARATIONS_ANCHOR_ID),
		apply: inspectPatchAnchor(installContext, APPLY_ANCHOR_ID),
	}
	const result = { glsl, anchors, declarationsOrder, applyOrder, registeredPatchIds: [] }

	for (const problem of debugVisualizationGlslProblems(glsl)) {
		refusals.push("autoexame do GLSL: " + problem)
	}
	if (result.registeredPatchIds.length === 0 && refusals.length > 0) {

	}

	const registerPatch = installContext?.patch?.registerPatch
	if (typeof registerPatch !== "function") {
		refusals.push("bancada sem patch.registerPatch: os modos ficam so com numero, sem pixel")
		return result
	}
	if (typeof declarationsOrder !== "number" || typeof applyOrder !== "number") {
		refusals.push("o contrato nao reserva ordem de patch para " + PHASE_ID)
		return result
	}
	const missingAnchors = [anchors.declarations, anchors.apply].filter((anchor) => anchor.present === false)
	if (missingAnchors.length > 0) {
		refusals.push(
			"ancora ausente: " +
				missingAnchors.map((anchor) => anchor.anchorId + " (" + (anchor.reason ?? "sem motivo") + ")").join(", "),
		)
		return result
	}

	const uniforms = { [SB_DEBUG_MODE_UNIFORM_NAME]: SB_DEBUG_MODE_UNIFORM_NAME }
	const declarations = registerPatch({
		id: DECLARATIONS_PATCH_ID,
		owner: PHASE_ID,
		anchor: DECLARATIONS_ANCHOR_ID,
		order: declarationsOrder,
		flagId: FLAG_ID,
		declarations: glsl.declarations,
		materialPaths: [...PATCHED_MATERIAL_PATHS],
		uniforms,
	})
	if (declarations?.accepted !== true) {
		refusals.push("patch de declaracoes recusado: " + (declarations?.reason ?? "motivo nao informado"))
		return result
	}
	result.registeredPatchIds.push(DECLARATIONS_PATCH_ID)

	const apply = registerPatch({
		id: APPLY_PATCH_ID,
		owner: PHASE_ID,
		anchor: APPLY_ANCHOR_ID,
		order: applyOrder,
		flagId: FLAG_ID,
		code: glsl.code,
		materialPaths: [...PATCHED_MATERIAL_PATHS],
		uniforms,
	})
	if (apply?.accepted !== true) {
		refusals.push("patch de aplicacao recusado: " + (apply?.reason ?? "motivo nao informado"))
		return result
	}
	result.registeredPatchIds.push(APPLY_PATCH_ID)
	return result
}








export function createDebugVisualizationResolver(installContext) {
	const state = {
		modeId: SB_DEBUG_MODE_IDS.off,
		signature: null,
		lastEvaluation: null,
		resolveCount: 0,
		skippedFrameCount: 0,
		uniformWriteCount: 0,
		lastUniformCode: null,
		refusals: [],
	}

	function writeUniform(modeCode) {
		if (state.lastUniformCode === modeCode) return false
		const setUniform = installContext?.patch?.setUniform
		if (typeof setUniform !== "function") return false
		setUniform(SB_DEBUG_MODE_UNIFORM_NAME, modeCode)
		state.lastUniformCode = modeCode
		state.uniformWriteCount += 1
		return true
	}

	function requestFromFrame(frameContext) {
		return {
			modeId: state.modeId,
			tierName: frameContext?.tier ?? benchTierName(installContext),
			closures: frameContext?.substrateClosures ?? frameContext?.closures ?? null,
		}
	}

	function run(frameContext) {
		if (!debugIsActive(installContext)) {
			state.skippedFrameCount += 1
			return frameContext
		}
		const request = requestFromFrame(frameContext)
		const signature = debugVisualizationSignature(request)
		if (signature !== state.signature) {
			state.signature = signature
			state.lastEvaluation = evaluateDebugVisualization(request)
			state.resolveCount += 1
		}
		writeUniform(state.lastEvaluation?.modeCode ?? 0)
		return frameContext
	}

	function setMode(modeId) {
		if (!isKnownDebugMode(modeId)) {
			const reason = "modo de debug desconhecido: " + String(modeId)
			state.refusals.push(reason)
			return { accepted: false, reason, modeId: state.modeId }
		}
		state.modeId = modeId
		state.signature = null
		writeUniform(debugModeEntry(modeId).code)
		return { accepted: true, modeId }
	}

	function report(request) {
		return evaluateDebugVisualization({
			modeId: state.modeId,
			tierName: request?.tierName ?? benchTierName(installContext),
			closures: request?.closures ?? null,
		})
	}

	return { state, run, setMode, report }
}

function registerDebugPass(installContext, resolver, refusals) {
	const registerPass = installContext?.passes?.registerPass
	if (typeof registerPass !== "function") {
		refusals.push("bancada sem passes.registerPass: o modo nao chega ao uniform por quadro")
		return { accepted: false }
	}
	if (passOwner(PASS_NAME) !== PHASE_ID) {
		refusals.push("o contrato nao da o passe " + PASS_NAME + " para " + PHASE_ID)
		return { accepted: false }
	}
	const registration = registerPass(PASS_NAME, {
		owner: PHASE_ID,
		execute: (frameContext) => resolver.run(frameContext),
	})
	if (registration?.accepted !== true) {
		refusals.push("passe recusado: " + (registration?.reason ?? "motivo nao informado"))
	}
	return registration ?? { accepted: false }
}

function declareBudget(installContext) {
	const telemetry = installContext?.telemetry
	if (typeof telemetry?.closureBytes === "function") telemetry.closureBytes(PHASE_ID, CLOSURE_BYTES_ADDED_BY_PHASE)
	if (typeof telemetry?.textureUnit === "function") telemetry.textureUnit(PHASE_ID, TEXTURE_UNITS_CONSUMED_BY_PHASE)
}

function createConsoleSurface(installContext, resolver, installedParts) {
	return {
		phaseId: PHASE_ID,
		flagId: FLAG_ID,
		passName: PASS_NAME,
		uniformName: SB_DEBUG_MODE_UNIFORM_NAME,
		modes: () => SB_DEBUG_MODES.map((mode) => ({ id: mode.id, code: mode.code, title: mode.title })),
		mode: () => resolver.state.modeId,
		setMode: (modeId) => resolver.setMode(modeId),
		report: (request) => resolver.report(request),
		isActive: () => debugIsActive(installContext),
		frameState: () => ({
			modeId: resolver.state.modeId,
			signature: resolver.state.signature,
			resolveCount: resolver.state.resolveCount,
			skippedFrameCount: resolver.state.skippedFrameCount,
			uniformWriteCount: resolver.state.uniformWriteCount,
			lastUniformCode: resolver.state.lastUniformCode,
		}),
		patches: () => [...installedParts.patches.registeredPatchIds],
		glsl: () => installedParts.patches.glsl,
		certify: () => certifyDebugVisualization(),
		certification: installedParts.certification,
		refusals: () => [...resolver.state.refusals],
	}
}

function publishConsoleSurface(consoleSurface) {
	const lab = typeof globalThis === "undefined" ? null : getSubstrateHostSurface()
	if (!lab || typeof lab !== "object") return false
	lab[CONSOLE_SURFACE_NAME] = consoleSurface
	return true
}

function mountInspectorPanel(consoleSurface, refusals) {
	if (getSubstrateHostSurface()?.host === "engine" || typeof document === "undefined") return null
	const container = document.getElementById(PANEL_CONTAINER_ID)
	if (!container) {
		refusals.push("painel nao montado: a pagina nao tem o container " + PANEL_CONTAINER_ID)
		return null
	}
	try {
		return createClosureInspectorPanel({ container, visualization: consoleSurface })
	} catch (panelError) {
		refusals.push("painel falhou ao montar: " + (panelError?.message ?? String(panelError)))
		return null
	}
}

export function installPhase(installContext = {}) {
	const refusals = []
	try {
		const flag = registerDebugFlag(installContext, refusals)
		const uniform = registerDebugUniform(installContext, refusals)
		const resolver = createDebugVisualizationResolver(installContext)
		const patches = registerGlslPatches(installContext, refusals)
		const pass = registerDebugPass(installContext, resolver, refusals)
		const certification = certifyDebugVisualization()
		for (const problem of certification.problems) refusals.push("portao da fase: " + problem)

		declareBudget(installContext)
		const consoleSurface = createConsoleSurface(installContext, resolver, { patches, certification })
		const published = publishConsoleSurface(consoleSurface)
		const panel = mountInspectorPanel(consoleSurface, refusals)

		const installed = refusals.length === 0
		const summary =
			PHASE_ID +
			": " +
			SB_DEBUG_MODES.length +
			" modos, " +
			patches.registeredPatchIds.length +
			" patch(es), " +
			TEXTURE_UNITS_CONSUMED_BY_PHASE +
			" unidade(s) de textura e " +
			CLOSURE_BYTES_ADDED_BY_PHASE +
			" byte(s) de closure"

		const telemetry = installContext?.telemetry
		if (typeof telemetry?.phase === "function") {
			telemetry.phase(PHASE_ID, { installed, patches: patches.registeredPatchIds.length, refusals: refusals.length })
		}
		if (typeof telemetry?.error === "function") {
			for (const refusal of refusals) telemetry.error(PHASE_ID, refusal)
		}

		return {
			phaseId: PHASE_ID,
			installed,
			flag,
			uniform,
			pass,
			patchIds: patches.registeredPatchIds,
			patchOrders: { declarations: patches.declarationsOrder, apply: patches.applyOrder },
			anchors: patches.anchors,
			textureUnitsConsumed: TEXTURE_UNITS_CONSUMED_BY_PHASE,
			closureBytesAdded: CLOSURE_BYTES_ADDED_BY_PHASE,
			certification,
			consolePublished: published,
			panelMounted: panel !== null,
			console: consoleSurface,
			panel,
			refusals,
			summary,
		}
	} catch (installError) {
		const reason = "instalacao falhou: " + (installError?.message ?? String(installError))
		if (typeof installContext?.telemetry?.error === "function") installContext.telemetry.error(PHASE_ID, reason)
		return { phaseId: PHASE_ID, installed: false, refusals: [reason], summary: reason }
	}
}
