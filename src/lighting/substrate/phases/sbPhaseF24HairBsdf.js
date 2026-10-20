import { getSubstrateHostSurface } from "../runtime/substrateHostSurface.js";


import { closureLayoutBytes } from "../sbClosureLayouts.js"
import {
	defaultHairParameters,
	hairClosurePayload,
	packHairUniform,
	sanitizeHairParameters,
} from "../sbHairBsdfCore.js"
import { SB_HAIR_GLSL_BLOCKS, SB_HAIR_MATERIAL_DEFINE } from "../sbHairBsdfGlsl.js"
import {
	certifyHairBsdf,
	describeHairBsdf,
	measureHairEnergy,
	measureHighlightShift,
	measureLobeSeparability,
} from "../sbHairCertificationCore.js"

export const PHASE_ID = "SB-F24"

const CLOSURE_KIND = "hair"
const UNIFORM_NAME = "uSbHair"
const FLAG_ID = "SubstrateHairBsdf"
const CONSOLE_SURFACE_NAME = "hair"

let currentParameters = defaultHairParameters()


function anchorProblem(installContext, anchorId) {
	const anchorReport = installContext?.telemetry?.get?.()?.anchors?.[anchorId]
	if (!anchorReport) return null
	if (anchorReport.present) return null
	return anchorId + " (" + (anchorReport.reason ?? "motivo nao informado") + ")"
}

function materialsOf(object) {
	if (Array.isArray(object?.material)) return object.material
	return object?.material ? [object.material] : []
}


function tagHairMaterials(installContext) {
	const scene = installContext?.bench?.scene
	if (typeof scene?.traverse !== "function") return { hairMaterials: 0, tagged: 0 }
	let hairMaterials = 0
	let tagged = 0
	scene.traverse((object) => {
		for (const material of materialsOf(object)) {
			if (CLOSURE_KIND !== material?.userData?.sbBsdfKind) continue
			hairMaterials += 1
			material.defines = material.defines ?? {}
			if ("1" === material.defines[SB_HAIR_MATERIAL_DEFINE]) continue
			material.defines[SB_HAIR_MATERIAL_DEFINE] = "1"
			material.needsUpdate = true
			tagged += 1
		}
	})
	return { hairMaterials, tagged }
}





function registerHairPatches(installContext, contract) {
	const accepted = []
	const refusals = []
	const orders = []
	for (let blockIndex = 0; SB_HAIR_GLSL_BLOCKS.length > blockIndex; blockIndex += 1) {
		const block = SB_HAIR_GLSL_BLOCKS[blockIndex]
		const patchOrder = contract?.patchOrderFor?.(PHASE_ID, blockIndex)
		if (!Number.isFinite(patchOrder)) {
			refusals.push(block.id + ": o contrato nao reservou ordem para o sub-slot " + blockIndex)
			break
		}
		const missingAnchor = anchorProblem(installContext, block.anchor)
		if (missingAnchor) {
			refusals.push("ancora ausente: " + missingAnchor)
			break
		}
		const registration = installContext?.patch?.registerPatch({
			id: block.id,
			owner: PHASE_ID,
			anchor: block.anchor,
			order: patchOrder,
			flagId: FLAG_ID,
			code: block.code,
			uniforms: { [UNIFORM_NAME]: UNIFORM_NAME },
		})
		if (!registration?.accepted) {
			refusals.push(block.id + ": " + (registration?.reason ?? "registro sem resposta"))
			break
		}
		accepted.push(block.id)
		orders.push(patchOrder)
	}
	return { accepted, refusals, orders }
}

function publishConsoleSurface(surface) {
	if (typeof window === "undefined") return false
	if (!getSubstrateHostSurface()) return false
	getSubstrateHostSurface()[CONSOLE_SURFACE_NAME] = surface
	return true
}

function pushUniform(installContext) {
	const packedUniform = packHairUniform(currentParameters)
	installContext?.patch?.setUniform?.(UNIFORM_NAME, packedUniform)
	installContext?.patch?.healMaterials?.()
	return packedUniform
}

export function installPhase(installContext) {
	try {
		const contract = installContext?.contract
		const telemetry = installContext?.telemetry
		currentParameters = defaultHairParameters()
		const certification = certifyHairBsdf({ hair: currentParameters })

		installContext?.flags?.registerFlag({
			id: FLAG_ID,
			owner: PHASE_ID,
			description: "Liga o BSDF de cabelo: os lobos R, TT e TRT da fibra com inclinacao de cuticula.",
			defaultsByTier: { fraco: false, medio: true, forte: true },
		})

		installContext?.patch?.registerUniform(UNIFORM_NAME, {
			owner: PHASE_ID,
			value: packHairUniform(currentParameters),
		})

		const registration = registerHairPatches(installContext, contract)
		if (registration.refusals.length > 0) {
			telemetry?.error?.(PHASE_ID, "patch recusado: " + registration.refusals.join("; "))
			return { summary: "patch recusado: " + registration.refusals.join("; ") }
		}

		const closureBytes = closureLayoutBytes(CLOSURE_KIND)
		telemetry?.closureBytes?.(PHASE_ID, closureBytes)

		const tagging = tagHairMaterials(installContext)
		installContext?.patch?.healMaterials?.()

		publishConsoleSurface({
			owner: PHASE_ID,
			flagId: FLAG_ID,
			parameters: () => ({ ...currentParameters }),
			describe: () => describeHairBsdf(currentParameters),
			certify: (hairParameters) => certifyHairBsdf({ hair: hairParameters ?? currentParameters }),
			lobes: (hairParameters) => measureLobeSeparability(hairParameters ?? currentParameters),
			energy: (hairParameters) => measureHairEnergy(hairParameters ?? currentParameters),
			highlight: (hairParameters) => measureHighlightShift(hairParameters ?? currentParameters),
			payload: (fiberTangent) => hairClosurePayload(currentParameters, fiberTangent),
			uniform: () => packHairUniform(currentParameters),
			closureBytes: () => closureBytes,
			set: (updates) => {
				currentParameters = sanitizeHairParameters({ ...currentParameters, ...updates })
				pushUniform(installContext)
				return { ...currentParameters }
			},
			reset: () => {
				currentParameters = defaultHairParameters()
				pushUniform(installContext)
				return { ...currentParameters }
			},
			retag: () => {
				const retagging = tagHairMaterials(installContext)
				installContext?.patch?.healMaterials?.()
				return retagging
			},
			patches: () => registration.accepted.slice(),
		})

		const separability = certification.separability
		const highlight = certification.highlight
		const measured = [
			separability.lobeCount +
				" lobos isolaveis (cosseno maximo entre perfis " +
				separability.maximumSimilarity.toFixed(4) +
				", menor fatia por lobo na melhor vista dele " +
				separability.minimumBestShare.toFixed(4) +
				")",
			"energia maxima " +
				certification.energy.worstEnergy.toFixed(4) +
				" de " +
				certification.energy.energyCeiling +
				" em " +
				certification.energy.sampleCount +
				" vistas",
			"highlight primario desloca " +
				highlight.shiftPerCuticleRadian.toFixed(4) +
				" rad por rad de cuticula em " +
				highlight.samples.length +
				" inclinacoes",
			closeBytesLabel(closureBytes),
			registration.accepted.length + " patches nas ordens " + registration.orders.join(" e "),
			tagging.hairMaterials + " materiais de cabelo marcados",
		].join(", ")

		if (!certification.ok) {
			telemetry?.error?.(PHASE_ID, "portao do cabelo vermelho: " + certification.problems.join("; "))
			return {
				summary:
					PHASE_ID + " instalou com portao VERMELHO: " + certification.problems.join("; ") + ". " + measured,
			}
		}

		return { summary: PHASE_ID + " ok: " + measured }
	} catch (error) {
		return { summary: PHASE_ID + " nao instalou: " + (error?.message ?? String(error)) }
	}
}

function closeBytesLabel(closureBytes) {
	return closureBytes + " B por closure (layout " + CLOSURE_KIND + ")"
}
