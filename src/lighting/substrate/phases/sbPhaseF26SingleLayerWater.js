import { getSubstrateHostSurface } from "../runtime/substrateHostSurface.js";


import { patchOrderFor, SB_GATES } from "../sbMaterialContract.js"
import {
	beerLambertTransmittance,
	certifySingleLayerWater,
	createWaterMedium,
	extinctionPerMeter,
	packedScatteringAlbedoResidue,
	packWaterUniform,
	refractedPathLengthMeters,
	SB_WATER_CLOSURE_KIND,
	SB_WATER_MEDIUM_PRESETS,
	SB_WATER_UNIFORM_NAME,
	singleLayerWaterClosureBytes,
	waterMediumPreset,
	waterMediumPresetIds,
} from "../sbSingleLayerWaterCore.js"
import {
	SB_SINGLE_LAYER_WATER_COMPOSITION_GLSL,
	SB_SINGLE_LAYER_WATER_DECLARATIONS_GLSL,
} from "../sbSingleLayerWaterGlsl.js"

export const PHASE_ID = "SB-F26"


const WATER_FLAG = Object.freeze({
	id: "SubstrateSingleLayerWater",
	owner: PHASE_ID,
	description:
		"agua de camada unica: absorcao Beer-Lambert por profundidade, scattering simples e Fresnel sobre a reflexao ja calculada",
	defaultsByTier: Object.freeze({ fraco: false, medio: true, forte: true }),
})


const WATER_MATERIAL_PATHS = Object.freeze(["standard", "physical"])

const DECLARATIONS_PATCH_DESCRIPTOR = Object.freeze({
	id: "sbF26SingleLayerWaterDeclarations",
	anchor: "lightsPhysicalPars",
	subSlot: 0,
})

const COMPOSITION_PATCH_DESCRIPTOR = Object.freeze({
	id: "sbF26SingleLayerWaterComposition",
	anchor: "lightsFragmentEnd",
	subSlot: 1,
})

const DEFAULT_MEDIUM_ID = "tropicalShallow"
const DEFAULT_DEPTH_METERS = 1.2
const VERTICAL_VIEW_COSINE = 1
const TEXTURE_UNITS_USED = 0

function resolveWaterMedium(mediumIdOrOverrides) {
	if (typeof mediumIdOrOverrides === "string") {
		const preset = waterMediumPreset(mediumIdOrOverrides)
		if (preset) return { id: mediumIdOrOverrides, medium: preset }
	}
	if (mediumIdOrOverrides && typeof mediumIdOrOverrides === "object") {
		return { id: "custom", medium: createWaterMedium(mediumIdOrOverrides) }
	}
	return { id: DEFAULT_MEDIUM_ID, medium: SB_WATER_MEDIUM_PRESETS[DEFAULT_MEDIUM_ID] }
}

function packUniformForState(state) {
	return packWaterUniform({
		medium: state.medium,
		depthMeters: state.depthMeters,
		cosThetaView: VERTICAL_VIEW_COSINE,
	})
}

function createUniformApplier(patch, state) {
	return function applyPackedWaterUniform() {
		const packedUniform = packUniformForState(state)
		patch?.setUniform?.(SB_WATER_UNIFORM_NAME, packedUniform)
		return packedUniform
	}
}

function registerWaterPatch(patch, descriptor, glslCode) {
	const order = patchOrderFor(PHASE_ID, descriptor.subSlot)
	if (order === null) {
		return {
			id: descriptor.id,
			anchor: descriptor.anchor,
			order: null,
			accepted: false,
			reason: "sub slot fora da banda de ordem do contrato",
		}
	}
	const registration = patch?.registerPatch?.({
		id: descriptor.id,
		owner: PHASE_ID,
		anchor: descriptor.anchor,
		order,
		flagId: WATER_FLAG.id,
		materialPaths: WATER_MATERIAL_PATHS,
		code: glslCode,
		uniforms: { [SB_WATER_UNIFORM_NAME]: SB_WATER_UNIFORM_NAME },
	})
	return {
		id: descriptor.id,
		anchor: descriptor.anchor,
		order,
		accepted: registration?.accepted === true,
		reason: registration?.reason ?? null,
	}
}

function createWaterConsole(state, applyPackedWaterUniform, gates) {
	return {
		presets() {
			return waterMediumPresetIds()
		},
		medium() {
			return { id: state.mediumId, ...state.medium }
		},
		depth() {
			return state.depthMeters
		},
		uniform() {
			return packUniformForState(state)
		},
		setMedium(mediumIdOrOverrides) {
			const resolved = resolveWaterMedium(mediumIdOrOverrides)
			state.mediumId = resolved.id
			state.medium = resolved.medium
			return applyPackedWaterUniform()
		},
		setDepth(depthMeters) {
			state.depthMeters = Math.max(0, Number(depthMeters) || 0)
			return applyPackedWaterUniform()
		},
		transmittance(depthMeters) {
			const pathLengthMeters = refractedPathLengthMeters({
				depthMeters: depthMeters ?? state.depthMeters,
				cosThetaView: VERTICAL_VIEW_COSINE,
				indexOfRefraction: state.medium.indexOfRefraction,
			})
			return beerLambertTransmittance(extinctionPerMeter(state.medium), pathLengthMeters)
		},
		certify() {
			return certifySingleLayerWater({ gates })
		},
	}
}

function publishWaterConsole(waterConsole) {
	if (typeof window === "undefined") return false
	if (!getSubstrateHostSurface()) return false
	getSubstrateHostSurface().water = waterConsole
	return true
}

export function installPhase(installContext = {}) {
	const { flags, patch, telemetry } = installContext
	const gates = installContext?.contract?.SB_GATES ?? SB_GATES
	const state = {
		mediumId: DEFAULT_MEDIUM_ID,
		medium: SB_WATER_MEDIUM_PRESETS[DEFAULT_MEDIUM_ID],
		depthMeters: DEFAULT_DEPTH_METERS,
	}

	try {
		const certification = certifySingleLayerWater({ gates })
		flags?.registerFlag?.(WATER_FLAG)
		patch?.registerUniform?.(SB_WATER_UNIFORM_NAME, { owner: PHASE_ID, value: packUniformForState(state) })

		const patchResults = [
			registerWaterPatch(patch, DECLARATIONS_PATCH_DESCRIPTOR, SB_SINGLE_LAYER_WATER_DECLARATIONS_GLSL),
			registerWaterPatch(patch, COMPOSITION_PATCH_DESCRIPTOR, SB_SINGLE_LAYER_WATER_COMPOSITION_GLSL),
		]
		const closureBytes = singleLayerWaterClosureBytes()
		telemetry?.closureBytes?.(PHASE_ID, closureBytes)
		telemetry?.textureUnit?.(PHASE_ID, TEXTURE_UNITS_USED)

		const problems = [
			...certification.problems,
			...patchResults
				.filter((result) => !result.accepted)
				.map((result) => "patch recusado: " + result.id + " (" + result.reason + ")"),
		]
		for (const problem of problems) telemetry?.error?.(PHASE_ID, problem)

		const consolePublished = publishWaterConsole(
			createWaterConsole(state, createUniformApplier(patch, state), gates),
		)

		return {
			summary: {
				phaseId: PHASE_ID,
				flagId: WATER_FLAG.id,
				installed: true,
				mediumId: state.mediumId,
				depthMeters: state.depthMeters,
				closureKind: SB_WATER_CLOSURE_KIND,
				closureBytes,
				textureUnits: TEXTURE_UNITS_USED,
				registersGraphPass: false,
				registersFrameStage: false,
				materialPaths: WATER_MATERIAL_PATHS,
				patches: patchResults,
				absorptionGate: certification.absorptionGate,
				worstAbsorptionDeviation: certification.worstAbsorptionDeviation,
				worstBrightBandRelativeDeviation: certification.worstBrightBandRelativeDeviation,
				scatteringAlbedoPackingResidue: packedScatteringAlbedoResidue(state.medium),
				consolePublished,
				problems,
			},
		}
	} catch (installError) {
		const message = "falha ao instalar: " + (installError?.message ?? String(installError))
		telemetry?.error?.(PHASE_ID, message)
		return {
			summary: {
				phaseId: PHASE_ID,
				flagId: WATER_FLAG.id,
				installed: false,
				registersGraphPass: false,
				registersFrameStage: false,
				problems: [message],
			},
		}
	}
}
