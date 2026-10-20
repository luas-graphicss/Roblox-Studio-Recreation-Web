import { sbQa } from "./labTelemetry.js"
import { isFlagActive } from "./labFlags.js"
import { assembleShaderPatches } from "./labShaderPatchAssembler.js"
import { retainMaterialUniforms } from "./labShaderUniformCache.js"
import { injectRuntimeClosureShader } from "../../../sbRuntimeClosureShader.js"
import { tierDefaults } from "../../../sbMaterialContract.js"

const BEFORE_COMPILE_HOOK = "onBeforeCompile"
const CACHE_KEY_HOOK = "customProgramCacheKey"
const INCLUDE_PREFIX = "#include " + "\u003c"
const ALL_MATERIAL_PATHS = "*"


export const SB_ANCHORS = {
	common: { chunk: "common", stage: "fragment", signature: /#define PI/ },
	bsdfs: { chunk: "common", stage: "fragment", signature: /#define PI/ },
	lightsPhysicalPars: { chunk: "lights_physical_pars_fragment", stage: "fragment", signature: /struct PhysicalMaterial/ },
	lightsFragmentBegin: { chunk: "lights_fragment_begin", stage: "fragment", signature: /RE_Direct/ },
	lightsFragmentMaps: { chunk: "lights_fragment_maps", stage: "fragment", signature: /irradiance/ },
	lightsFragmentEnd: { chunk: "lights_fragment_end", stage: "fragment", signature: /RE_IndirectDiffuse|RE_IndirectSpecular/ },
	mapFragment: { chunk: "map_fragment", stage: "fragment", signature: /diffuseColor/ },
	normalFragmentMaps: { chunk: "normal_fragment_maps", stage: "fragment", signature: /normal/ },
	roughnessMapFragment: { chunk: "roughnessmap_fragment", stage: "fragment", signature: /roughnessFactor/ },
	metalnessMapFragment: { chunk: "metalnessmap_fragment", stage: "fragment", signature: /metalnessFactor/ },
	transmissionFragment: { chunk: "transmission_fragment", stage: "fragment", signature: /transmission/ },
	envmapPhysicalPars: { chunk: "envmap_physical_pars_fragment", stage: "fragment", signature: /getIBLRadiance/ },
	shadowmapPars: { chunk: "shadowmap_pars_fragment", stage: "fragment", signature: /getShadow/ },
	opaqueFragment: { chunk: "opaque_fragment", stage: "fragment", signature: /outgoingLight/ },
	beginVertex: { chunk: "begin_vertex", stage: "vertex", signature: /transformed/ },
	defaultNormalVertex: { chunk: "defaultnormal_vertex", stage: "vertex", signature: /transformedNormal/ },
}

const registeredPatches = new Map()
const reservedAnchorSlots = new Map()
const registeredUniforms = new Map()
const trackedMaterials = new Set()

let patchGeneration = 0
let readContext = () => ({ tier: "medio", materialPath: "standard" })

function includeLineFor(chunkName) {
	return INCLUDE_PREFIX + chunkName + ">"
}

export function setPatchContextProvider(provider) {
	if (typeof provider === "function") readContext = provider
}

export function threeRevision(THREE) {
	return THREE?.REVISION ?? "unknown"
}


export function checkAnchor(THREE, anchorId) {
	const anchor = SB_ANCHORS[anchorId]
	if (!anchor) return { anchorId, present: false, reason: "ancora desconhecida" }
	const chunkSource = THREE?.ShaderChunk?.[anchor.chunk]
	if (typeof chunkSource !== "string") {
		return { anchorId, present: false, reason: "chunk ausente: " + anchor.chunk }
	}
	const present = anchor.signature.test(chunkSource)
	return { anchorId, chunk: anchor.chunk, stage: anchor.stage, present, reason: present ? null : "assinatura nao encontrada" }
}

export function checkAllAnchors(THREE) {
	const report = {}
	for (const anchorId of Object.keys(SB_ANCHORS)) {
		const result = checkAnchor(THREE, anchorId)
		report[anchorId] = result
		sbQa.anchor(anchorId, result)
		if (!result.present) sbQa.error("labPatch", "ancora indisponivel: " + anchorId + " (" + result.reason + ")")
	}
	return report
}

export function registerUniform(uniformName, definition) {
	if (registeredUniforms.has(uniformName)) return registeredUniforms.get(uniformName)
	const holder = { value: definition?.value ?? null }
	registeredUniforms.set(uniformName, { owner: definition?.owner ?? "base", holder, get value() { return holder.value }, set value(value) { holder.value = value } })
	sbQa.uniform(uniformName, definition?.owner ?? "base")
	return registeredUniforms.get(uniformName)
}

export function uniformHolder(uniformName) {
	return registeredUniforms.get(uniformName)?.holder ?? null
}

export function setUniform(uniformName, value) {
	const entry = registeredUniforms.get(uniformName)
	if (!entry) {
		sbQa.error("labPatch", "uniform desconhecido: " + uniformName)
		return false
	}
	entry.holder.value = value
	return true
}

export function listUniforms() {
	return Array.from(registeredUniforms.entries()).map(([uniformName, entry]) => ({
		name: uniformName,
		owner: entry.owner,
		value: entry.holder.value,
	}))
}


export function registerPatch(definition) {
	const { id, owner, anchor, order, flagId } = definition
	if (!id || !owner || !anchor || typeof order !== "number") {
		sbQa.error("labPatch", "patch invalido: id, owner, anchor e order sao obrigatorios")
		return { accepted: false, reason: "definicao incompleta" }
	}
	if (!SB_ANCHORS[anchor]) {
		sbQa.error("labPatch", "patch " + id + " usa ancora desconhecida: " + anchor)
		return { accepted: false, reason: "ancora desconhecida" }
	}
	const slotKey = anchor + ":" + order
	const slotOwner = reservedAnchorSlots.get(slotKey)
	if (slotOwner && slotOwner !== id) {
		sbQa.error("labPatch", "colisao de ordem em " + slotKey + ": " + slotOwner + " x " + id)
		return { accepted: false, reason: "ordem ja reservada por " + slotOwner }
	}
	reservedAnchorSlots.set(slotKey, id)
	registeredPatches.set(id, {
		id,
		owner,
		anchor,
		order,
		flagId: flagId ?? null,
		declarations: definition.declarations ?? "",
		code: definition.code ?? "",
		materialPaths: definition.materialPaths ?? [ALL_MATERIAL_PATHS],
		uniforms: Array.isArray(definition.uniforms) ? Object.fromEntries(definition.uniforms.map((name) => [name, name])) : definition.uniforms ?? {},
	})
	patchGeneration += 1
	return { accepted: true, id }
}

export function removePatch(patchId) {
	const patch = registeredPatches.get(patchId)
	if (!patch) return false
	registeredPatches.delete(patchId)
	reservedAnchorSlots.delete(patch.anchor + ":" + patch.order)
	patchGeneration += 1
	return true
}

export function listPatches() {
	return Array.from(registeredPatches.values())
		.slice()
		.sort((left, right) => left.anchor.localeCompare(right.anchor) || left.order - right.order)
		.map((patch) => ({ id: patch.id, owner: patch.owner, anchor: patch.anchor, order: patch.order, flagId: patch.flagId }))
}

function targetsMaterialPath(patch, materialPath) {
	return patch.materialPaths.includes(ALL_MATERIAL_PATHS) || patch.materialPaths.includes(materialPath)
		|| (["terreno", "skinned"].includes(materialPath) && patch.materialPaths.includes("standard"))
}


export function activePatchesFor(materialPath, tierName) {
	if (!isFlagActive("SubstrateEnabled", tierName)) return []
	return Array.from(registeredPatches.values())
		.filter((patch) => targetsMaterialPath(patch, materialPath))
		.filter((patch) => (patch.flagId ? isFlagActive(patch.flagId, tierName) : true))
		.filter((patch) => patch.owner !== "SB-F35" || readContext().debugMode !== "off")
		.sort((left, right) => left.order - right.order)
}

function patchesForMaterial(material, materialPath, tierName) {
	if (material.userData.sbRuntime?.enabled === false) return []
	return activePatchesFor(materialPath, tierName).filter(patch =>
		patch.owner !== "SB-F26" || material.userData.sbBsdfKind === "singleLayerWater")
}

function applyPatchToStage(source, patch) {
	const anchor = SB_ANCHORS[patch.anchor]
	const includeLine = includeLineFor(anchor.chunk)
	if (!source.includes(includeLine)) {
		return { source, applied: false, reason: "linha de include ausente: " + anchor.chunk }
	}
	const replacement = [patch.declarations, includeLine, patch.code].filter(Boolean).join("\n")
	return { source: source.replace(includeLine, replacement), applied: true, reason: null }
}

export function patchGenerationCount() {
	return patchGeneration
}








export function installOnMaterial(material, options) {
	if (trackedMaterials.has(material)) return material
	const materialPath = options?.materialPath ?? "standard"
	material.addEventListener?.("dispose", () => forgetMaterial(material))
	material.userData.sbMaterialPath = materialPath
	trackedMaterials.add(material)

	const previousHook = material[BEFORE_COMPILE_HOOK]
	const previousCacheKey = material[CACHE_KEY_HOOK]

	material[BEFORE_COMPILE_HOOK] = function patchMaterialShader(shader, renderer) {
		if (typeof previousHook === "function") previousHook.call(this, shader, renderer)
		const context = readContext()
		const runtimeEnabled = material.userData.sbRuntime?.enabled === true
		if (runtimeEnabled) {

			for (const stage of ["vertexShader", "fragmentShader"]) shader[stage] = "#ifndef USE_UV\n#define USE_UV\n#endif\n" + shader[stage]
		}
		const candidates = patchesForMaterial(material, materialPath, context.tier)
		const activePatches = candidates.map(patch =>
			runtimeEnabled && (["SB-F9", "SB-F31", "SB-F18", "SB-F21", "SB-F23"].includes(patch.owner) || patch.owner === "SB-F19" && patch.anchor === "roughnessMapFragment") ? { ...patch, code: "" } : patch)
		const appliedIds = []

		for (const [stage, stageKey] of [["vertex", "vertexShader"], ["fragment", "fragmentShader"]]) {
			const stagePatches = activePatches.filter(patch => SB_ANCHORS[patch.anchor].stage === stage)
			const result = assembleShaderPatches(shader[stageKey], stagePatches, SB_ANCHORS)
			shader[stageKey] = result.source
			appliedIds.push(...result.applied)
			for (const refusal of result.refused) sbQa.refusedPatch({ ...refusal, materialPath })
		}
		if (runtimeEnabled) {
			const result = injectRuntimeClosureShader(shader.fragmentShader, {
				tier: context.tier, limit: tierDefaults(context.tier).closuresPerPixel,
				layering: activePatches.some(patch => patch.owner === "SB-F18"),
				slabDiffuse: activePatches.some(patch => patch.owner === "SB-F17"),
				roughRefraction: activePatches.some(patch => patch.owner === "SB-F19"),
				eye: activePatches.some(patch => patch.owner === "SB-F25") && material.defines?.SB_EYE_MATERIAL === "1",
				slabMaps: material.userData.sbRuntime?.slabMapSlots ?? [],
			})
			shader.fragmentShader = result.source
			if (!result.installed) sbQa.refusedPatch({ id: "runtime-closure-lighting", owner: "SB-F31", materialPath, reason: result.reason })
		}

		for (const name of new Set((shader.vertexShader + shader.fragmentShader).match(/\buSb[A-Za-z0-9_]+\b/g) ?? [])) {
			const holder = material.userData.sbUniforms?.[name] ?? uniformHolder(name.endsWith("Input") ? name.slice(0, -5) : name)
			if (holder) shader.uniforms[name] = holder
		}
		shader.uniforms = retainMaterialUniforms(material, shader.uniforms)
		material.userData.sbShader = shader

		sbQa.appliedPatches(appliedIds)
	}

	material[CACHE_KEY_HOOK] = function programCacheKey() {
		const context = readContext()
		const activeIds = patchesForMaterial(material, materialPath, context.tier).map((patch) => patch.id)
		return ["sb", materialPath, context.tier, patchGeneration, material.userData.sbRuntime?.enabled ? "closures-v1" : "legacy", activeIds.join("+"), (material.userData.sbRuntime?.slabMapSlots ?? []).join("+"), typeof previousCacheKey === "function" ? previousCacheKey.call(this) : ""].join("|")
	}

	material.needsUpdate = true
	return material
}


export function healMaterials() {

	let healed = 0
	for (const material of trackedMaterials) {
		material.needsUpdate = true
		healed += 1
	}
	return { healed, generation: patchGeneration }
}

export function forgetMaterial(material) {
	trackedMaterials.delete(material)
}

export function trackedMaterialCount() {
	return trackedMaterials.size
}
