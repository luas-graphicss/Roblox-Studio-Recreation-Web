import { getSubstrateHostSurface } from "../runtime/substrateHostSurface.js";


import { patchOrderFor } from "../sbMaterialContract.js"
import {
	SB_VERTICAL_LAYERING_APPLY_GLSL,
	SB_VERTICAL_LAYERING_DECLARATIONS_GLSL,
	SB_VERTICAL_LAYERING_UNIFORM_NAMES,
	findVerticalLayeringGlslProblems,
} from "../sbVerticalLayeringGlsl.js"
import {
	bottomAttenuationFor,
	closureBudgetForTier,
	coatDarkeningOf,
	describeVerticalLayering,
	evaluateVerticalLayering,
	findVerticalLayeringContractProblems,
	meetsCoatDarkeningGate,
	sanitizeLayer,
	verticalLayeringPayloadBytes,
} from "../sbVerticalLayeringCore.js"
import { findLayerTransmittanceProblems, layerTransmittance } from "../sbLayerTransmittanceCore.js"

export const PHASE_ID = "SB-F18"
export const FLAG_ID = "SubstrateVerticalLayering"
export const FUNCTIONS_PATCH_ID = "sbVerticalLayeringFunctions"
export const APPLY_PATCH_ID = "sbVerticalLayeringBottomAttenuation"

const FUNCTIONS_ANCHOR = "common"
const APPLY_ANCHOR = "lightsFragmentEnd"
const FUNCTIONS_SUB_SLOT = 0
const APPLY_SUB_SLOT = 1
const PATCHED_MATERIAL_PATHS = ["standard", "poolPhong", "physical", "terreno", "skinned"]
const TEXTURE_UNITS_USED = 0


const NEUTRAL_LAYER = { coverage: 1, thickness: 0, transmittanceColor: [1, 1, 1] }


const CERTIFICATION_LAYER = { coverage: 0.9, thickness: 0.2, transmittanceColor: [0.86, 0.72, 0.5] }

function registerLayerUniforms(patch) {
	patch.registerUniform(SB_VERTICAL_LAYERING_UNIFORM_NAMES.coverage, { owner: PHASE_ID, value: NEUTRAL_LAYER.coverage })
	patch.registerUniform(SB_VERTICAL_LAYERING_UNIFORM_NAMES.thickness, { owner: PHASE_ID, value: NEUTRAL_LAYER.thickness })
	patch.registerUniform(SB_VERTICAL_LAYERING_UNIFORM_NAMES.transmittance, {
		owner: PHASE_ID,
		value: NEUTRAL_LAYER.transmittanceColor.slice(),
	})
}

function layerUniformMap() {
	const names = SB_VERTICAL_LAYERING_UNIFORM_NAMES
	return {
		[names.coverage]: names.coverage,
		[names.thickness]: names.thickness,
		[names.transmittance]: names.transmittance,
	}
}

function writeLayerUniforms(patch, layer) {
	const names = SB_VERTICAL_LAYERING_UNIFORM_NAMES
	const sanitized = sanitizeLayer(layer)
	patch.setUniform(names.coverage, sanitized.coverage)
	patch.setUniform(names.thickness, sanitized.thickness)
	patch.setUniform(names.transmittance, sanitized.transmittanceColor)
	return sanitized
}


function buildCertificate(functionsOrder, applyOrder) {
	const gate = meetsCoatDarkeningGate(CERTIFICATION_LAYER)
	return {
		phase: PHASE_ID,
		flagId: FLAG_ID,
		anchors: {
			[FUNCTIONS_ANCHOR]: functionsOrder,
			[APPLY_ANCHOR]: applyOrder,
		},
		materialPaths: PATCHED_MATERIAL_PATHS.slice(),
		payloadBytes: verticalLayeringPayloadBytes(),
		textureUnits: TEXTURE_UNITS_USED,
		neutralLayer: NEUTRAL_LAYER,
		neutralAttenuation: bottomAttenuationFor(NEUTRAL_LAYER),
		certificationLayer: CERTIFICATION_LAYER,
		certificationTransmittance: layerTransmittance({
			transmittanceColor: CERTIFICATION_LAYER.transmittanceColor,
			thickness: CERTIFICATION_LAYER.thickness,
		}),
		coatDarkeningGate: gate,
		closureBudgetByTier: {
			fraco: closureBudgetForTier("fraco"),
			medio: closureBudgetForTier("medio"),
			forte: closureBudgetForTier("forte"),
		},
		transmittanceProblems: findLayerTransmittanceProblems(),
		contractProblems: findVerticalLayeringContractProblems(),
		glslProblems: findVerticalLayeringGlslProblems(),
	}
}

function buildSummary(certificate, problems) {
	const gate = certificate.coatDarkeningGate
	const neutral = certificate.neutralAttenuation.map((channel) => channel.toFixed(3)).join("/")
	const parts = [
		"camada vertical no ar: flag " + FLAG_ID + " (media e forte), 2 patches nos " + certificate.materialPaths.length + " caminhos de material",
		"funcoes em " + FUNCTIONS_ANCHOR + ":" + certificate.anchors[FUNCTIONS_ANCHOR] + ", aplicacao em " + APPLY_ANCHOR + ":" + certificate.anchors[APPLY_ANCHOR],
		certificate.payloadBytes + " B por closure e " + certificate.textureUnits + " textura",
		"camada neutra = identidade (atenuacao " + neutral + ")",
		"verniz colorido escurece " + (gate.darkening * 100).toFixed(1) + "% contra o portao de " + (gate.minimum * 100).toFixed(1) + "%",
		"nao soma o lobo de cima (SB-F10) e nao recusa por orcamento (SB-F20 e SB-F7)",
	]
	if (problems.length > 0) parts.unshift("PROBLEMAS: " + problems.join("; "))
	return parts.join("; ")
}

function createConsoleApi(patch, certificate) {
	return {
		certificate: () => certificate,
		describe: () => describeVerticalLayering(),
		transmittance: (layer, viewCosine) => {
			const sanitized = sanitizeLayer(layer)
			return layerTransmittance({
				transmittanceColor: sanitized.transmittanceColor,
				thickness: sanitized.thickness,
				viewCosine,
			})
		},
		attenuation: (layer, viewCosine) => bottomAttenuationFor(layer, viewCosine),
		darkening: (layer, viewCosine) => coatDarkeningOf(layer, viewCosine),
		gate: (layer, viewCosine) => meetsCoatDarkeningGate(layer, { viewCosine }),
		evaluate: (node, options) => evaluateVerticalLayering({ node, ...options }),
		setLayer: (layer) => {
			const applied = writeLayerUniforms(patch, layer)
			return { applied, attenuation: bottomAttenuationFor(applied), darkening: coatDarkeningOf(applied) }
		},
		clearLayer: () => ({ applied: writeLayerUniforms(patch, NEUTRAL_LAYER) }),
		neutralLayer: () => ({ ...NEUTRAL_LAYER, transmittanceColor: NEUTRAL_LAYER.transmittanceColor.slice() }),
		certificationLayer: () => ({
			...CERTIFICATION_LAYER,
			transmittanceColor: CERTIFICATION_LAYER.transmittanceColor.slice(),
		}),
	}
}

function publishConsoleApi(consoleApi) {
	if (typeof window === "undefined") return false
	if (!getSubstrateHostSurface()) return false
	getSubstrateHostSurface().verticalLayering = consoleApi
	return true
}

export function installPhase(installContext) {
	const flags = installContext?.flags
	const patch = installContext?.patch
	const telemetry = installContext?.telemetry

	if (!flags?.registerFlag || !patch?.registerPatch || !patch?.registerUniform) {
		return { summary: "contexto de instalacao incompleto: faltou flags ou harness de patch" }
	}

	flags.registerFlag({
		id: FLAG_ID,
		owner: PHASE_ID,
		description: "camada vertical: o slab de baixo e visto atraves do de cima, com Beer-Lambert",
		defaultsByTier: { fraco: false, medio: true, forte: true },
	})

	registerLayerUniforms(patch)

	const functionsOrder = patchOrderFor(PHASE_ID, FUNCTIONS_SUB_SLOT)
	const applyOrder = patchOrderFor(PHASE_ID, APPLY_SUB_SLOT)
	if (functionsOrder === null || applyOrder === null) {
		return { summary: "o contrato nao reservou ordem de patch para " + PHASE_ID }
	}

	const functionsPatch = patch.registerPatch({
		id: FUNCTIONS_PATCH_ID,
		owner: PHASE_ID,
		anchor: FUNCTIONS_ANCHOR,
		order: functionsOrder,
		flagId: FLAG_ID,
		code: SB_VERTICAL_LAYERING_DECLARATIONS_GLSL,
		materialPaths: PATCHED_MATERIAL_PATHS,
		uniforms: layerUniformMap(),
	})
	if (!functionsPatch?.accepted) {
		return { summary: "patch das funcoes recusado: " + (functionsPatch?.reason ?? "motivo nao informado") }
	}

	const applyPatch = patch.registerPatch({
		id: APPLY_PATCH_ID,
		owner: PHASE_ID,
		anchor: APPLY_ANCHOR,
		order: applyOrder,
		flagId: FLAG_ID,
		code: SB_VERTICAL_LAYERING_APPLY_GLSL,
		materialPaths: PATCHED_MATERIAL_PATHS,
		uniforms: layerUniformMap(),
	})
	if (!applyPatch?.accepted) {
		return {
			summary:
				"patch de aplicacao recusado: " +
				(applyPatch?.reason ?? "motivo nao informado") +
				"; as funcoes ficaram registradas e sem uso",
		}
	}

	telemetry?.closureBytes?.(PHASE_ID, verticalLayeringPayloadBytes())
	telemetry?.textureUnit?.(PHASE_ID, TEXTURE_UNITS_USED)

	const certificate = buildCertificate(functionsOrder, applyOrder)
	const problems = [
		...certificate.transmittanceProblems,
		...certificate.contractProblems,
		...certificate.glslProblems,
	]
	for (const problem of problems) telemetry?.error?.(PHASE_ID, problem)

	publishConsoleApi(createConsoleApi(patch, certificate))

	return { summary: buildSummary(certificate, problems) }
}
