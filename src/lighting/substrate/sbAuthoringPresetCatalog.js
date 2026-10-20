import { createBsdfNode, createReferenceLayeredTree, createReferenceSlabTree, createSlabNode } from "./sbMaterialTreeCore.js"
import { SB_SPECIALIZED_CLOSURE_KINDS, sanitizeSpecializedParameters } from "./sbSpecializedClosureCore.js"
import { sanitizeSlabParameters } from "./authoring/sbSlabParameterValues.js"
import { legacyMaterialNames } from "./sbLegacyMaterialTable.js"
import { convertLegacyMaterialToTopology } from "./authoring/sbLegacyMaterialConversion.js"
import { legacyTopologyToMaterialTree, proveTreeRoundTrip } from "./sbLegacyTreeInteropCore.js"
import { createAutoSlabGraph, describeRefusal, normalizeAuthoringGraph, validateAuthoringGraph } from "./sbAuthoringGraphCore.js"

export const SB_AUTHORING_PRESET_KINDS = Object.freeze({
	auto: "auto",
	reference: "reference",
	legacy: "legacy",
	specialized: "specialized",
	subsurface: "subsurface",
})

export const SB_AUTO_PRESET_ID = "auto:slab"
export const SB_REFERENCE_SLAB_PRESET_ID = "reference:slab"
export const SB_REFERENCE_LAYERED_PRESET_ID = "reference:layered"
export const SB_LEGACY_PRESET_PREFIX = "legacy:"
export const SB_SPECIALIZED_PRESET_PREFIX = "bsdf:"
export const SB_SUBSURFACE_PRESET_PREFIX = "subsurface:"

const SUBSURFACE_PRESETS = Object.freeze({
	skin: Object.freeze({ albedo: [0.82, 0.6, 0.5], f0: [0.028, 0.028, 0.028], roughness: 0.45, subsurfaceMeanFreePath: [8, 3.5, 1.6] }),
	wax: Object.freeze({ albedo: [0.93, 0.88, 0.72], f0: [0.04, 0.04, 0.04], roughness: 0.3, subsurfaceMeanFreePath: [18, 14, 9] }),
	jade: Object.freeze({ albedo: [0.32, 0.62, 0.42], f0: [0.05, 0.05, 0.05], roughness: 0.18, subsurfaceMeanFreePath: [6, 12, 7] }),
})

export function specializedPresetIdFor(kind) {
	return SB_SPECIALIZED_PRESET_PREFIX + kind
}

export function subsurfacePresetIdFor(name) {
	return SB_SUBSURFACE_PRESET_PREFIX + name
}

export function legacyPresetIdFor(materialName) {
	return SB_LEGACY_PRESET_PREFIX + materialName
}

export function authoringPresetIds() {
	return [
		SB_AUTO_PRESET_ID,
		SB_REFERENCE_SLAB_PRESET_ID,
		SB_REFERENCE_LAYERED_PRESET_ID,
		...Object.keys(SUBSURFACE_PRESETS).map((name) => subsurfacePresetIdFor(name)),
		...SB_SPECIALIZED_CLOSURE_KINDS.map((kind) => specializedPresetIdFor(kind)),
		...legacyMaterialNames().map((materialName) => legacyPresetIdFor(materialName)),
	]
}

export function authoringPresetCount() {
	return authoringPresetIds().length
}

function refusePreset(presetId, reason) {
	return { ok: false, presetId, kind: null, root: null, refusals: [reason] }
}

function acceptPreset(presetId, kind, rawRootNode) {
	const normalization = normalizeAuthoringGraph(rawRootNode)
	if (!normalization.ok) return refusePreset(presetId, "o preset nao produziu raiz aproveitavel")
	const validation = validateAuthoringGraph(normalization.root)
	if (!validation.ok) {
		return { ok: false, presetId, kind, root: null, refusals: validation.refusals.map(describeRefusal) }
	}
	return { ok: true, presetId, kind, root: normalization.root, refusals: [] }
}

function buildLegacyPreset(presetId, request) {
	const materialName = presetId.slice(SB_LEGACY_PRESET_PREFIX.length)
	if (!legacyMaterialNames().includes(materialName)) {
		return refusePreset(presetId, "material fora da tabela do motor legado: " + materialName)
	}
	const topology = convertLegacyMaterialToTopology({ ...request, materialName })
	return acceptPreset(presetId, SB_AUTHORING_PRESET_KINDS.legacy, legacyTopologyToMaterialTree(topology))
}


export function buildAuthoringPreset(presetId, request = {}) {
	if (typeof presetId !== "string" || presetId.length === 0) {
		return refusePreset(presetId, "preset sem id")
	}
	if (presetId === SB_AUTO_PRESET_ID) {
		return acceptPreset(presetId, SB_AUTHORING_PRESET_KINDS.auto, createAutoSlabGraph())
	}
	if (presetId === SB_REFERENCE_SLAB_PRESET_ID) {
		return acceptPreset(presetId, SB_AUTHORING_PRESET_KINDS.reference, createReferenceSlabTree())
	}
	if (presetId === SB_REFERENCE_LAYERED_PRESET_ID) {
		return acceptPreset(presetId, SB_AUTHORING_PRESET_KINDS.reference, createReferenceLayeredTree())
	}
	if (presetId.startsWith(SB_LEGACY_PRESET_PREFIX)) return buildLegacyPreset(presetId, request)
	if (presetId.startsWith(SB_SPECIALIZED_PRESET_PREFIX)) {
		const kind = presetId.slice(SB_SPECIALIZED_PRESET_PREFIX.length)
		if (!SB_SPECIALIZED_CLOSURE_KINDS.includes(kind)) return refusePreset(presetId, "BSDF especializado desconhecido: " + kind)
		return acceptPreset(presetId, SB_AUTHORING_PRESET_KINDS.specialized, createBsdfNode({ bsdf: kind, parameters: sanitizeSpecializedParameters(kind, {}), label: kind }))
	}
	if (presetId.startsWith(SB_SUBSURFACE_PRESET_PREFIX)) {
		const name = presetId.slice(SB_SUBSURFACE_PRESET_PREFIX.length)
		const preset = SUBSURFACE_PRESETS[name]
		if (!preset) return refusePreset(presetId, "preset de subsuperficie desconhecido: " + name)
		return acceptPreset(presetId, SB_AUTHORING_PRESET_KINDS.subsurface, createSlabNode(sanitizeSlabParameters({ ...preset }), { label: name }))
	}
	return refusePreset(presetId, "preset desconhecido: " + presetId)
}


export function findAuthoringPresetProblems(request = {}) {
	const problems = []
	for (const presetId of authoringPresetIds()) {
		const preset = buildAuthoringPreset(presetId, request)
		if (!preset.ok) {
			problems.push(presetId + ": " + preset.refusals.join(" | "))
			continue
		}
		const roundTrip = proveTreeRoundTrip(preset.root)
		if (!roundTrip.ok) problems.push(presetId + ": " + (roundTrip.reason ?? "ida-e-volta reprovada"))
	}
	return problems
}

export function describeAuthoringPresets(request = {}) {
	const presetIds = authoringPresetIds()
	return {
		presetCount: presetIds.length,
		legacyPresetCount: legacyMaterialNames().length,
		presetIds,
		problems: findAuthoringPresetProblems(request),
	}
}
