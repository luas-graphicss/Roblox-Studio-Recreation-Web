import { getSubstrateHostSurface } from "../runtime/substrateHostSurface.js";


import { patchOrderFor } from "../sbMaterialContract.js"
import {
	SB_DECAL_BUFFER_RESERVED_TEXTURE_UNITS,
	SB_DECAL_BUFFER_TEXTURE_UNIT_CONSUMER,
	SB_MAX_DECALS_PER_PIXEL,
	decalRecordBytes,
	describeDecalBufferSummary,
	findDecalBufferProblems,
	orderDecals,
	writeDecalBuffer,
} from "../sbDecalBufferCore.js"
import {
	describeDecalBlend,
	findDecalBlendProblems,
	resolveDecalsIntoClosureRecord,
	resolveDecalsIntoParameters,
} from "../sbDecalBlendCore.js"
import {
	SB_DECAL_GLSL,
	SB_DECAL_GLSL_NORMAL_ANCHOR,
	SB_DECAL_GLSL_ROUGHNESS_ANCHOR,
	SB_DECAL_GLSL_UNIFORM_NAME,
	decalGlslProblems,
	describeDecalGlsl,
} from "../sbDecalGlsl.js"

export const PHASE_ID = "SB-F29"
export const FLAG_ID = "SubstrateDecalBuffer"

const ROUGHNESS_SUB_SLOT = 0
const NORMAL_SUB_SLOT = 1
const MATERIAL_PATHS = Object.freeze(["standard", "physical"])
const IDLE_DECAL_UNIFORM_VALUE = Object.freeze([0, 0, 0, 0])
const CLOSURE_BYTES_ADDED_BY_PHASE = 0
const TEXTURE_UNITS_CONSUMED_BY_PHASE = 0


export function evaluateDecalBufferGate() {
	const problems = [...findDecalBufferProblems(), ...findDecalBlendProblems(), ...decalGlslProblems()]
	return {
		phaseId: PHASE_ID,
		ok: 0 === problems.length,
		problems,
		gates: {
			buffer: describeDecalBufferSummary(),
			blend: describeDecalBlend(),
			glsl: describeDecalGlsl(),
		},
	}
}

function resolvePatchOrderFrom(installContext) {
	const contractPatchOrder = installContext?.contract?.patchOrderFor
	return typeof contractPatchOrder === "function" ? contractPatchOrder : patchOrderFor
}


function anchorIsPresent(patch, anchor) {
	if (typeof patch?.checkAnchor !== "function") return false
	return true === patch.checkAnchor(anchor)?.present
}

function registerDecalUniform(patch) {
	if (typeof patch?.registerUniform !== "function") return false
	const holder = patch.registerUniform(SB_DECAL_GLSL_UNIFORM_NAME, {
		owner: PHASE_ID,
		value: [...IDLE_DECAL_UNIFORM_VALUE],
	})
	return holder?.owner === undefined || holder.owner === PHASE_ID
}


function registerDecalPatches(installContext) {
	const patch = installContext?.patch
	const accepted = []
	const refused = []

	if (typeof patch?.registerPatch !== "function") {
		refused.push({ anchor: SB_DECAL_GLSL_ROUGHNESS_ANCHOR, reason: "bancada sem superficie de patch" })
		return { accepted, refused, uniformRegistered: false }
	}

	const resolvePatchOrder = resolvePatchOrderFrom(installContext)
	if (!anchorIsPresent(patch, SB_DECAL_GLSL_ROUGHNESS_ANCHOR)) {
		refused.push({
			anchor: SB_DECAL_GLSL_ROUGHNESS_ANCHOR,
			reason: "ancora de rugosidade ausente no shader desta engine",
		})
		return { accepted, refused, uniformRegistered: false }
	}

	const uniformRegistered = registerDecalUniform(patch)
	const roughnessRegistration = patch.registerPatch({
		id: "sbDecalRoughness",
		owner: PHASE_ID,
		anchor: SB_DECAL_GLSL_ROUGHNESS_ANCHOR,
		order: resolvePatchOrder(PHASE_ID, ROUGHNESS_SUB_SLOT),
		flagId: FLAG_ID,
		materialPaths: MATERIAL_PATHS,
		declarations: SB_DECAL_GLSL.declarations,
		code: SB_DECAL_GLSL.roughnessCode,
	})
	if (true !== roughnessRegistration?.accepted) {
		refused.push({
			anchor: SB_DECAL_GLSL_ROUGHNESS_ANCHOR,
			reason: roughnessRegistration?.reason ?? "recusa sem motivo declarado",
		})
		return { accepted, refused, uniformRegistered }
	}
	accepted.push(SB_DECAL_GLSL_ROUGHNESS_ANCHOR)

	if (!anchorIsPresent(patch, SB_DECAL_GLSL_NORMAL_ANCHOR)) {
		refused.push({ anchor: SB_DECAL_GLSL_NORMAL_ANCHOR, reason: "ancora de normal ausente no shader desta engine" })
		return { accepted, refused, uniformRegistered }
	}

	const normalRegistration = patch.registerPatch({
		id: "sbDecalNormal",
		owner: PHASE_ID,
		anchor: SB_DECAL_GLSL_NORMAL_ANCHOR,
		order: resolvePatchOrder(PHASE_ID, NORMAL_SUB_SLOT),
		flagId: FLAG_ID,
		materialPaths: MATERIAL_PATHS,
		code: SB_DECAL_GLSL.normalCode,
	})
	if (true !== normalRegistration?.accepted) {
		refused.push({
			anchor: SB_DECAL_GLSL_NORMAL_ANCHOR,
			reason: normalRegistration?.reason ?? "recusa sem motivo declarado",
		})
		return { accepted, refused, uniformRegistered }
	}
	accepted.push(SB_DECAL_GLSL_NORMAL_ANCHOR)

	return { accepted, refused, uniformRegistered }
}


export function createConsoleSurface() {
	return {
		phaseId: PHASE_ID,
		flagId: FLAG_ID,
		gate: () => evaluateDecalBufferGate(),
		buffer: () => describeDecalBufferSummary(),
		blend: () => describeDecalBlend(),
		glsl: () => describeDecalGlsl(),
		order: (decals) => orderDecals(decals),
		writeBuffer: (decals) => writeDecalBuffer(decals),
		resolveParameters: (parameters, decals) => resolveDecalsIntoParameters(parameters, decals),
		resolveRecord: (record, decals) => resolveDecalsIntoClosureRecord(record, decals),
	}
}

function publishConsoleSurface() {
	const lab = typeof globalThis === "undefined" ? null : getSubstrateHostSurface()
	if (!lab) return false
	lab.decalBuffer = createConsoleSurface()
	return true
}


export function installPhase(installContext = {}) {
	const { flags, telemetry } = installContext
	try {
		flags?.registerFlag({
			id: FLAG_ID,
			owner: PHASE_ID,
			description: "Decais escrevendo rugosidade e normal no buffer de material",
			defaultsByTier: { fraco: false, medio: true, forte: true },
		})

		telemetry?.closureBytes(PHASE_ID, CLOSURE_BYTES_ADDED_BY_PHASE)
		telemetry?.textureUnit(PHASE_ID, TEXTURE_UNITS_CONSUMED_BY_PHASE)

		const gate = evaluateDecalBufferGate()
		if (!gate.ok) {
			for (const problem of gate.problems) telemetry?.error(PHASE_ID, problem)
		}

		const patches = registerDecalPatches(installContext)
		for (const refusal of patches.refused) {
			telemetry?.error(PHASE_ID, `patch em ${refusal.anchor} recusado: ${refusal.reason}`)
		}

		const consolePublished = publishConsoleSurface()
		const acceptedAnchors = 0 === patches.accepted.length ? "nenhuma" : patches.accepted.join(", ")

		return {
			phaseId: PHASE_ID,
			ok: gate.ok,
			flagId: FLAG_ID,
			closureBytes: CLOSURE_BYTES_ADDED_BY_PHASE,
			textureUnits: TEXTURE_UNITS_CONSUMED_BY_PHASE,
			consolePublished,
			gate,
			patches,
			summary: `SB-F29 ok: ${decalRecordBytes()} B por decal, teto de ${SB_MAX_DECALS_PER_PIXEL} decais por pixel, ancoras costuradas: ${acceptedAnchors}, unidade ${SB_DECAL_BUFFER_TEXTURE_UNIT_CONSUMER} reservada (${SB_DECAL_BUFFER_RESERVED_TEXTURE_UNITS}) e ainda nao consumida`,
		}
	} catch (error) {
		const message = error?.message ?? String(error)
		telemetry?.error(PHASE_ID, `falha ao instalar: ${message}`)
		return {
			phaseId: PHASE_ID,
			ok: false,
			flagId: FLAG_ID,
			closureBytes: CLOSURE_BYTES_ADDED_BY_PHASE,
			textureUnits: TEXTURE_UNITS_CONSUMED_BY_PHASE,
			consolePublished: false,
			gate: null,
			patches: { accepted: [], refused: [], uniformRegistered: false },
			summary: `SB-F29 nao instalou: ${message}`,
		}
	}
}
