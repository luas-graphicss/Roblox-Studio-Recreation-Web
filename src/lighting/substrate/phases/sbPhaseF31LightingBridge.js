import { getSubstrateHostSurface } from "../runtime/substrateHostSurface.js";


import { SB_TIER_NAMES, patchOrderFor, tierDefaults } from "../sbMaterialContract.js"
import { resolveTierName, tierClosureCeiling } from "../sbClosureDispatchCore.js"
import { buildClosureLightingGlsl, closureLightingGlslProblems } from "../sbClosureLightingGlsl.js"
import {
	SB_LIGHTING_GATE_CLOSURE_COUNT,
	describeLightingBridge,
	evaluateLightingBridgeGate,
	measureClosureLightingCost,
	splitSurfaceIntoClosures,
	buildLightingBridgePlan,
	SB_LIGHTING_GATE_SURFACE,
} from "../sbLightingBridgeCore.js"

export const PHASE_ID = "SB-F31"
export const LIGHTING_BRIDGE_FLAG_ID = "SubstrateClosureLighting"
export const LIGHTING_BRIDGE_PASS_NAME = "lightingBridge"
export const DECLARATIONS_PATCH_ID = "sbClosureLightingDeclarations"
export const SHADING_PATCH_ID = "sbClosureLightingShading"
export const DECLARATIONS_ANCHOR_ID = "lightsPhysicalPars"
export const SHADING_ANCHOR_ID = "lightsFragmentEnd"
export const LIGHTING_BRIDGE_MATERIAL_PATHS = Object.freeze(["standard", "physical"])
export const SB_LIGHTING_BRIDGE_TEXTURE_UNITS = 0
export const SB_LIGHTING_BRIDGE_CLOSURE_BYTES = 0
const FALLBACK_TIER_NAME = "forte"


const IDLE_PASS_REPORT = Object.freeze({
	phaseId: PHASE_ID,
	shadedClosures: 0,
	reason: "a luz por closure chega com a SB-F30/SB-F32; a ponte esta montada e ociosa",
})

export { evaluateLightingBridgeGate }


export function flagDefaultsByTier() {
	const defaults = {}
	for (const tierName of SB_TIER_NAMES) {
		defaults[tierName] = tierDefaults(tierName)?.substrateEnabled === true
	}
	return defaults
}

function describeAnchorProblem(installContext, anchorId) {
	const checkAnchor = installContext?.patch?.checkAnchor
	if (typeof checkAnchor !== "function") return null
	const report = checkAnchor(anchorId)
	if (report?.present === false) {
		return "ancora ausente: " + anchorId + " (" + (report.reason ?? "assinatura nao encontrada") + ")"
	}
	return null
}

function resolveTierNameFromBench(installContext) {
	const benchTier = installContext?.bench?.tier
	const rawTier = typeof benchTier === "function" ? benchTier() : null
	return resolveTierName(rawTier ?? FALLBACK_TIER_NAME)
}

function resolvePatchOrders(refusals) {
	const declarationsOrder = patchOrderFor(PHASE_ID, 0)
	const shadingOrder = patchOrderFor(PHASE_ID, 1)
	if (!Number.isInteger(declarationsOrder) || !Number.isInteger(shadingOrder)) {
		refusals.push("o contrato nao devolveu as duas ordens de patch da " + PHASE_ID)
		return null
	}
	return { declarationsOrder, shadingOrder }
}

function registerLightingPatches(installContext, glsl, orders, refusals) {
	const registerPatch = installContext?.patch?.registerPatch
	if (typeof registerPatch !== "function") {
		refusals.push("bancada sem registerPatch: nenhum GLSL costurado")
		return []
	}
	const anchorProblems = [
		describeAnchorProblem(installContext, DECLARATIONS_ANCHOR_ID),
		describeAnchorProblem(installContext, SHADING_ANCHOR_ID),
	].filter((problem) => typeof problem === "string")
	if (anchorProblems.length > 0) {
		for (const problem of anchorProblems) refusals.push(problem)
		refusals.push("nenhum patch registrado: sem as duas ancoras a ponte ficaria meio shader")
		return []
	}
	const requests = [
		{
			id: DECLARATIONS_PATCH_ID,
			owner: PHASE_ID,
			anchor: DECLARATIONS_ANCHOR_ID,
			order: orders.declarationsOrder,
			flagId: LIGHTING_BRIDGE_FLAG_ID,
			materialPaths: [...LIGHTING_BRIDGE_MATERIAL_PATHS],
			declarations: glsl.declarations,
		},
		{
			id: SHADING_PATCH_ID,
			owner: PHASE_ID,
			anchor: SHADING_ANCHOR_ID,
			order: orders.shadingOrder,
			flagId: LIGHTING_BRIDGE_FLAG_ID,
			materialPaths: [...LIGHTING_BRIDGE_MATERIAL_PATHS],
			code: glsl.code,
		},
	]
	const accepted = []
	for (const request of requests) {
		const result = registerPatch(request)
		if (result?.accepted === false) {
			refusals.push("patch recusado: " + request.id + " (" + (result.reason ?? "sem motivo declarado") + ")")
			continue
		}
		accepted.push({ id: request.id, anchor: request.anchor, order: request.order })
	}
	return accepted
}

function registerLightingPass(installContext, refusals) {
	const registerPass = installContext?.passes?.registerPass
	if (typeof registerPass !== "function") {
		refusals.push("bancada sem registerPass: o passe " + LIGHTING_BRIDGE_PASS_NAME + " nao foi assumido")
		return false
	}
	const result = registerPass(LIGHTING_BRIDGE_PASS_NAME, {
		owner: PHASE_ID,
		execute(frameContext) {
			if (frameContext) frameContext.lightingBridge = frameContext.materialRuntimeEnabled
				? { mode: "per-closure-gpu", preparedMaterials: frameContext.substrateMaterials?.length ?? 0 }
				: IDLE_PASS_REPORT
			return frameContext
		},
	})
	if (result?.accepted === false) {
		refusals.push("passe recusado: " + LIGHTING_BRIDGE_PASS_NAME + " (" + (result.reason ?? "sem motivo declarado") + ")")
		return false
	}
	return true
}

function reportTelemetry(installContext) {
	const telemetry = installContext?.telemetry
	if (typeof telemetry?.textureUnit === "function") {
		telemetry.textureUnit(PHASE_ID, SB_LIGHTING_BRIDGE_TEXTURE_UNITS)
	}
	if (typeof telemetry?.closureBytes === "function") {
		telemetry.closureBytes(PHASE_ID, SB_LIGHTING_BRIDGE_CLOSURE_BYTES)
	}
}


function buildConsolePlan(tierName) {
	const closures = splitSurfaceIntoClosures({
		surface: SB_LIGHTING_GATE_SURFACE,
		closureCount: SB_LIGHTING_GATE_CLOSURE_COUNT,
	})
	return buildLightingBridgePlan({ closures, tierName })
}

function publishConsoleApi(consoleApi) {
	if (typeof window === "undefined") return false
	const lab = getSubstrateHostSurface()
	if (!lab || typeof lab !== "object") return false
	lab.lightingBridge = consoleApi
	return true
}


export function installPhase(installContext) {
	const refusals = []
	const tierName = resolveTierNameFromBench(installContext)
	const closureCeiling = tierClosureCeiling(tierName)
	const glsl = buildClosureLightingGlsl({ closureCeiling })
	for (const problem of closureLightingGlslProblems(glsl)) {
		refusals.push("GLSL da ponte: " + problem)
	}

	const registerFlag = installContext?.flags?.registerFlag
	if (typeof registerFlag === "function") {
		registerFlag({
			id: LIGHTING_BRIDGE_FLAG_ID,
			owner: PHASE_ID,
			description: "Iluminacao avalia cada closure com albedo e EnvBRDF fatorados fora (SB-F31)",
			defaultsByTier: flagDefaultsByTier(),
		})
	} else {
		refusals.push("bancada sem registerFlag: a flag " + LIGHTING_BRIDGE_FLAG_ID + " nao existe")
	}

	const orders = resolvePatchOrders(refusals)
	const appliedPatches = orders ? registerLightingPatches(installContext, glsl, orders, refusals) : []
	const passRegistered = registerLightingPass(installContext, refusals)
	reportTelemetry(installContext)

	if (typeof installContext?.patch?.healMaterials === "function") {
		installContext.patch.healMaterials()
	}

	const telemetryError = installContext?.telemetry?.error
	if (refusals.length > 0 && typeof telemetryError === "function") {
		for (const refusal of refusals) telemetryError(PHASE_ID, refusal)
	}

	const consolePublished = publishConsoleApi({
		describe: () => describeLightingBridge(),
		plan: () => buildConsolePlan(tierName).plan,
		gate: (input) => evaluateLightingBridgeGate(input),
		cost: (samples) => measureClosureLightingCost({ plan: buildConsolePlan(tierName).plan, samples }),
		refusals: () => [...refusals],
	})

	return {
		phaseId: PHASE_ID,
		installed: refusals.length === 0,
		tierName,
		closureCeiling,
		flagId: LIGHTING_BRIDGE_FLAG_ID,
		passName: LIGHTING_BRIDGE_PASS_NAME,
		passRegistered,
		appliedPatches,
		textureUnits: SB_LIGHTING_BRIDGE_TEXTURE_UNITS,
		closureBytes: SB_LIGHTING_BRIDGE_CLOSURE_BYTES,
		consolePublished,
		refusals,
	}
}
