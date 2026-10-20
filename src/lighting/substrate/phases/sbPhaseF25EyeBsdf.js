import { getSubstrateHostSurface } from "../runtime/substrateHostSurface.js";


import { closureLayoutBytes } from "../sbClosureLayouts.js"
import {
	certifyEyeBsdf,
	defaultEyeParameters,
	describeEyeBsdf,
	eyeClosurePayload,
	measureParallaxStability,
	packEyeUniform,
	sanitizeEyeParameters,
} from "../sbEyeBsdfCore.js"
import { SB_EYE_GLSL_BLOCKS, SB_EYE_MATERIAL_DEFINE } from "../sbEyeBsdfGlsl.js"

export const PHASE_ID = "SB-F25"

const CLOSURE_KIND = "eye"
const UNIFORM_NAME = "uSbEye"
const FLAG_ID = "SubstrateEyeBsdf"
const CONSOLE_SURFACE_NAME = "eye"

let currentParameters = defaultEyeParameters()


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


function tagEyeMaterials(installContext) {
	const scene = installContext?.bench?.scene
	if (typeof scene?.traverse !== "function") return { eyeMaterials: 0, tagged: 0, skippedTransparent: 0 }
	let eyeMaterials = 0
	let tagged = 0
	let skippedTransparent = 0
	scene.traverse((object) => {
		for (const material of materialsOf(object)) {
			if (CLOSURE_KIND !== material?.userData?.sbBsdfKind) continue
			if (material.transparent) {
				skippedTransparent += 1
				continue
			}
			eyeMaterials += 1
			material.defines = material.defines ?? {}
			if ("1" === material.defines[SB_EYE_MATERIAL_DEFINE]) continue
			material.defines[SB_EYE_MATERIAL_DEFINE] = "1"
			material.needsUpdate = true
			tagged += 1
		}
	})
	return { eyeMaterials, tagged, skippedTransparent }
}

function registerEyePatches(installContext, patchOrder) {
	const accepted = []
	const refusals = []
	for (const block of SB_EYE_GLSL_BLOCKS) {
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
	}
	return { accepted, refusals }
}

function publishConsoleSurface(installContext, surface) {
	if (typeof window === "undefined") return false
	if (!getSubstrateHostSurface()) return false
	getSubstrateHostSurface()[CONSOLE_SURFACE_NAME] = surface
	return true
}

function pushUniform(installContext) {
	installContext?.patch?.setUniform?.(UNIFORM_NAME, packEyeUniform(currentParameters))
	installContext?.patch?.healMaterials?.()
	return packEyeUniform(currentParameters)
}

export function installPhase(installContext) {
	try {
		const contract = installContext?.contract
		const telemetry = installContext?.telemetry
		currentParameters = defaultEyeParameters()
		const certification = certifyEyeBsdf({ eye: currentParameters })

		installContext?.flags?.registerFlag({
			id: FLAG_ID,
			owner: PHASE_ID,
			description: "Liga o BSDF de olho: refracao da iris sob a cornea, pupila e limbo.",
			defaultsByTier: { fraco: false, medio: true, forte: true },
		})

		installContext?.patch?.registerUniform(UNIFORM_NAME, {
			owner: PHASE_ID,
			value: packEyeUniform(currentParameters),
		})

		const patchOrder = contract?.patchOrderFor?.(PHASE_ID, 0)
		if (!Number.isFinite(patchOrder)) {
			return { summary: PHASE_ID + " nao instalou: o contrato nao reservou ordem de patch" }
		}

		const registration = registerEyePatches(installContext, patchOrder)
		if (registration.refusals.length > 0) {
			telemetry?.error?.(PHASE_ID, "patch recusado: " + registration.refusals.join("; "))
			return { summary: "patch recusado: " + registration.refusals.join("; ") }
		}

		const closureBytes = closureLayoutBytes(CLOSURE_KIND)
		telemetry?.closureBytes?.(PHASE_ID, closureBytes)

		const tagging = tagEyeMaterials(installContext)
		installContext?.patch?.healMaterials?.()

		publishConsoleSurface(installContext, {
			owner: PHASE_ID,
			flagId: FLAG_ID,
			parameters: () => ({ ...currentParameters }),
			describe: () => describeEyeBsdf(currentParameters),
			certify: (eyeParameters) => certifyEyeBsdf({ eye: eyeParameters ?? currentParameters }),
			parallax: (eyeParameters) => measureParallaxStability(eyeParameters ?? currentParameters),
			payload: (normal) => eyeClosurePayload(currentParameters, normal),
			closureBytes: () => closureBytes,
			set: (updates) => {
				currentParameters = sanitizeEyeParameters({ ...currentParameters, ...updates })
				pushUniform(installContext)
				return { ...currentParameters }
			},
			reset: () => {
				currentParameters = defaultEyeParameters()
				pushUniform(installContext)
				return { ...currentParameters }
			},
			retag: () => {
				const retagging = tagEyeMaterials(installContext)
				installContext?.patch?.healMaterials?.()
				return retagging
			},
			patches: () => registration.accepted.slice(),
		})

		const parallax = certification.parallax
		const measured = [
			"parallax refratado " +
				parallax.minimumOffsetPerIrisDepth.toFixed(3) +
				"x.." +
				parallax.maximumOffsetPerIrisDepth.toFixed(3) +
				"x a profundidade da iris em " +
				parallax.angleCount +
				" angulos",
			parallax.inversionCount + " inversoes",
			"energia maxima " + certification.energy.worstEnergy.toFixed(3) + " de " + certification.energy.ceiling,
			closureBytes + " B por closure (layout " + CLOSURE_KIND + ")",
			registration.accepted.length + " patches na ordem " + patchOrder,
			tagging.eyeMaterials +
				" materiais de olho marcados (" +
				tagging.skippedTransparent +
				" cascas transparentes fora)",
		].join(", ")

		if (!certification.ok) {
			telemetry?.error?.(PHASE_ID, "portao do olho vermelho: " + certification.problems.join("; "))
			return { summary: PHASE_ID + " instalou com portao VERMELHO: " + certification.problems.join("; ") + ". " + measured }
		}

		return { summary: PHASE_ID + " ok: " + measured }
	} catch (error) {
		return { summary: PHASE_ID + " nao instalou: " + (error?.message ?? String(error)) }
	}
}
