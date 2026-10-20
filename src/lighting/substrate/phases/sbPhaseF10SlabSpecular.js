import { getSubstrateHostSurface } from "../runtime/substrateHostSurface.js";


import { SB_GATES, patchOrderFor } from "../sbMaterialContract.js"
import { SB_REFERENCE_SEED } from "../sbReferenceSamplingCore.js"
import { SB_WHITE_FURNACE_FIT_MEASUREMENT } from "../sbEnvBrdfCore.js"
import { SB_SLAB_SPECULAR_GLSL } from "../sbSlabSpecularGlsl.js"
import { certifySlabSpecular, formatPercent, measureWhiteFurnaceAgreement } from "../sbSlabSpecularCertificationCore.js"
import { slabSpecularEnergyCompensation } from "../sbSlabSpecularCore.js"

export const PHASE_ID = "SB-F10"
export const FLAG_ID = "SubstrateSlabSpecular"


const INSTALL_SAMPLE_COUNT = 1024


const CONSOLE_SAMPLE_COUNT = 2048

const DEFAULT_VIEW_COSINE = 0.7


const PHYSICAL_MATERIAL_PATHS = Object.freeze(["standard", "physical", "terreno", "skinned"])


const PATCH_DEFINITIONS = Object.freeze([
	Object.freeze({
		id: "sbF10SlabSpecularFunctions",
		anchor: "lightsPhysicalPars",
		subSlot: 0,
		code: SB_SLAB_SPECULAR_GLSL.functions,
	}),
	Object.freeze({
		id: "sbF10SlabSpecularDirectCompensation",
		anchor: "lightsFragmentEnd",
		subSlot: 1,
		code: SB_SLAB_SPECULAR_GLSL.directSpecularCompensation,
		requiresAcceptedFunctions: true,
	}),
])


export const SB_SLAB_SPECULAR_PATCH_ANCHORS = Object.freeze(
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
		description: "Especular do slab com F0/F90 e compensacao de multi-scatter no especular direto.",
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
		if (definition.requiresAcceptedFunctions && !functionsAccepted) {
			refused.push({ ...entry, reason: "as funcoes nao entraram: a compensacao nao pode entrar sozinha" })
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

function createSlabSpecularConsole(gates) {
	return {
		flagId: FLAG_ID,
		seed: SB_REFERENCE_SEED,
		sampleCount: CONSOLE_SAMPLE_COUNT,
		fit: SB_WHITE_FURNACE_FIT_MEASUREMENT,
		gates: {
			furnaceMinimum: gates.furnaceMinimum,
			furnaceMaximum: gates.furnaceMaximum,
			maxReferenceEnergyDeviation: gates.maxReferenceEnergyDeviation,
		},


		energy(slab, cosThetaView) {
			return slabSpecularEnergyCompensation({ slab, cosThetaView: cosThetaView ?? DEFAULT_VIEW_COSINE })
		},


		agreement() {
			return measureWhiteFurnaceAgreement({ gates, sampleCount: CONSOLE_SAMPLE_COUNT, seed: SB_REFERENCE_SEED })
		},

		certify() {
			return certifySlabSpecular({ gates, sampleCount: CONSOLE_SAMPLE_COUNT, seed: SB_REFERENCE_SEED })
		},
	}
}


function publishSlabSpecularConsole(slabSpecularConsole) {
	const lab = typeof window === "undefined" ? null : getSubstrateHostSurface()
	if (!lab) return { published: false }
	lab.slabSpecular = slabSpecularConsole
	return { published: true }
}


function describeInstall(state) {
	const { certification, patches, flag, publication } = state
	const { whiteFurnaceAgreement, furnaceClosure, brdfParity, directSpecularGain } = certification
	const measurements = [
		`forno compensado ${furnaceClosure.minimum.toFixed(4)}..${furnaceClosure.maximum.toFixed(4)} em ${furnaceClosure.roughnessCount} rugosidades`,
		`albedo vs SB-F5: pior erro ${formatPercent(whiteFurnaceAgreement.worstDeviation)} no portao de ${formatPercent(whiteFurnaceAgreement.gate)}`,
		`lobo identico a SB-F5 em ${brdfParity.comparisonCount} direcoes (pior ${brdfParity.worstDifference.toExponential(2)})`,
		`ganho no direto ate ${directSpecularGain.maximumScale.toFixed(3)}x`,
		certification.specularAntiAliasing.ok ? "specular AA intacto" : "specular AA EM RISCO",
		`${patches.accepted.length}/${PATCH_DEFINITIONS.length} patches aceitos`,
		flag.registered ? `flag ${FLAG_ID}` : "sem flag (bancada ausente)",
	]
	if (publication.published) measurements.push("__sbLab.slabSpecular publicado")
	const headline = certification.ok
		? "especular do slab certificado"
		: `PORTAO NAO FECHADO: ${certification.problems.join(" | ")}`
	const refusals = patches.refused.length === 0 ? "" : ` | patches recusados: ${patches.refused.map((entry) => entry.id).join(", ")}`
	return `${PHASE_ID} ${headline} (${measurements.join(", ")})${refusals}`
}


export function installPhase(installContext) {
	try {
		const contract = installContext?.contract ?? null
		const gates = contract?.SB_GATES ?? SB_GATES
		const resolvePatchOrder = contract?.patchOrderFor ?? patchOrderFor
		const flag = registerPhaseFlag(installContext)
		const patches = registerPhasePatches(installContext, resolvePatchOrder)
		reportRefusals(installContext, patches.refused)
		declareBudget(installContext)
		const certification = certifySlabSpecular({
			gates,
			sampleCount: INSTALL_SAMPLE_COUNT,
			seed: SB_REFERENCE_SEED,
		})
		const publication = publishSlabSpecularConsole(createSlabSpecularConsole(gates))
		return {
			summary: describeInstall({ certification, patches, flag, publication }),
			certification,
			patches,
			flagId: FLAG_ID,
		}
	} catch (installError) {
		return { summary: `${PHASE_ID} nao instalou: ${installError?.message ?? String(installError)}` }
	}
}
