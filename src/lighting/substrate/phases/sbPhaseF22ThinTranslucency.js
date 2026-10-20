import { getSubstrateHostSurface } from "../runtime/substrateHostSurface.js";


import {
	SB_THIN_SHADER_PHASE_ASYMMETRY,
	SB_THIN_TRANSLUCENCY_MATERIAL_DATA_KEY,
	SB_THIN_TRANSLUCENCY_OPAQUE_UNIFORM,
	SB_THIN_TRANSLUCENCY_PER_SLOT_UNIFORM_NAME,
	describeThinTranslucency,
	resolveMaterialThinTranslucency,
	findThinTranslucencyProblems,
	measureThinTranslucencyProfile,
	packThinTranslucencyUniform,
} from "../sbThinTranslucencyCore.js"
import { SB_THIN_TRANSLUCENCY_GLSL } from "../sbThinTranslucencyGlsl.js"
import {
	SB_DEFAULT_THIN_TRANSLUCENCY_PROFILE_ID,
	describeThinTranslucencyProfiles,
	thinTranslucencyProfile,
	thinTranslucencyProfileIds,
} from "../sbThinTranslucencyProfiles.js"

export const PHASE_ID = "SB-F22"

export const THIN_TRANSLUCENCY_FLAG = Object.freeze({
	id: "SubstrateThinTranslucency",
	owner: PHASE_ID,
	description: "transmissao fina por tras: folha, papel, tecido e petala",
	defaultsByTier: Object.freeze({ fraco: false, medio: true, forte: true }),
})


export const THIN_TRANSLUCENCY_UNIFORM_NAME = "uSbThinTranslucency"


const MATERIAL_PATHS = Object.freeze(["standard", "physical", "terreno", "skinned"])


const TEXTURE_UNITS_USED = 0
const CLOSURE_BYTES_USED = 0

const FUNCTIONS_PATCH = Object.freeze({
	id: "sbThinTranslucencyFunctions",
	anchor: "lightsPhysicalPars",
	subSlot: 0,
})

const LIGHTING_PATCH = Object.freeze({
	id: "sbThinTranslucencyLighting",
	anchor: "lightsFragmentEnd",
	subSlot: 1,
})


function resolveThree(installContext) {
	const fromContext = installContext?.bench?.THREE ?? null
	if (fromContext !== null) return fromContext
	if (typeof window === "undefined") return null
	return getSubstrateHostSurface()?.internals?.THREE ?? null
}

function resolvePatchOrder(installContext, subSlot) {
	const patchOrderFor = installContext?.contract?.patchOrderFor
	if (typeof patchOrderFor === "function") return patchOrderFor(PHASE_ID, subSlot)
	const baseOrder = installContext?.contract?.SB_PATCH_ORDER?.[PHASE_ID]
	return baseOrder === undefined ? null : baseOrder + subSlot
}


function findMissingAnchor(installContext, three) {
	const checkAnchor = installContext?.patch?.checkAnchor
	if (three === null || typeof checkAnchor !== "function") return null
	const missing = [FUNCTIONS_PATCH, LIGHTING_PATCH]
		.map((patch) => ({ anchor: patch.anchor, report: checkAnchor(three, patch.anchor) }))
		.find((entry) => !entry.report?.present)
	return missing === undefined ? null : missing
}

function patchDefinitionFor(patch, order) {
	const isFunctionsPatch = patch.id === FUNCTIONS_PATCH.id
	return {
		id: patch.id,
		owner: PHASE_ID,
		anchor: patch.anchor,
		order,
		flagId: THIN_TRANSLUCENCY_FLAG.id,
		materialPaths: MATERIAL_PATHS.slice(),
		uniforms: { [THIN_TRANSLUCENCY_UNIFORM_NAME]: THIN_TRANSLUCENCY_UNIFORM_NAME },
		declarations: isFunctionsPatch ? SB_THIN_TRANSLUCENCY_GLSL.uniformDeclaration : "",
		code: isFunctionsPatch ? SB_THIN_TRANSLUCENCY_GLSL.helperFunctions : SB_THIN_TRANSLUCENCY_GLSL.lightingAccumulation,
	}
}


function registerPatches(installContext) {
	const registerPatch = installContext?.patch?.registerPatch
	if (typeof registerPatch !== "function") return { accepted: [], refusal: "contexto sem harness de patch" }
	const accepted = []
	for (const patch of [FUNCTIONS_PATCH, LIGHTING_PATCH]) {
		const order = resolvePatchOrder(installContext, patch.subSlot)
		if (order === null) {
			return { accepted, refusal: `o contrato nao reserva ordem para ${PHASE_ID} no sub-slot ${patch.subSlot}` }
		}
		const registration = registerPatch(patchDefinitionFor(patch, order))
		if (!registration?.accepted) {
			return { accepted, refusal: `${patch.id} recusado: ${registration?.reason ?? "motivo nao informado"}` }
		}
		accepted.push({ id: patch.id, anchor: patch.anchor, order })
	}
	return { accepted, refusal: null }
}


function createThinTranslucencyConsole(installContext, state) {
	return {
		profiles: () => describeThinTranslucencyProfiles(),
		current: () => state.profileId,
		measure: (profileId) => measureThinTranslucencyProfile(profileId ?? state.profileId),
		describe: () => describeThinTranslucency(),
		packed: () => packThinTranslucencyUniform(thinTranslucencyProfile(state.profileId)),

		profile(profileId) {
			const profile = thinTranslucencyProfile(profileId)
			if (profile === null) {
				return { error: `perfil desconhecido: ${profileId}`, known: thinTranslucencyProfileIds() }
			}
			state.profileId = profileId
			installContext?.patch?.setUniform?.(THIN_TRANSLUCENCY_UNIFORM_NAME, packThinTranslucencyUniform(profile))
			return measureThinTranslucencyProfile(profileId)
		},

		apply(profileIdOrValues) {
			const runtime = installContext?.materialRuntime
			if (typeof runtime?.setMaterialData !== "function") return { ok: false, reason: "runtime de material indisponivel" }
			const authored = typeof profileIdOrValues === "string" ? { profileId: profileIdOrValues } : profileIdOrValues
			if (typeof authored?.profileId === "string" && thinTranslucencyProfile(authored.profileId) === null) {
				return { ok: false, reason: `perfil desconhecido: ${authored.profileId}`, known: thinTranslucencyProfileIds() }
			}
			const resolved = resolveMaterialThinTranslucency({ [SB_THIN_TRANSLUCENCY_MATERIAL_DATA_KEY]: authored }, thinTranslucencyProfile)
			if (!resolved.active) return { ok: false, reason: "espessura zero nao autora translucidez: use clear() para voltar ao opaco" }
			const result = runtime.setMaterialData(SB_THIN_TRANSLUCENCY_MATERIAL_DATA_KEY, authored)
			return result.ok ? { ...result, packed: resolved.packed, source: resolved.source } : result
		},

		clear() {
			const runtime = installContext?.materialRuntime
			if (typeof runtime?.setMaterialData !== "function") return { ok: false, reason: "runtime de material indisponivel" }
			return runtime.setMaterialData(SB_THIN_TRANSLUCENCY_MATERIAL_DATA_KEY, null)
		},

		current() {
			const runtime = installContext?.materialRuntime
			const data = typeof runtime?.readMaterialData === "function" ? runtime.readMaterialData(SB_THIN_TRANSLUCENCY_MATERIAL_DATA_KEY) : undefined
			return resolveMaterialThinTranslucency({ [SB_THIN_TRANSLUCENCY_MATERIAL_DATA_KEY]: data }, thinTranslucencyProfile)
		},

		hosts() {
			const runtime = installContext?.materialRuntime
			return typeof runtime?.thinTranslucencyHosts === "function" ? runtime.thinTranslucencyHosts() : []
		},

		perSlotUniform: () => SB_THIN_TRANSLUCENCY_PER_SLOT_UNIFORM_NAME,
	}
}

function publishConsole(thinTranslucencyConsole) {
	if (typeof window === "undefined" || !getSubstrateHostSurface()) return false
	getSubstrateHostSurface().thinTranslucency = thinTranslucencyConsole
	return true
}


function describeInstallation(measurement, patchResult, published) {
	const transmittance = measurement.transmittance.map((channel) => channel.toFixed(3)).join("/")
	const ratio = measurement.frontToBack.ratio === null ? "sem resposta" : `${measurement.frontToBack.ratio.toFixed(2)}x`
	const parts = [
		`${measurement.label} ${measurement.thicknessMillimeters} mm`,
		`profundidade optica ${measurement.opticalDepth.toFixed(2)}`,
		`transmitancia ${transmittance} (luminancia ${measurement.transmittanceLuminance.toFixed(3)})`,
		`frente/tras ${ratio} a 45 graus`,
		`energia ${measurement.energy.maximumChannel.toFixed(3)} contra transmitancia ${measurement.energy.transmittanceMaximum.toFixed(3)}`,
		measurement.energy.withinBudget ? "sem energia criada" : "PORTAO DE ENERGIA ABERTO",
		`assimetria do shader ${SB_THIN_SHADER_PHASE_ASYMMETRY}`,
		patchResult.accepted.map((patch) => `${patch.anchor}@${patch.order}`).join(" + "),
	]
	if (patchResult.refusal !== null) parts.push(`RECUSA: ${patchResult.refusal}`)
	parts.push(`uniform global nasce opaco; por closure via ${SB_THIN_TRANSLUCENCY_PER_SLOT_UNIFORM_NAME} (coats excluidos), autoria por material em userData.${SB_THIN_TRANSLUCENCY_MATERIAL_DATA_KEY}`)
	if (published) parts.push("__sbLab.thinTranslucency publicado")
	return `${PHASE_ID} translucidez fina instalada (${parts.join(", ")})`
}

export function installPhase(installContext = {}) {
	try {
		const { flags, telemetry } = installContext
		const profileId = SB_DEFAULT_THIN_TRANSLUCENCY_PROFILE_ID
		const measurement = measureThinTranslucencyProfile(profileId)
		const problems = findThinTranslucencyProblems()

		flags?.registerFlag?.(THIN_TRANSLUCENCY_FLAG)
		installContext?.patch?.registerUniform?.(THIN_TRANSLUCENCY_UNIFORM_NAME, {
			owner: PHASE_ID,
			value: [...SB_THIN_TRANSLUCENCY_OPAQUE_UNIFORM],
		})

		const missingAnchor = findMissingAnchor(installContext, resolveThree(installContext))
		const patchResult =
			missingAnchor === null
				? registerPatches(installContext)
				: { accepted: [], refusal: `ancora indisponivel: ${missingAnchor.anchor} (${missingAnchor.report?.reason ?? "ausente"})` }

		telemetry?.textureUnit?.(PHASE_ID, TEXTURE_UNITS_USED)
		telemetry?.closureBytes?.(PHASE_ID, CLOSURE_BYTES_USED)
		problems.forEach((problem) => telemetry?.error?.(PHASE_ID, problem))
		if (patchResult.refusal !== null) telemetry?.error?.(PHASE_ID, patchResult.refusal)

		const state = { profileId }
		const published = publishConsole(createThinTranslucencyConsole(installContext, state))

		return {
			summary: describeInstallation(measurement, patchResult, published),
			flagId: THIN_TRANSLUCENCY_FLAG.id,
			uniformName: THIN_TRANSLUCENCY_UNIFORM_NAME,
			perSlotUniformName: SB_THIN_TRANSLUCENCY_PER_SLOT_UNIFORM_NAME,
			materialDataKey: SB_THIN_TRANSLUCENCY_MATERIAL_DATA_KEY,
			patches: patchResult.accepted,
			refusal: patchResult.refusal,
			measurement,
			problems,
		}
	} catch (installError) {
		const message = installError?.message ?? String(installError)
		installContext?.telemetry?.error?.(PHASE_ID, `falha ao instalar: ${message}`)
		return { summary: `${PHASE_ID} nao instalou: ${message}` }
	}
}
