import { getSubstrateHostSurface } from "../runtime/substrateHostSurface.js";


import { SB_GATES, patchOrderFor } from "../sbMaterialContract.js"
import {
	describeSlabDiffuse,
	diffuseEnergyScaleFromSpecularAlbedo,
	evaluateCoupledSlabDiffuseBsdf,
	evaluateSlabDiffuseBsdf,
	slabDiffuseModelIds,
} from "../sbSlabDiffuseCore.js"
import {
	certifySlabDiffuse,
	formatEnergyRatioAsPercent,
	integrateSlabDiffuseDirectionalAlbedo,
} from "../sbSlabDiffuseEnergyCore.js"
import { SB_SLAB_DIFFUSE_GLSL } from "../sbSlabDiffuseGlsl.js"

export const PHASE_ID = "SB-F17"

const FLAG_ID = "SubstrateSlabDiffuse"
const PATCH_ID = "sbSlabDiffuse"
const PATCH_ANCHOR = "bsdfs"
const FLAG_DEFAULTS_BY_TIER = { fraco: false, medio: true, forte: true }
const INSTALL_SAMPLE_COUNT = 144
const CLOSURE_BYTES_ADDED = 0


function inspectPatchAnchor(installContext) {
	const three = installContext?.bench?.THREE ?? null
	const checkAnchor = installContext?.patch?.checkAnchor
	if (!three || typeof checkAnchor !== "function") {
		return {
			anchorId: PATCH_ANCHOR,
			present: null,
			reason: "ancora nao verificada aqui: contexto sem three.js",
		}
	}
	return checkAnchor(three, PATCH_ANCHOR)
}





function registerDiffusePatch(installContext, options) {
	if (typeof options.patchOrder !== "number") {
		return { accepted: false, reason: "o contrato nao reserva ordem de patch para " + PHASE_ID }
	}
	if (options.anchor?.present === false) {
		return { accepted: false, reason: "ancora ausente: " + (options.anchor.reason ?? PATCH_ANCHOR) }
	}
	const registerPatch = installContext?.patch?.registerPatch
	if (typeof registerPatch !== "function") {
		return { accepted: false, reason: "contexto sem harness de patch" }
	}
	return registerPatch({
		id: PATCH_ID,
		owner: PHASE_ID,
		flagId: FLAG_ID,
		anchor: PATCH_ANCHOR,
		order: options.patchOrder,
		declarations: SB_SLAB_DIFFUSE_GLSL.declarations,
		code: SB_SLAB_DIFFUSE_GLSL.code,
	})
}


function publishConsoleApi() {
	if (typeof window === "undefined" || !getSubstrateHostSurface()) return false
	getSubstrateHostSurface().slabDiffuse = {
		describe: () => describeSlabDiffuse(),
		models: () => slabDiffuseModelIds(),
		evaluate: (options) => evaluateSlabDiffuseBsdf(options),
		evaluateCoupled: (options) => evaluateCoupledSlabDiffuseBsdf(options),
		energyScale: (specularDirectionalAlbedo) => diffuseEnergyScaleFromSpecularAlbedo(specularDirectionalAlbedo),
		directionalAlbedo: (options) => integrateSlabDiffuseDirectionalAlbedo(options),
		certify: (options) => certifySlabDiffuse(options),
	}
	return true
}

function buildSummary(options) {
	const { certification, patchResult, anchor, patchOrder } = options
	const parts = [
		PHASE_ID + " difusa do slab no ar com o modelo " + certification.model,
		"erro vs referencia SB-F5: " +
			formatEnergyRatioAsPercent(certification.worstRelativeError) +
			" (portao " +
			formatEnergyRatioAsPercent(certification.maxRelativeError) +
			") em " +
			certification.roughnesses.length +
			" rugosidades e " +
			certification.energySampleTotal +
			" amostras",
		"pior soma difusa+especular: " +
			certification.worstEnergySum.toFixed(6) +
			" (teto 1) em " +
			certification.sumSampleTotal +
			" amostras",
		patchResult.accepted
			? "GLSL costurado na ancora " + PATCH_ANCHOR + " na ordem " + patchOrder + ", atras da flag " + FLAG_ID
			: "GLSL recusado: " + patchResult.reason,
	]
	if (anchor?.present === null) parts.push(anchor.reason)
	if (!certification.ok) parts.push("portao aberto: " + certification.problems.join(" | "))
	return parts.join("; ")
}

export function installPhase(installContext) {
	try {
		const gates = installContext?.contract?.SB_GATES ?? SB_GATES
		const resolvePatchOrder = installContext?.contract?.patchOrderFor ?? patchOrderFor
		const patchOrder = resolvePatchOrder(PHASE_ID)

		installContext?.flags?.registerFlag({
			id: FLAG_ID,
			owner: PHASE_ID,
			description: "Difusa do slab com rugosidade e acoplamento com o especular.",
			defaultsByTier: FLAG_DEFAULTS_BY_TIER,
		})

		const anchor = inspectPatchAnchor(installContext)
		const patchResult = registerDiffusePatch(installContext, { anchor, patchOrder })

		installContext?.telemetry?.closureBytes(PHASE_ID, CLOSURE_BYTES_ADDED)

		const certification = certifySlabDiffuse({ gates, sampleCount: INSTALL_SAMPLE_COUNT })
		if (!certification.ok) {
			installContext?.telemetry?.error(PHASE_ID, certification.problems.join(" | "))
		}

		return {
			summary: buildSummary({ certification, patchResult, anchor, patchOrder }),
			certification,
			patch: patchResult,
			anchor,
			flagId: FLAG_ID,
			consolePublished: publishConsoleApi(),
		}
	} catch (error) {
		const message = error?.message ?? String(error)
		installContext?.telemetry?.error(PHASE_ID, message)
		return { summary: PHASE_ID + " nao instalou: " + message, failed: true }
	}
}
