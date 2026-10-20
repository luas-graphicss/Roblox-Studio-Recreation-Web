import { findEngineInventoryProblems } from "./sbEnginePublicApiInventory.js"
import { describePublicApiBlock, findPublicApiCollisions, findPublicApiProblems } from "./sbPublicApiCore.js"
import { findAuthoringRangeProblems } from "./sbAuthoringParameterRanges.js"
import { createAutoSlabGraph } from "./sbAuthoringGraphCore.js"
import { describeAuthoringPresets, findAuthoringPresetProblems } from "./sbAuthoringPresetCatalog.js"
import { describeLegacyInterop, findLegacyInteropProblems, proveTreeRoundTrip } from "./sbLegacyTreeInteropCore.js"

export const SB_PUBLIC_API_GATE = Object.freeze({
	maximumEngineApiCollisions: 0,
	topologyRoundTripMustBeLossless: true,
	autoMustSurviveRoundTrip: true,
})


export function evaluatePublicApiGate(request = {}) {
	const problems = []
	for (const problem of findEngineInventoryProblems()) problems.push("retrato da API da engine: " + problem)
	for (const problem of findPublicApiProblems()) problems.push("bloco publico: " + problem)
	for (const problem of findAuthoringRangeProblems()) problems.push("faixa de autoria: " + problem)
	for (const problem of findAuthoringPresetProblems(request)) problems.push("preset de autoria: " + problem)
	for (const problem of findLegacyInteropProblems(request)) problems.push("interop do legado: " + problem)

	const collisions = findPublicApiCollisions()
	if (collisions.length > SB_PUBLIC_API_GATE.maximumEngineApiCollisions) {
		problems.push("colisoes com a API da engine: " + collisions.length)
	}

	const autoRoundTrip = proveTreeRoundTrip(createAutoSlabGraph())
	if (autoRoundTrip.autoParameterCount === 0) {
		problems.push("a arvore de prova nao tem parametro em AUTO: o portao de AUTO passaria vazio")
	}
	if (!autoRoundTrip.autoPreserved) problems.push("AUTO nao sobreviveu a ida-e-volta do texto canonico")
	if (!autoRoundTrip.identical) {
		problems.push("o texto da arvore em AUTO divergiu na volta: " + (autoRoundTrip.reason ?? "sem motivo declarado"))
	}

	const interop = describeLegacyInterop(request)
	if (interop.losslessCount !== interop.materialCount) {
		problems.push(
			"round-trip sem perda em " + interop.losslessCount + " de " + interop.materialCount + " materiais do motor",
		)
	}

	return {
		ok: problems.length === 0,
		problems,
		gate: SB_PUBLIC_API_GATE,
		collisionCount: collisions.length,
		collisions,
		autoRoundTrip: {
			ok: autoRoundTrip.ok,
			identical: autoRoundTrip.identical,
			autoParameterCount: autoRoundTrip.autoParameterCount,
			autoPreserved: autoRoundTrip.autoPreserved,
			byteLength: autoRoundTrip.byteLength,
			fingerprint: autoRoundTrip.fingerprint,
		},
		interop,
		presets: describeAuthoringPresets(request),
		publicApi: describePublicApiBlock(),
	}
}
