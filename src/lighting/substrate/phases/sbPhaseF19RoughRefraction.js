import { getSubstrateHostSurface } from "../runtime/substrateHostSurface.js";


import { SB_LAYERED_PRESETS } from "../support/src/lab/labSlabPresets.js"
import { SB_PASS_OWNERS, SB_TIER_NAMES, patchOrderFor, tierDefaults } from "../sbMaterialContract.js"
import { normalBlurWeight, planFromCoatRecord, planFromLayeredPreset, roughRefractionGlslConstants } from "../sbRoughRefractionCore.js"
import {
	SB_ROUGH_REFRACTION_CLOSURE_BYTES,
	SB_ROUGH_REFRACTION_MEASURED_ROUGHNESSES,
	SB_ROUGH_REFRACTION_TEXTURE_UNITS,
	certifyRoughRefraction,
	measureBlurByRoughness,
	roughRefractionCostDeclarations,
} from "../sbRoughRefractionCertificationCore.js"
import {
	SB_ROUGH_REFRACTION_APPLICATION_ANCHOR,
	SB_ROUGH_REFRACTION_APPLICATION_GLSL,
	SB_ROUGH_REFRACTION_DECLARATIONS_ANCHOR,
	SB_ROUGH_REFRACTION_DECLARATIONS_GLSL,
	SB_ROUGH_REFRACTION_RUNTIME_FUNCTION_NAMES,
	SB_ROUGH_REFRACTION_RUNTIME_GLSL,
	SB_ROUGH_REFRACTION_UNIFORM_NAME,
} from "../sbRoughRefractionGlsl.js"

export const PHASE_ID = "SB-F19"
export const SB_ROUGH_REFRACTION_FLAG_ID = "SubstrateRoughRefraction"
export const SB_ROUGH_REFRACTION_PASS_NAME = "opaqueRoughRefraction"
export const SB_ROUGH_REFRACTION_DECLARATIONS_PATCH_ID = "sbF19RoughRefractionDeclarations"
export const SB_ROUGH_REFRACTION_APPLICATION_PATCH_ID = "sbF19RoughRefractionApplication"

const DECLARATIONS_PATCH_SUB_SLOT = 0
const APPLICATION_PATCH_SUB_SLOT = 1
const DEFAULT_LAYERED_PRESET_ID = "carPaint"
const DEFAULT_VIEW_COSINE = 1


export function roughRefractionFlagDefaultsByTier() {
	const defaultsByTier = {}
	for (const tierName of SB_TIER_NAMES) {
		defaultsByTier[tierName] = tierDefaults(tierName).roughRefraction === true
	}
	return defaultsByTier
}

function createPhaseState() {
	return {
		presetId: DEFAULT_LAYERED_PRESET_ID,
		viewCosine: DEFAULT_VIEW_COSINE,
		lastPlan: null,
		lastStrength: 0,
		lastFlagActive: null,
		frameCount: 0,
	}
}

function resolveLayeredPreset(presetId) {
	return SB_LAYERED_PRESETS[presetId] ?? SB_LAYERED_PRESETS[DEFAULT_LAYERED_PRESET_ID]
}


function createRoughRefractionPass({ flags, patch, telemetry, state }) {
	return function executeOpaqueRoughRefraction(frameContext) {
		const tierName = frameContext?.tier ?? null
		const flagActive =
			typeof flags?.isFlagActive === "function"
				? flags.isFlagActive(SB_ROUGH_REFRACTION_FLAG_ID, tierName) === true
				: false
		const plan = flagActive
			? planFromLayeredPreset(resolveLayeredPreset(state.presetId), { cosThetaView: state.viewCosine })
			: null
		const strength = plan ? plan.strength : 0
		if (typeof patch?.setUniform === "function") patch.setUniform(SB_ROUGH_REFRACTION_UNIFORM_NAME, strength)

		const changed = strength !== state.lastStrength || flagActive !== state.lastFlagActive
		state.lastPlan = plan
		state.lastStrength = strength
		state.lastFlagActive = flagActive
		state.frameCount += 1


		if (changed && typeof telemetry?.pass === "function") {
			telemetry.pass(SB_ROUGH_REFRACTION_PASS_NAME, {
				owner: PHASE_ID,
				stub: false,
				flagActive,
				tier: tierName,
				presetId: state.presetId,
				strength,
			})
		}
		return frameContext
	}
}

function registerRoughRefractionFlag(installContext) {
	if (typeof installContext?.flags?.registerFlag !== "function") {
		return { accepted: false, reason: "bancada sem registro de flag" }
	}
	installContext.flags.registerFlag({
		id: SB_ROUGH_REFRACTION_FLAG_ID,
		owner: PHASE_ID,
		description: "desfoca a camada de baixo conforme a rugosidade e o IOR da camada de cima",
		defaultsByTier: roughRefractionFlagDefaultsByTier(),
	})
	return { accepted: true, flagId: SB_ROUGH_REFRACTION_FLAG_ID, defaultsByTier: roughRefractionFlagDefaultsByTier() }
}

function registerRoughRefractionUniform(installContext) {
	if (typeof installContext?.patch?.registerUniform !== "function") {
		return { accepted: false, reason: "bancada sem registro de uniform" }
	}
	installContext.patch.registerUniform(SB_ROUGH_REFRACTION_UNIFORM_NAME, { owner: PHASE_ID, value: 0 })
	return { accepted: true, name: SB_ROUGH_REFRACTION_UNIFORM_NAME }
}


function inspectAnchor(installContext, anchorId) {
	const three = installContext?.bench?.THREE ?? null
	const checkAnchor = installContext?.patch?.checkAnchor
	if (typeof checkAnchor !== "function" || !three) {
		return { anchorId, present: true, reason: "verificacao indisponivel" }
	}
	return checkAnchor(three, anchorId) ?? { anchorId, present: false, reason: "verificacao sem resposta" }
}

function registerRoughRefractionPatches(installContext) {
	if (typeof installContext?.patch?.registerPatch !== "function") {
		return { accepted: false, reason: "bancada sem registro de patch" }
	}

	const anchors = [SB_ROUGH_REFRACTION_DECLARATIONS_ANCHOR, SB_ROUGH_REFRACTION_APPLICATION_ANCHOR].map((anchorId) =>
		inspectAnchor(installContext, anchorId),
	)
	const missingAnchors = anchors.filter((anchor) => anchor.present !== true)
	if (missingAnchors.length > 0) {
		const reason = "ancora indisponivel: " + missingAnchors.map((anchor) => anchor.anchorId).join(", ")
		if (typeof installContext?.telemetry?.error === "function") installContext.telemetry.error(PHASE_ID, reason)
		return { accepted: false, reason, anchors }
	}

	const uniforms = { [SB_ROUGH_REFRACTION_UNIFORM_NAME]: SB_ROUGH_REFRACTION_UNIFORM_NAME }
	const declarationsOrder = patchOrderFor(PHASE_ID, DECLARATIONS_PATCH_SUB_SLOT)
	const applicationOrder = patchOrderFor(PHASE_ID, APPLICATION_PATCH_SUB_SLOT)

	const declarations = installContext.patch.registerPatch({
		id: SB_ROUGH_REFRACTION_DECLARATIONS_PATCH_ID,
		owner: PHASE_ID,
		anchor: SB_ROUGH_REFRACTION_DECLARATIONS_ANCHOR,
		order: declarationsOrder,
		flagId: SB_ROUGH_REFRACTION_FLAG_ID,
		code: SB_ROUGH_REFRACTION_DECLARATIONS_GLSL,
		uniforms,
	})


	if (declarations?.accepted !== true) {
		return { accepted: false, reason: declarations?.reason ?? "declaracao recusada", declarations, anchors }
	}

	const application = installContext.patch.registerPatch({
		id: SB_ROUGH_REFRACTION_APPLICATION_PATCH_ID,
		owner: PHASE_ID,
		anchor: SB_ROUGH_REFRACTION_APPLICATION_ANCHOR,
		order: applicationOrder,
		flagId: SB_ROUGH_REFRACTION_FLAG_ID,
		code: SB_ROUGH_REFRACTION_APPLICATION_GLSL,
		uniforms,
	})

	return {
		accepted: application?.accepted === true,
		reason: application?.reason ?? null,
		declarations,
		application,
		orders: [declarationsOrder, applicationOrder],
		anchors,
	}
}

function registerRoughRefractionPass(installContext, state) {
	if (typeof installContext?.passes?.registerPass !== "function") {
		return { accepted: false, reason: "bancada sem grafo de passes" }
	}
	return installContext.passes.registerPass(SB_ROUGH_REFRACTION_PASS_NAME, {
		owner: PHASE_ID,
		execute: createRoughRefractionPass({
			flags: installContext.flags,
			patch: installContext.patch,
			telemetry: installContext.telemetry,
			state,
		}),
	})
}


function declareBudget(telemetry) {
	if (typeof telemetry?.textureUnit === "function") {
		telemetry.textureUnit("roughRefraction", SB_ROUGH_REFRACTION_TEXTURE_UNITS)
	}
	if (typeof telemetry?.closureBytes === "function") {
		telemetry.closureBytes(PHASE_ID, SB_ROUGH_REFRACTION_CLOSURE_BYTES)
	}
}

function createRoughRefractionConsole({ state, certification }) {
	return {
		phase: PHASE_ID,
		flagId: SB_ROUGH_REFRACTION_FLAG_ID,
		passName: SB_ROUGH_REFRACTION_PASS_NAME,
		uniformName: SB_ROUGH_REFRACTION_UNIFORM_NAME,

		presets: () => Object.keys(SB_LAYERED_PRESETS).sort(),

		preset(presetId) {
			if (presetId && SB_LAYERED_PRESETS[presetId]) state.presetId = presetId
			return state.presetId
		},

		viewCosine(cosine) {
			if (Number.isFinite(cosine)) state.viewCosine = Math.min(1, Math.max(0, cosine))
			return state.viewCosine
		},

		plan: () => planFromLayeredPreset(resolveLayeredPreset(state.presetId), { cosThetaView: state.viewCosine }),

		curve: (roughnesses) =>
			measureBlurByRoughness({ roughnesses: roughnesses ?? SB_ROUGH_REFRACTION_MEASURED_ROUGHNESSES }),

		costs: () => roughRefractionCostDeclarations(),

		certify: () => certifyRoughRefraction({}),

		installCertification: () => certification,

		runtime: () => ({
			consumer: "sbRuntimeClosureShader",
			functions: [...SB_ROUGH_REFRACTION_RUNTIME_FUNCTION_NAMES],
			constants: roughRefractionGlslConstants(),
			glslLength: SB_ROUGH_REFRACTION_RUNTIME_GLSL.length,
			blursNormalDetail: true,
			blursIndirectSpecular: true,
		}),

		coatPlan: (request) => planFromCoatRecord(request ?? {}),

		normalBlurWeight: (strength) => normalBlurWeight(strength),

		state: () => ({
			presetId: state.presetId,
			viewCosine: state.viewCosine,
			strength: state.lastStrength,
			flagActive: state.lastFlagActive,
			frames: state.frameCount,
		}),
	}
}


function publishRoughRefractionConsole(roughRefractionConsole) {
	const lab = typeof window === "undefined" ? null : getSubstrateHostSurface()
	if (!lab) return { published: false }
	lab.roughRefraction = roughRefractionConsole
	return { published: true }
}


function describeInstallation({ certification, registrations }) {
	const curve = certification.curve
	const lastPoint = curve.points[curve.points.length - 1]
	const defaultPreset = certification.presets.find((measured) => measured.presetId === DEFAULT_LAYERED_PRESET_ID)
	const flagDefaults = roughRefractionFlagDefaultsByTier()
	const measurements = [
		`desfoque ${curve.points[0].blurGrowth.toFixed(4)} ate ${lastPoint.blurGrowth.toFixed(4)} em ${curve.pointCount} rugosidades`,
		`passo minimo ${curve.smallestBlurStep.toFixed(4)}`,
		curve.identityAtZeroRoughness ? "rugosidade 0 sem desfoque" : "RUGOSIDADE 0 MEXEU NA IMAGEM",
		defaultPreset ? `${defaultPreset.presetId} com forca ${defaultPreset.plan.strength.toFixed(4)}` : "sem preset em camadas",
		registrations.patches.accepted
			? `patches ${registrations.patches.orders.join(" e ")} em ${SB_ROUGH_REFRACTION_DECLARATIONS_ANCHOR} e ${SB_ROUGH_REFRACTION_APPLICATION_ANCHOR}`
			: `patches recusados: ${registrations.patches.reason}`,
		registrations.pass.accepted ? `passe ${SB_ROUGH_REFRACTION_PASS_NAME} assumido` : `passe recusado: ${registrations.pass.reason}`,
		`tiers ${SB_TIER_NAMES.map((tierName) => tierName + ":" + (flagDefaults[tierName] ? "sim" : "nao")).join(" ")}`,
		`${SB_ROUGH_REFRACTION_TEXTURE_UNITS} unidade de textura e ${SB_ROUGH_REFRACTION_CLOSURE_BYTES} byte de closure`,
		`laco de closures consome ${SB_ROUGH_REFRACTION_RUNTIME_FUNCTION_NAMES.length} funcoes do nucleo (lobo, IBL e normal da camada de baixo desfocados por coat)`,
	]
	const headline = certification.ok
		? "refracao rugosa opaca instalada"
		: `PORTAO NAO FECHADO: ${certification.problems.join(" | ")}`
	return `${PHASE_ID} ${headline} (${measurements.join(", ")})`
}

export function installPhase(installContext) {
	try {
		const state = createPhaseState()
		const certification = certifyRoughRefraction({})
		const registrations = {
			flag: registerRoughRefractionFlag(installContext),
			uniform: registerRoughRefractionUniform(installContext),
			patches: registerRoughRefractionPatches(installContext),
			pass: registerRoughRefractionPass(installContext, state),
			contractPassOwner: SB_PASS_OWNERS[SB_ROUGH_REFRACTION_PASS_NAME],
		}
		declareBudget(installContext?.telemetry)
		const roughRefractionConsole = createRoughRefractionConsole({ state, certification })
		const publication = publishRoughRefractionConsole(roughRefractionConsole)
		return {
			summary: describeInstallation({ certification, registrations }),
			certification,
			registrations,
			publication,
			roughRefraction: roughRefractionConsole,
		}
	} catch (installError) {
		return { summary: `${PHASE_ID} nao instalou: ${installError?.message ?? String(installError)}` }
	}
}
