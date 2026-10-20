import { getSubstrateHostSurface } from "../runtime/substrateHostSurface.js";


import { SB_GATES } from "../sbMaterialContract.js"
import { SB_SLAB_PRESETS, slabPresetIds } from "../support/src/lab/labSlabPresets.js"
import { SB_REFERENCE_SEED } from "../sbReferenceSamplingCore.js"
import {
	buildDirectionalAlbedoTable,
	integrateDirectionalAlbedoByImportanceSampling,
	integrateHemisphericalAlbedo,
} from "../sbSlabReferenceIntegratorCore.js"
import { certifyReferenceIntegrator, furnaceTestVerdict, runWhiteFurnaceTest } from "../sbFurnaceTestCore.js"

export const PHASE_ID = "SB-F5"


const INSTALL_SAMPLE_COUNT = 256


const CONSOLE_SAMPLE_COUNT = 1024

const DEFAULT_SLAB_ID = "dielectricChart"
const DEFAULT_VIEW_COSINE = 0.7

function resolveSlab(slabId) {
	return SB_SLAB_PRESETS[slabId] ?? SB_SLAB_PRESETS[DEFAULT_SLAB_ID]
}


function resolveRoughness(slabIdOrRoughness) {
	if (typeof slabIdOrRoughness === "number") return slabIdOrRoughness
	return resolveSlab(slabIdOrRoughness).roughness
}

function createReferenceConsole(gates) {
	return {
		seed: SB_REFERENCE_SEED,
		sampleCount: CONSOLE_SAMPLE_COUNT,
		slabIds: () => slabPresetIds(),

		directionalAlbedo(slabId, cosThetaView) {
			return integrateDirectionalAlbedoByImportanceSampling({
				slab: resolveSlab(slabId),
				cosThetaView: cosThetaView ?? DEFAULT_VIEW_COSINE,
				sampleCount: CONSOLE_SAMPLE_COUNT,
				seed: SB_REFERENCE_SEED,
			})
		},

		totalEnergy(slabId) {
			const table = buildDirectionalAlbedoTable({
				slab: resolveSlab(slabId),
				sampleCount: INSTALL_SAMPLE_COUNT,
				seed: SB_REFERENCE_SEED,
			})
			return integrateHemisphericalAlbedo({ table })
		},

		furnace(slabIdOrRoughness) {
			const furnace = runWhiteFurnaceTest({
				roughness: resolveRoughness(slabIdOrRoughness),
				sampleCount: CONSOLE_SAMPLE_COUNT,
				seed: SB_REFERENCE_SEED,
			})
			return { ...furnace, verdict: furnaceTestVerdict(furnace, gates) }
		},

		certify() {
			return certifyReferenceIntegrator({ sampleCount: CONSOLE_SAMPLE_COUNT, seed: SB_REFERENCE_SEED, gates })
		},
	}
}


function publishReferenceConsole(referenceConsole) {
	const lab = typeof window === "undefined" ? null : getSubstrateHostSurface()
	if (!lab) return { published: false, replacedFurnaceShortcut: false }
	lab.reference = referenceConsole
	const previousFurnaceShortcut = typeof lab.furnace === "function" ? lab.furnace : null
	if (previousFurnaceShortcut) lab.furnaceQuick = previousFurnaceShortcut
	lab.furnace = (slabIdOrRoughness) => referenceConsole.furnace(slabIdOrRoughness)
	return { published: true, replacedFurnaceShortcut: Boolean(previousFurnaceShortcut) }
}


function describeCertification(certification, publication) {
	const pureDiffuse = certification.pureDiffuse
	const measurements = [
		`forno difuso ${pureDiffuse.minimum.toFixed(4)}..${pureDiffuse.maximum.toFixed(4)}`,
		`GGX compensado ${certification.compensatedMinimum.toFixed(4)}..${certification.compensatedMaximum.toFixed(4)} em ${certification.byRoughness.length} rugosidades`,
		`pior single-scatter ${certification.worstSingleScatter.toFixed(4)}`,
		certification.deterministic ? "deterministico" : "NAO deterministico",
		`semente ${certification.seed}`,
	]
	if (publication.replacedFurnaceShortcut) measurements.push("__sbLab.furnace() agora e o integrador")
	const headline = certification.ok
		? "integrador de referencia certificado"
		: `PORTAO NAO FECHADO: ${certification.problems.join(" | ")}`
	return `${PHASE_ID} ${headline} (${measurements.join(", ")})`
}


export function installPhase(installContext) {
	try {
		const gates = installContext?.contract?.SB_GATES ?? SB_GATES
		const certification = certifyReferenceIntegrator({
			sampleCount: INSTALL_SAMPLE_COUNT,
			seed: SB_REFERENCE_SEED,
			gates,
		})
		const referenceConsole = createReferenceConsole(gates)
		const publication = publishReferenceConsole(referenceConsole)
		return {
			summary: describeCertification(certification, publication),
			certification,
			reference: referenceConsole,
		}
	} catch (installError) {
		return { summary: `${PHASE_ID} nao instalou: ${installError?.message ?? String(installError)}` }
	}
}
