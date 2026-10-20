import {
	createAutoSlabGraph,
	describeAuthoringGraph,
	insertHorizontalMix,
	insertVerticalLayer,
	listAuthoringNodes,
	normalizeAuthoringGraph,
	removeNode,
	setNodeParameter,
	validateAuthoringGraph,
} from "./sbAuthoringGraphCore.js"
import { SB_AUTO_PRESET_ID, authoringPresetIds, buildAuthoringPreset } from "./sbAuthoringPresetCatalog.js"
import { proveTreeRoundTrip } from "./sbLegacyTreeInteropCore.js"
import { serializeMaterialTree } from "./sbTreeSerializationCore.js"

export function createAuthoringSession(options = {}) {
	const requestedRoot = options.root ?? createAutoSlabGraph()
	const initial = normalizeAuthoringGraph(requestedRoot)
	let currentRoot = initial.ok ? initial.root : normalizeAuthoringGraph(createAutoSlabGraph()).root
	let currentPresetId = options.presetId ?? (initial.ok ? null : SB_AUTO_PRESET_ID)
	let lastRefusals = initial.ok ? [] : ["arvore inicial recusada: a sessao comecou no slab em AUTO"]

	const listeners = new Set(typeof options.onChange === "function" ? [options.onChange] : [])
	const notify = () => { for (const listener of listeners) listener(currentRoot) }

	function applyEdit(edit) {
		const result = edit(currentRoot)
		if (result.ok) {
			currentRoot = result.root
			lastRefusals = []
			notify()
		} else {
			lastRefusals = result.refusals
		}
		return { ...result, refusals: [...result.refusals] }
	}

	return {
		subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
		loadTree(root) {
			const normalized = normalizeAuthoringGraph(root)
			if (!normalized.ok) return { ok: false, refusals: ["arvore invalida"] }
			const validation = validateAuthoringGraph(normalized.root)
			if (!validation.ok) return { ok: false, refusals: validation.refusals }
			currentRoot = normalized.root
			currentPresetId = null
			lastRefusals = []
			return { ok: true }
		},
		root: () => currentRoot,
		presetId: () => currentPresetId,
		presets: () => authoringPresetIds(),

		loadPreset(presetId) {
			const preset = buildAuthoringPreset(presetId)
			if (!preset.ok) {
				lastRefusals = preset.refusals
				return { ok: false, presetId, refusals: [...preset.refusals] }
			}
			currentRoot = preset.root
			currentPresetId = presetId
			lastRefusals = []
			notify()
			return { ok: true, presetId, refusals: [] }
		},

		setParameter: (request) => applyEdit((root) => setNodeParameter(root, request)),
		addLayer: (request) => applyEdit((root) => insertVerticalLayer(root, request ?? {})),
		addMix: (request) => applyEdit((root) => insertHorizontalMix(root, request ?? {})),
		removeAt: (request) => applyEdit((root) => removeNode(root, request ?? {})),

		nodes: () => listAuthoringNodes(currentRoot),
		validate: () => validateAuthoringGraph(currentRoot),
		serialize: () => serializeMaterialTree(currentRoot),
		roundTrip: () => proveTreeRoundTrip(currentRoot),
		refusals: () => [...lastRefusals],

		describe() {
			const roundTrip = proveTreeRoundTrip(currentRoot)
			return {
				presetId: currentPresetId,
				graph: describeAuthoringGraph(currentRoot),
				roundTrip: {
					ok: roundTrip.ok,
					identical: roundTrip.identical,
					byteLength: roundTrip.byteLength,
					fingerprint: roundTrip.fingerprint,
					autoParameterCount: roundTrip.autoParameterCount,
					autoPreserved: roundTrip.autoPreserved,
				},
				refusals: [...lastRefusals],
			}
		},
	}
}
