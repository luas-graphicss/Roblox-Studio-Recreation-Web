import { getSubstrateHostSurface } from "../runtime/substrateHostSurface.js";


import { createAuthoringSession } from "../sbAuthoringSession.js"
import { createAuthoringRuntimeBridge } from "../sbAuthoringRuntimeBridge.js"
import { describeLegacyInterop } from "../sbLegacyTreeInteropCore.js"
import { evaluatePublicApiGate } from "../sbPublicApiCertificationCore.js"
import {
	SB_AUTO_VALUE,
	describeAutoValues,
	describePublicApiBlock,
	findPublicApiProperty,
	resolvePropertyValue,
	validatePropertyValue,
} from "../sbPublicApiCore.js"
import { createMaterialGraphPanel } from "../support/src/ui/sbMaterialGraphPanel.js"

export const PHASE_ID = "SB-F30"
export const SB_PUBLIC_API_TEXTURE_UNITS = 0
export const SB_PUBLIC_API_CLOSURE_BYTES = 0
export const AUTHORING_PANEL_CONTAINER_ID = "sb-hud"

function reportTelemetry(installContext) {
	const telemetry = installContext?.telemetry
	if (typeof telemetry?.textureUnit === "function") {
		telemetry.textureUnit(PHASE_ID, SB_PUBLIC_API_TEXTURE_UNITS)
	}
	if (typeof telemetry?.closureBytes === "function") {
		telemetry.closureBytes(PHASE_ID, SB_PUBLIC_API_CLOSURE_BYTES)
	}
}

function publishConsoleApi(consoleApi) {
	if (typeof window === "undefined") return false
	const lab = getSubstrateHostSurface()
	if (!lab || typeof lab !== "object") return false
	lab.authoring = consoleApi
	return true
}


function mountAuthoringPanel(session, refusals, materialRuntime) {
	if (getSubstrateHostSurface()?.host === "engine" || typeof document === "undefined") return null
	const container = document.getElementById(AUTHORING_PANEL_CONTAINER_ID)
	if (!container) {
		refusals.push("painel de autoria nao montado: nao existe #" + AUTHORING_PANEL_CONTAINER_ID + " na pagina")
		return null
	}
	try {
		return createMaterialGraphPanel({ container, session, materialRuntime })
	} catch (error) {
		refusals.push("painel de autoria falhou ao montar: " + (error?.message ?? String(error)))
		return null
	}
}

function buildConsoleApi(session, request, runtimeOptions = {}) {
	const bridge = createAuthoringRuntimeBridge({session, ...runtimeOptions})
	const onTarget = bridge.forSelectedMaterial
	return {
		target: bridge.target,
		targets: () => runtimeOptions.runtime?.targets() ?? [],
		sync: bridge.synchronize,
		replace: bridge.replaceTree,
		reset: bridge.reset,
		api: () => describePublicApiBlock(),
		property: (className, propertyName) => findPublicApiProperty(className, propertyName),
		autoValues: (tierName) => describeAutoValues(tierName),
		resolve: (propertyRequest) => resolvePropertyValue(propertyRequest ?? {}),
		checkValue: (propertyRequest) => validatePropertyValue(propertyRequest ?? {}),

		presets: () => session.presets(),
		load: onTarget((presetId) => session.loadPreset(presetId)),
		graph: onTarget(() => session.root()),
		nodes: onTarget(() => session.nodes()),
		set: onTarget((path, parameterName, value) => session.setParameter({ path, parameterName, value })),
		auto: onTarget((path, parameterName) => session.setParameter({ path, parameterName, value: SB_AUTO_VALUE })),
		layer: onTarget((path, layerParameters) => session.addLayer({ path, layerParameters })),
		mix: onTarget((path, mixParameters) => session.addMix({ path, mixParameters })),
		remove: onTarget((path) => session.removeAt({ path })),

		validate: onTarget(() => session.validate()),
		serialize: onTarget(() => session.serialize()),
		roundTrip: onTarget(() => session.roundTrip()),
		describe: onTarget(() => session.describe()),
		refusals: onTarget(() => session.refusals()),

		interop: (interopRequest) => describeLegacyInterop(interopRequest ?? request ?? {}),
		gate: (gateRequest) => evaluatePublicApiGate(gateRequest ?? request ?? {}),
	}
}


export function installPhase(installContext) {
	const refusals = []
	const session = createAuthoringSession({ onChange: root => {
		installContext?.materialRuntime?.applyAuthoredTree(root)
		installContext?.bench?.redraw?.()
	} })
	const initialTree = installContext?.materialRuntime?.tree()
	if (initialTree) session.loadTree(initialTree)
	const gate = evaluatePublicApiGate({})
	for (const problem of gate.problems) refusals.push("portao da " + PHASE_ID + ": " + problem)

	reportTelemetry(installContext)

	const consoleApi = buildConsoleApi(session, {}, {runtime:installContext?.materialRuntime,redraw:()=>installContext?.bench?.redraw?.()})
	const consolePublished = publishConsoleApi(consoleApi)
	const panel = mountAuthoringPanel(session, refusals, installContext?.materialRuntime)

	const telemetryError = installContext?.telemetry?.error
	if (refusals.length > 0 && typeof telemetryError === "function") {
		for (const refusal of refusals) telemetryError(PHASE_ID, refusal)
	}

	const publicApi = gate.publicApi
	return {
		phaseId: PHASE_ID,
		installed: refusals.length === 0,
		summary:
			PHASE_ID +
			": bloco publico com " +
			publicApi.propertyCount +
			" propriedades e " +
			gate.collisionCount +
			" colisoes, " +
			gate.presets.presetCount +
			" presets e round-trip sem perda em " +
			gate.interop.losslessCount +
			" de " +
			gate.interop.materialCount +
			" materiais do motor",
		gateOk: gate.ok,
		gateProblems: gate.problems,
		propertyCount: publicApi.propertyCount,
		collisionCount: gate.collisionCount,
		presetCount: gate.presets.presetCount,
		losslessMaterialCount: gate.interop.losslessCount,
		autoParameterCount: gate.autoRoundTrip.autoParameterCount,
		textureUnits: SB_PUBLIC_API_TEXTURE_UNITS,
		closureBytes: SB_PUBLIC_API_CLOSURE_BYTES,
		consolePublished,
		panelMounted: panel !== null,
		refusals,
	}
}
