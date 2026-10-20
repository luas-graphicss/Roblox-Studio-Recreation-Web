import { getSubstrateHostSurface } from "../runtime/substrateHostSurface.js";


import { passOwner, patchOrderFor } from "../sbMaterialContract.js"
import { evaluateRadialProfileGate } from "../sbDiffusionProfileCore.js"
import {
	SB_SUBSURFACE_LUT_HEIGHT,
	SB_SUBSURFACE_LUT_WIDTH,
	bakeDiffusionLutBytes,
	bakeDiffusionLutRows,
	describeSubsurface,
	resolveSubsurface,
	sanitizeMeanFreePath,
	subsurfaceClosureBytes,
} from "../sbSubsurfaceMfpCore.js"
import {
	SB_SUBSURFACE_APPLY_GLSL,
	SB_SUBSURFACE_DECLARATIONS_GLSL,
	SB_SUBSURFACE_UNIFORM_NAMES,
} from "../sbSubsurfaceGlsl.js"

export const PHASE_ID = "SB-F21"
export const PASS_NAME = "subsurfaceScattering"
export const FLAG_ID = "SubstrateSubsurface"
export const DECLARATIONS_PATCH_ID = "sbF21SubsurfaceDeclarations"
export const APPLY_PATCH_ID = "sbF21SubsurfaceApply"
export const DECLARATIONS_ANCHOR = "common"
export const APPLY_ANCHOR = "lightsFragmentEnd"
export const TEXTURE_UNITS_USED = 1


const LIVE_GATE_SAMPLE_COUNT = 8192
const IDENTITY_MEAN_FREE_PATH = [0, 0, 0]
const FALLBACK_TIER_NAME = "forte"


function findSceneMeanFreePath(scene) {
	if (!scene || typeof scene.traverse !== "function") return IDENTITY_MEAN_FREE_PATH.slice()
	let dominantChannels = IDENTITY_MEAN_FREE_PATH.slice()
	let dominantReach = 0
	scene.traverse((object) => {
		const materials = Array.isArray(object?.material) ? object.material : [object?.material]
		for (const material of materials) {
			const authored = material?.userData?.sbSlab?.subsurfaceMeanFreePath
			if (!authored) continue
			const channels = sanitizeMeanFreePath(authored)
			const reach = channels[0] + channels[1] + channels[2]
			if (reach > dominantReach) {
				dominantReach = reach
				dominantChannels = channels
			}
		}
	})
	return dominantChannels
}


function bakeDiffusionTexture(THREE, resolution, previousTexture) {
	if (!THREE?.DataTexture) {
		return { texture: previousTexture ?? null, reason: "three indisponivel no contexto do frame" }
	}
	const bytes = bakeDiffusionLutBytes({
		mode: resolution.mode,
		singleScatteringAlbedo: resolution.singleScatteringAlbedo,
		width: SB_SUBSURFACE_LUT_WIDTH,
	})
	const texture = new THREE.DataTexture(
		bytes,
		SB_SUBSURFACE_LUT_WIDTH,
		SB_SUBSURFACE_LUT_HEIGHT,
		THREE.RGBAFormat,
		THREE.UnsignedByteType,
	)
	texture.name = "sbF21DiffusionLut"
	texture.magFilter = THREE.LinearFilter
	texture.minFilter = THREE.LinearFilter
	texture.wrapS = THREE.ClampToEdgeWrapping
	texture.wrapT = THREE.ClampToEdgeWrapping
	texture.generateMipmaps = false
	texture.needsUpdate = true
	if (previousTexture?.dispose) previousTexture.dispose()
	return { texture, reason: null }
}


function createSubsurfacePass(context) {
	const state = {
		signature: null,
		texture: null,
		resolution: null,
		requestedMode: null,
		meanFreePathOverride: null,
		bakeCount: 0,
		lastReason: null,
	}

	function currentTier(frameContext) {
		return frameContext?.tier ?? context.bench?.tier?.() ?? FALLBACK_TIER_NAME
	}

	function applyMeanFreePath(channels) {
		context.patch?.setUniform(SB_SUBSURFACE_UNIFORM_NAMES.meanFreePath, channels)
	}

	function execute(frameContext) {
		const tierName = currentTier(frameContext)
		if (!context.flags?.isFlagActive(FLAG_ID, tierName)) {
			applyMeanFreePath(IDENTITY_MEAN_FREE_PATH.slice())
			return frameContext
		}

		const authoredMeanFreePath = state.meanFreePathOverride ?? findSceneMeanFreePath(frameContext?.scene)
		const resolution = resolveSubsurface({
			tierName,
			requestedMode: state.requestedMode,
			meanFreePathMillimeters: authoredMeanFreePath,
		})
		const signature = [
			resolution.mode,
			resolution.meanFreePathMillimeters.join(","),
			resolution.singleScatteringAlbedo,
		].join("|")

		if (signature !== state.signature) {
			const baked = bakeDiffusionTexture(frameContext?.THREE ?? context.bench?.THREE, resolution, state.texture)
			state.texture = baked.texture
			state.lastReason = baked.reason
			state.signature = signature
			state.bakeCount += 1
			context.patch?.setUniform(SB_SUBSURFACE_UNIFORM_NAMES.diffusionTexture, state.texture)
			context.telemetry?.pass(PASS_NAME, {
				owner: PHASE_ID,
				stub: false,
				mode: resolution.mode,
				meanFreePathMillimeters: resolution.meanFreePathMillimeters,
				bakeCount: state.bakeCount,
				lutWidth: SB_SUBSURFACE_LUT_WIDTH,
				note: baked.reason,
			})
		}

		state.resolution = resolution
		applyMeanFreePath(resolution.meanFreePathMillimeters)
		return frameContext
	}

	return { execute, state }
}


function publishConsoleSurface(pass) {
	if (typeof window === "undefined") return null
	const lab = getSubstrateHostSurface()
	const currentMeanFreePath = () => pass.state.resolution?.meanFreePathMillimeters ?? IDENTITY_MEAN_FREE_PATH.slice()

	lab.subsurface = {
		state: () => pass.state.resolution,
		describe: (options) => describeSubsurface(options ?? { meanFreePathMillimeters: currentMeanFreePath() }),
		table: () => bakeDiffusionLutRows({ mode: pass.state.resolution?.mode }),
		gate: (meanFreePathMillimeters) =>
			evaluateRadialProfileGate({
				meanFreePathMillimeters: meanFreePathMillimeters ?? currentMeanFreePath()[0],
				sampleCount: LIVE_GATE_SAMPLE_COUNT,
			}),
		setMeanFreePath: (value) => {
			pass.state.meanFreePathOverride = value === null || value === undefined ? null : sanitizeMeanFreePath(value)
			pass.state.signature = null
			return pass.state.meanFreePathOverride
		},
		setMode: (mode) => {
			pass.state.requestedMode = mode ?? null
			pass.state.signature = null
			return pass.state.requestedMode
		},
		bakeCount: () => pass.state.bakeCount,
	}
	return lab.subsurface
}

export function installPhase(installContext) {
	const notes = [
		"residuo declarado: sem alvo de render proprio (o labRenderer e dono do frame), a difusao chega ao pixel por tabela indexada pelo caminho livre medio, e nao por borrao separavel em espaco de tela; o kernel separavel ja esta pronto e provado no nucleo para quando a SB-F31 entregar o alvo.",
		"residuo declarado: o uniform de caminho livre medio e global, entao a bancada difunde pelo material de maior alcance da cena; por objeto so com o buffer de material da SB-F8.",
	]

	try {
		const flags = installContext?.flags
		const patch = installContext?.patch
		const passes = installContext?.passes
		const telemetry = installContext?.telemetry

		flags?.registerFlag({
			id: FLAG_ID,
			owner: PHASE_ID,
			description: "Difusao subsuperficial por caminho livre medio (perfil de Burley).",
			defaultsByTier: { fraco: false, medio: true, forte: true },
		})

		patch?.registerUniform(SB_SUBSURFACE_UNIFORM_NAMES.meanFreePath, {
			owner: PHASE_ID,
			value: IDENTITY_MEAN_FREE_PATH.slice(),
		})
		patch?.registerUniform(SB_SUBSURFACE_UNIFORM_NAMES.diffusionTexture, { owner: PHASE_ID, value: null })


		const anchorReport = telemetry?.get?.()?.anchors ?? {}
		const missingAnchors = [DECLARATIONS_ANCHOR, APPLY_ANCHOR].filter(
			(anchorId) => anchorReport[anchorId]?.present === false,
		)

		const uniforms = {
			[SB_SUBSURFACE_UNIFORM_NAMES.meanFreePath]: SB_SUBSURFACE_UNIFORM_NAMES.meanFreePath,
			[SB_SUBSURFACE_UNIFORM_NAMES.diffusionTexture]: SB_SUBSURFACE_UNIFORM_NAMES.diffusionTexture,
		}
		const patchIds = []

		if (missingAnchors.length === 0) {
			const declarations = patch?.registerPatch({
				id: DECLARATIONS_PATCH_ID,
				owner: PHASE_ID,
				anchor: DECLARATIONS_ANCHOR,
				order: patchOrderFor(PHASE_ID, 0),
				flagId: FLAG_ID,
				declarations: SB_SUBSURFACE_DECLARATIONS_GLSL,
				uniforms,
			})
			if (declarations?.accepted) patchIds.push(DECLARATIONS_PATCH_ID)
			else notes.push("patch de declaracoes recusado: " + (declarations?.reason ?? "motivo desconhecido"))



			if (declarations?.accepted) {
				const apply = patch?.registerPatch({
					id: APPLY_PATCH_ID,
					owner: PHASE_ID,
					anchor: APPLY_ANCHOR,
					order: patchOrderFor(PHASE_ID, 0),
					flagId: FLAG_ID,
					code: SB_SUBSURFACE_APPLY_GLSL,
					uniforms,
				})
				if (apply?.accepted) patchIds.push(APPLY_PATCH_ID)
				else notes.push("patch de aplicacao recusado: " + (apply?.reason ?? "motivo desconhecido"))
			}
		} else {
			notes.push("ancora ausente nesta revisao do three, patches nao registrados: " + missingAnchors.join(", "))
		}

		const pass = createSubsurfacePass({ patch, flags, telemetry, bench: installContext?.bench })
		const expectedPassOwner = passOwner(PASS_NAME)
		let passAccepted = false
		if (expectedPassOwner === PHASE_ID) {
			const registration = passes?.registerPass(PASS_NAME, { owner: PHASE_ID, execute: pass.execute })
			passAccepted = Boolean(registration?.accepted)
			if (!passAccepted) notes.push("passe recusado: " + (registration?.reason ?? "motivo desconhecido"))
		} else {
			notes.push("o contrato da o passe " + PASS_NAME + " para " + String(expectedPassOwner) + ", nao para a SB-F21")
		}

		const closureBytes = subsurfaceClosureBytes()
		telemetry?.textureUnit(PHASE_ID, TEXTURE_UNITS_USED)
		telemetry?.closureBytes(PHASE_ID, closureBytes)
		publishConsoleSurface(pass)

		const summary = {
			phaseId: PHASE_ID,
			installed: patchIds.length === 2 && passAccepted,
			flagId: FLAG_ID,
			pass: PASS_NAME,
			passAccepted,
			patches: patchIds,
			patchOrder: patchOrderFor(PHASE_ID, 0),
			anchors: [DECLARATIONS_ANCHOR, APPLY_ANCHOR],
			closureBytes,
			textureUnits: TEXTURE_UNITS_USED,
			lutWidth: SB_SUBSURFACE_LUT_WIDTH,
			notes,
		}
		telemetry?.phase(PHASE_ID, summary.installed ? "instalada" : "parcial", summary)
		return { summary }
	} catch (error) {
		const message = error?.message ?? String(error)
		installContext?.telemetry?.error?.("sbPhaseF21Subsurface", "instalacao falhou: " + message)
		return { summary: { phaseId: PHASE_ID, installed: false, error: message, notes } }
	}
}
