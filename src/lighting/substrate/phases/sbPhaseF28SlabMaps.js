import { getSubstrateHostSurface } from "../runtime/substrateHostSurface.js";


import { SB_RESERVED_TEXTURE_UNITS, SB_TEXTURE_UNIT_OWNERS, SB_TIER_NAMES, patchOrderFor } from "../sbMaterialContract.js"
import {
	SB_SLAB_MAP_TEXTURE_CONSUMER,
	describeSlabMapPlan,
	residentTextureUnitsForTier,
	slabMapPlanProblems,
	slabMapSlotsForTier,
} from "../sbSlabMapPlanCore.js"
import { describeMapPacking, mapPackingProblems, textureUnitBudget } from "../sbMapPackingCore.js"
import {
	createDefaultSlabMapSource,
	decodeSlabMapTexels,
	describeSlabMapCodec,
	encodeSlabMapTexels,
	measureSlabMapRoundTrip,
	slabMapCodecProblems,
} from "../sbSlabMapCodecCore.js"
import {
	SB_SLAB_MAP_GLSL,
	SB_SLAB_MAP_GLSL_ANCHOR,
	describeSlabMapGlsl,
	slabMapGlslProblems,
} from "../sbSlabMapGlsl.js"
import { describeSlabMapRuntime, slabMapRuntimeCeiling, slabMapRuntimeProblems, slabMapSamplerNames } from "../sbSlabMapRuntime.js"

export const PHASE_ID = "SB-F28"
export const FLAG_ID = "SubstrateSlabMaps"

const PATCH_ID = "sbSlabMapDecoders"
const PATCH_SUB_SLOT = 0
const PATCH_MATERIAL_PATHS = Object.freeze(["standard", "physical", "terreno", "skinned"])
const FLAG_DEFAULTS_BY_TIER = Object.freeze({ fraco: false, medio: true, forte: true })
const FLAG_DESCRIPTION = "SB-F28: decodificadores dos mapas por slab (albedo, ORM, normal+aniso, filme fino, fuzz, MFP)"
const CLOSURE_BYTES_ADDED_BY_PHASE = 0

function readThree(installContext) {
	return installContext?.bench?.THREE ?? null
}

function resolvePatchOrder(installContext) {
	const contractPatchOrderFor = installContext?.contract?.patchOrderFor ?? patchOrderFor
	return contractPatchOrderFor(PHASE_ID, PATCH_SUB_SLOT)
}

function reportError(installContext, message) {
	const telemetry = installContext?.telemetry
	if (typeof telemetry?.error === "function") telemetry.error(PHASE_ID, message)
}


export function evaluateSlabMapsGate() {
	const budget = textureUnitBudget()
	const reservedUnits = SB_RESERVED_TEXTURE_UNITS[SB_SLAB_MAP_TEXTURE_CONSUMER]
	const problems = [
		...slabMapPlanProblems(),
		...mapPackingProblems(),
		...slabMapCodecProblems(),
		...slabMapGlslProblems(),
		...slabMapRuntimeProblems(),
	]

	if (!budget.withinCeiling) {
		problems.push("o orcamento de texturas estoura o teto: " + budget.totalUnits + " de " + budget.ceiling)
	}
	if (!budget.engineLtcCounted) {
		problems.push("o orcamento nao conta as unidades que o LTC da engine ja gastou")
	}
	if (SB_TEXTURE_UNIT_OWNERS[SB_SLAB_MAP_TEXTURE_CONSUMER] !== PHASE_ID) {
		problems.push('o consumidor "' + SB_SLAB_MAP_TEXTURE_CONSUMER + '" nao pertence a esta fase no contrato')
	}

	const residencyByTier = {}
	for (const tierName of SB_TIER_NAMES) {
		const residentUnits = residentTextureUnitsForTier(tierName)
		residencyByTier[tierName] = { residentUnits, residentSlots: slabMapSlotsForTier(tierName), boundUnitsCeiling: slabMapRuntimeCeiling(tierName), samplers: slabMapSamplerNames(tierName) }
		if (slabMapRuntimeCeiling(tierName) > reservedUnits) {
			problems.push("o tier " + tierName + " amarra ate " + slabMapRuntimeCeiling(tierName) + " samplers e a reserva e de " + reservedUnits)
		}
		if (residentUnits > reservedUnits) {
			problems.push("o tier " + tierName + " quer " + residentUnits + " unidades e a reserva e de " + reservedUnits)
		}
	}

	const roundTrip = measureSlabMapRoundTrip({ tier: SB_TIER_NAMES[SB_TIER_NAMES.length - 1] })

	return {
		phaseId: PHASE_ID,
		ok: 0 === problems.length,
		problems,
		reservedUnits,
		consumedUnits: slabMapRuntimeCeiling(SB_TIER_NAMES[SB_TIER_NAMES.length - 1]),
		budget,
		residencyByTier,
		roundTrip,
	}
}


export function inspectPatchAnchor(installContext) {
	const three = readThree(installContext)
	const checkAnchor = installContext?.patch?.checkAnchor
	if (typeof checkAnchor !== "function") {
		return { anchorId: SB_SLAB_MAP_GLSL_ANCHOR, present: null, reason: "a bancada nao expos checkAnchor" }
	}
	if (!three) {
		return { anchorId: SB_SLAB_MAP_GLSL_ANCHOR, present: null, reason: "a bancada nao expos o three para conferir a ancora" }
	}
	const inspection = checkAnchor(three, SB_SLAB_MAP_GLSL_ANCHOR)
	return {
		anchorId: SB_SLAB_MAP_GLSL_ANCHOR,
		present: inspection?.present ?? null,
		reason: inspection?.reason ?? null,
	}
}

function registerSlabMapsFlag(installContext) {
	const registerFlag = installContext?.flags?.registerFlag
	if (typeof registerFlag !== "function") return { registered: false, reason: "a bancada nao expos registerFlag" }
	registerFlag({
		id: FLAG_ID,
		owner: PHASE_ID,
		description: FLAG_DESCRIPTION,
		defaultsByTier: FLAG_DEFAULTS_BY_TIER,
	})
	return { registered: true, reason: null }
}

function registerSlabMapDecoderPatch(installContext, anchorInspection) {
	const registerPatch = installContext?.patch?.registerPatch
	if (typeof registerPatch !== "function") return { accepted: false, reason: "a bancada nao expos registerPatch" }
	if (false === anchorInspection.present) {
		return {
			accepted: false,
			reason: 'a ancora "' + anchorInspection.anchorId + '" nao existe neste three: patch inteiro recusado',
		}
	}

	const order = resolvePatchOrder(installContext)
	if (typeof order !== "number") {
		return { accepted: false, reason: "o contrato nao deu ordem de patch para " + PHASE_ID }
	}

	const registration = registerPatch({
		id: PATCH_ID,
		owner: PHASE_ID,
		anchor: anchorInspection.anchorId,
		order,
		flagId: FLAG_ID,
		declarations: SB_SLAB_MAP_GLSL.declarations,
		code: SB_SLAB_MAP_GLSL.code,
		materialPaths: PATCH_MATERIAL_PATHS,
	})

	return {
		accepted: true === registration?.accepted,
		reason: registration?.reason ?? null,
		order,
		id: registration?.id ?? PATCH_ID,
	}
}


function publishConsoleSurface(gate) {
	const labSurface = getSubstrateHostSurface()
	if (!labSurface || typeof labSurface !== "object") return false
	labSurface.slabMaps = {
		describe: () => ({
			plan: describeSlabMapPlan(),
			packing: describeMapPacking(),
			codec: describeSlabMapCodec(),
			glsl: describeSlabMapGlsl(),
			runtime: describeSlabMapRuntime(),
		}),
		budget: () => textureUnitBudget(),
		encode: (tierName, source) => encodeSlabMapTexels(tierName ?? "forte", source ?? createDefaultSlabMapSource()),
		resolve: (options) => decodeSlabMapTexels(options ?? {}),
		roundTrip: (tierName) => measureSlabMapRoundTrip({ tier: tierName ?? "forte" }),
		gate: () => evaluateSlabMapsGate(),
		lastGate: gate,
	}
	return true
}

export function installPhase(installContext = {}) {
	const gate = evaluateSlabMapsGate()
	for (const problem of gate.problems) reportError(installContext, problem)

	let flagState = { registered: false, reason: "instalacao nao chegou a registrar a flag" }
	let anchorInspection = { anchorId: SB_SLAB_MAP_GLSL_ANCHOR, present: null, reason: null }
	let patchState = { accepted: false, reason: "instalacao nao chegou a registrar o patch" }
	let consolePublished = false

	try {
		flagState = registerSlabMapsFlag(installContext)
		anchorInspection = inspectPatchAnchor(installContext)
		patchState = registerSlabMapDecoderPatch(installContext, anchorInspection)
		consolePublished = publishConsoleSurface(gate)
	} catch (error) {
		patchState = { accepted: false, reason: "excecao na instalacao: " + (error?.message ?? String(error)) }
	}

	if (!patchState.accepted && patchState.reason) reportError(installContext, patchState.reason)
	if (!flagState.registered && flagState.reason) reportError(installContext, flagState.reason)

	const telemetry = installContext?.telemetry
	if (typeof telemetry?.closureBytes === "function") telemetry.closureBytes(PHASE_ID, CLOSURE_BYTES_ADDED_BY_PHASE)
	if (typeof telemetry?.textureUnit === "function") telemetry.textureUnit(PHASE_ID, gate.consumedUnits)

	const summary =
		PHASE_ID +
		(gate.ok ? " ok" : " com " + gate.problems.length + " problema(s)") +
		": " +
		gate.residencyByTier.forte.residentUnits +
		" mapas residentes no forte de " +
		gate.reservedUnits +
		" reservados, orcamento " +
		gate.budget.totalUnits +
		"/" +
		gate.budget.ceiling +
		" com as " +
		gate.budget.engineOwnedUnits +
		" do LTC contadas, pior canal na ida e volta " +
		gate.roundTrip.directWorstNormalizedError.toExponential(3) +
		" contra o portao " +
		gate.roundTrip.directGate.toExponential(3) +
		", " +
		gate.consumedUnits +
		" unidades amarraveis por material no forte, patch " +
		(patchState.accepted ? "aceito" : "recusado: " + patchState.reason)

	return {
		phaseId: PHASE_ID,
		flagId: FLAG_ID,
		flagRegistered: flagState.registered,
		anchor: anchorInspection,
		patch: patchState,
		closureBytes: CLOSURE_BYTES_ADDED_BY_PHASE,
		textureUnits: gate.consumedUnits,
		consolePublished,
		gate,
		summary,
	}
}
