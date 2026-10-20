import { getSubstrateHostSurface } from "../runtime/substrateHostSurface.js";


import { SB_GATES, patchOrderFor } from "../sbMaterialContract.js"
import {
	SB_ANISOTROPY_ANCHORS,
	SB_ANISOTROPY_GLSL,
	SB_ANISOTROPY_UNIFORM_NAME,
} from "../sbAnisotropyGlsl.js"
import {
	SB_ANISOTROPY_CONSOLE_RESOLUTION,
	SB_ANISOTROPY_INSTALL_RESOLUTION,
	certifyAnisotropy,
	formatPercent,
	measureHighlightPoseStability,
} from "../sbAnisotropyCertificationCore.js"
import {
	anisotropicAlphaSplit,
	anisotropicHighlightStretch,
	normalizeAnisotropicSlab,
} from "../sbAnisotropyCore.js"
import { buildTangentFrame } from "../sbTangentFrameCore.js"

export const PHASE_ID = "SB-F11"
export const FLAG_ID = "SubstrateAnisotropy"


const PHYSICAL_MATERIAL_PATHS = Object.freeze(["standard", "physical", "terreno", "skinned"])


const NEUTRAL_UNIFORM_VALUE = Object.freeze([0, 0])


const PATCH_DEFINITIONS = Object.freeze([
	Object.freeze({
		id: "sbF11AnisotropyFunctions",
		anchor: SB_ANISOTROPY_ANCHORS.functions,
		subSlot: 0,
		code: SB_ANISOTROPY_GLSL.functions,
	}),
	Object.freeze({
		id: "sbF11AnisotropyIndirectSpecular",
		anchor: SB_ANISOTROPY_ANCHORS.application,
		subSlot: 1,
		code: SB_ANISOTROPY_GLSL.indirectSpecularApplication,
		requiresAcceptedFunctions: true,
	}),
])


export const SB_ANISOTROPY_PATCH_ANCHORS = Object.freeze(
	PATCH_DEFINITIONS.map((definition) =>
		Object.freeze({ id: definition.id, anchor: definition.anchor, subSlot: definition.subSlot }),
	),
)

function registerPhaseFlag(installContext) {
	const register = installContext?.flags?.registerFlag
	if (typeof register !== "function") return { registered: false }
	register({
		id: FLAG_ID,
		owner: PHASE_ID,
		description: "GGX anisotropico com frame tangente da superficie no especular indireto.",
		defaultsByTier: { fraco: false, medio: true, forte: true },
	})
	return { registered: true }
}


function describeAnchorProblem(installContext, anchor) {
	const checkAnchor = installContext?.patch?.checkAnchor
	if (typeof checkAnchor !== "function") return null
	const report = checkAnchor(anchor)
	if (report?.present === false) return `ancora ausente: ${anchor} (${report.reason ?? "assinatura nao encontrada"})`
	return null
}

function registerPhasePatches(installContext, resolvePatchOrder) {
	const registerPatch = installContext?.patch?.registerPatch
	if (typeof registerPatch !== "function") {
		return { accepted: [], refused: [{ id: "todos", reason: "bancada sem registerPatch" }] }
	}
	const accepted = []
	const refused = []
	let functionsAccepted = false
	for (const definition of PATCH_DEFINITIONS) {
		const order = resolvePatchOrder(PHASE_ID, definition.subSlot)
		const entry = { id: definition.id, anchor: definition.anchor, order }
		if (order === null || order === undefined) {
			refused.push({ ...entry, reason: "contrato nao deu ordem para a fase neste subSlot" })
			continue
		}
		if (definition.requiresAcceptedFunctions && !functionsAccepted) {
			refused.push({ ...entry, reason: "as funcoes nao entraram: a aplicacao nao pode entrar sozinha" })
			continue
		}
		const anchorProblem = describeAnchorProblem(installContext, definition.anchor)
		if (anchorProblem) {
			refused.push({ ...entry, reason: anchorProblem })
			continue
		}
		const result = registerPatch({
			id: definition.id,
			owner: PHASE_ID,
			anchor: definition.anchor,
			order,
			flagId: FLAG_ID,
			code: definition.code,
			materialPaths: PHYSICAL_MATERIAL_PATHS,
		})
		if (result?.accepted) {
			accepted.push(entry)
			if (!definition.requiresAcceptedFunctions) functionsAccepted = true
		} else {
			refused.push({ ...entry, reason: result?.reason ?? "recusa sem motivo declarado" })
		}
	}
	return { accepted, refused }
}


function registerPhaseUniform(installContext) {
	const registerUniform = installContext?.patch?.registerUniform
	if (typeof registerUniform !== "function") {
		return { registered: false, reason: "bancada sem registerUniform", name: SB_ANISOTROPY_UNIFORM_NAME }
	}
	const holder = registerUniform(SB_ANISOTROPY_UNIFORM_NAME, {
		owner: PHASE_ID,
		value: [NEUTRAL_UNIFORM_VALUE[0], NEUTRAL_UNIFORM_VALUE[1]],
	})
	return { registered: true, holder, name: SB_ANISOTROPY_UNIFORM_NAME }
}


function declareBudget(installContext) {
	const telemetry = installContext?.telemetry
	telemetry?.textureUnit?.(PHASE_ID, 0)
	telemetry?.closureBytes?.(PHASE_ID, 0)
}

function reportRefusals(installContext, refused) {
	const telemetry = installContext?.telemetry
	for (const problem of refused) {
		telemetry?.error?.(PHASE_ID, "patch recusado: " + problem.id + " (" + problem.reason + ")")
	}
}

function createAnisotropyConsole(options) {
	const gates = options.gates
	const uniform = options.uniform
	const setUniform = options.installContext?.patch?.setUniform
	return {
		flagId: FLAG_ID,
		uniformName: uniform.name,
		gates: {
			anisotropyPoseMinimumSsim: gates.anisotropyPoseMinimumSsim,
			maxReferenceEnergyDeviation: gates.maxReferenceEnergyDeviation,
		},


		frame(frameOptions) {
			return buildTangentFrame(frameOptions ?? {})
		},


		split(slab) {
			return anisotropicAlphaSplit({ normalizedSlab: normalizeAnisotropicSlab(slab ?? {}) })
		},


		stretch(slab) {
			return anisotropicHighlightStretch(
				anisotropicAlphaSplit({ normalizedSlab: normalizeAnisotropicSlab(slab ?? {}) }),
			)
		},


		apply(anisotropy, anisotropyRotation) {
			const normalizedSlab = normalizeAnisotropicSlab({ anisotropy, anisotropyRotation })
			const appliedValue = [normalizedSlab.anisotropy, normalizedSlab.anisotropyRotation]
			if (Array.isArray(uniform.holder?.value)) {
				uniform.holder.value[0] = appliedValue[0]
				uniform.holder.value[1] = appliedValue[1]
			}
			if (typeof setUniform === "function") setUniform(uniform.name, appliedValue)
			return {
				anisotropy: appliedValue[0],
				anisotropyRotation: appliedValue[1],
				applied: uniform.registered === true,
			}
		},


		poseStability() {
			return measureHighlightPoseStability({ gates, resolution: SB_ANISOTROPY_CONSOLE_RESOLUTION })
		},

		certify() {
			return certifyAnisotropy({ gates, resolution: SB_ANISOTROPY_CONSOLE_RESOLUTION })
		},
	}
}


function publishAnisotropyConsole(anisotropyConsole) {
	const lab = typeof window === "undefined" ? null : getSubstrateHostSurface()
	if (!lab) return { published: false }
	lab.anisotropy = anisotropyConsole
	return { published: true }
}


function describeInstall(state) {
	const certification = state.certification
	const patches = state.patches
	const pose = certification.poseStability
	const energy = certification.energyAgreement
	const parts = [
		certification.ok
			? `${PHASE_ID} instalada`
			: `${PHASE_ID} PORTAO NAO FECHADO: ${certification.problems.join("; ")}`,
		`${patches.accepted.length} de ${PATCH_DEFINITIONS.length} patches aceitos`,
		`highlight preso a superficie com SSIM ${pose.worstSurfaceFrameSsim.toFixed(6)} no portao de ${pose.gate} (controle com up do mundo: ${pose.worstControlSsim.toFixed(4)})`,
		`albedo maximo do forno branco ${energy.worstAlbedo.toFixed(4)} e media azimutal estavel sob giro em ${formatPercent(energy.worstAzimuthalDeviation)} no portao de ${formatPercent(energy.gate)}`,
		`residuo medido: esticar o lobo desloca a energia media em ${formatPercent(energy.worstEnergyShiftFromIsotropy)}, porque a compensacao multi-scatter da SB-F10 ainda e isotropica`,
		`D integra 1 com desvio de ${formatPercent(certification.distributionNormalization.worstDeviation)}`,
		`paridade com a SB-F10 em anisotropia 0: ${certification.lobeParity.worstRelativeDifference.toExponential(2)} em ${certification.lobeParity.comparisonCount} direcoes`,
		`uniform ${state.uniform.name} neutro em [0, 0]`,
		"residuo declarado: luz pontual espera a SB-F33 (as duas ramificacoes de lightingRender.js)",
	]
	if (patches.refused.length > 0) {
		parts.push(`recusas: ${patches.refused.map((problem) => `${problem.id} (${problem.reason})`).join("; ")}`)
	}
	return parts.join(" | ")
}

export function installPhase(installContext) {
	try {
		const contract = installContext?.contract
		const gates = contract?.SB_GATES ?? SB_GATES
		const resolvePatchOrder = contract?.patchOrderFor ?? patchOrderFor
		const flag = registerPhaseFlag(installContext)
		const uniform = registerPhaseUniform(installContext)
		const patches = registerPhasePatches(installContext, resolvePatchOrder)
		reportRefusals(installContext, patches.refused)
		declareBudget(installContext)
		const certification = certifyAnisotropy({ gates, resolution: SB_ANISOTROPY_INSTALL_RESOLUTION })
		const anisotropyConsole = createAnisotropyConsole({ gates, uniform, installContext })
		const consoleState = publishAnisotropyConsole(anisotropyConsole)
		return {
			summary: describeInstall({ certification, patches, uniform }),
			certification,
			patches,
			flagId: FLAG_ID,
			flagRegistered: flag.registered,
			uniform: { name: uniform.name, registered: uniform.registered === true },
			consolePublished: consoleState.published,
		}
	} catch (installError) {
		return { summary: `${PHASE_ID} nao instalou: ${installError?.message ?? String(installError)}` }
	}
}
