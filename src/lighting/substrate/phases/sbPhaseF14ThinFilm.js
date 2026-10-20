import { getSubstrateHostSurface } from "../runtime/substrateHostSurface.js";


import * as THREE from "three"

import { SB_GATES, patchOrderFor } from "../sbMaterialContract.js"
import { slabParameterSchema } from "../sbSlabParametersCore.js"
import { SB_SLAB_PRESETS, slabPresetIds } from "../support/src/lab/labSlabPresets.js"
import {
	SB_THIN_FILM_IOR_PARAMETER,
	SB_THIN_FILM_THICKNESS_PARAMETER,
	computeBaseFresnel,
	computeThinFilmReflectance,
	computeThinFilmSpecularTint,
	describeThinFilmInterference,
	sanitizeThinFilmParameters,
} from "../sbThinFilmCore.js"
import { describeSpectralSensitivity } from "../sbThinFilmSpectralSensitivityCore.js"
import { computeColorDeltaE76, integrateThinFilmSpectralColor } from "../sbThinFilmSpectralReferenceCore.js"
import { certifyThinFilm } from "../sbThinFilmCertificationCore.js"
import { SB_THIN_FILM_ANCHORS, SB_THIN_FILM_UNIFORM_NAME, buildThinFilmGlsl } from "../sbThinFilmGlsl.js"

export const PHASE_ID = "SB-F14"
export const FLAG_ID = "SubstrateThinFilm"

const DECLARATIONS_PATCH_ID = "sbF14ThinFilmDeclarations"
const APPLICATION_PATCH_ID = "sbF14ThinFilmApplication"
const DECLARATIONS_SUB_SLOT = 0
const APPLICATION_SUB_SLOT = 1
const PATCH_COUNT = 2


const PATCHED_MATERIAL_PATHS = Object.freeze(["standard", "terreno", "skinned"])

const FLAG_DEFAULTS_BY_TIER = Object.freeze({ fraco: false, medio: true, forte: true })
const TEXTURE_UNITS_USED = 0


const PROOF_SLAB_ID = "soapBubble"
const DEFAULT_BASE_NORMAL_REFLECTANCE = 0.04
const DEFAULT_VIEW_COSINE = 0.7


function closureBytesOf(parameterName) {
	const encoding = slabParameterSchema(parameterName)?.encoding ?? null
	const declared = Number(encoding?.closureBytes ?? encoding?.bytes)
	return Number.isFinite(declared) ? declared : 0
}

const MEASURED_CLOSURE_BYTES = closureBytesOf(SB_THIN_FILM_THICKNESS_PARAMETER) + closureBytesOf(SB_THIN_FILM_IOR_PARAMETER)


const CLOSURE_BYTES_READ = MEASURED_CLOSURE_BYTES > 0 ? MEASURED_CLOSURE_BYTES : 3


function inspectAnchors(installContext) {
	const checkAnchor = installContext?.patch?.checkAnchor
	if (typeof checkAnchor !== "function") {
		const reason = "ancora nao verificada: bancada sem checkAnchor"
		return {
			declarations: { anchorId: SB_THIN_FILM_ANCHORS.declarations, present: null, reason },
			application: { anchorId: SB_THIN_FILM_ANCHORS.application, present: null, reason },
		}
	}
	return {
		declarations: checkAnchor(THREE, SB_THIN_FILM_ANCHORS.declarations),
		application: checkAnchor(THREE, SB_THIN_FILM_ANCHORS.application),
	}
}

function registerPhaseFlag(installContext) {
	const registerFlag = installContext?.flags?.registerFlag
	if (typeof registerFlag !== "function") return { registered: false }
	registerFlag({
		id: FLAG_ID,
		owner: PHASE_ID,
		description: "Interferencia de Airy de filme fino no especular, por espessura em nanometros e IOR do filme.",
		defaultsByTier: FLAG_DEFAULTS_BY_TIER,
	})
	return { registered: true }
}


function registerThinFilmUniform(installContext, initialParameters) {
	const registerUniform = installContext?.patch?.registerUniform
	if (typeof registerUniform !== "function") return null
	const holder = registerUniform(SB_THIN_FILM_UNIFORM_NAME, {
		owner: PHASE_ID,
		value: new THREE.Vector2(initialParameters.thicknessNanometers, initialParameters.filmIor),
	})
	return holder?.value instanceof THREE.Vector2 ? holder.value : null
}


function createThinFilmUniformWriter(options) {
	const { uniformValue } = options
	let parameters = sanitizeThinFilmParameters(options?.initialParameters)

	function write() {
		if (!uniformValue) return false
		uniformValue.set(parameters.thicknessNanometers, parameters.filmIor)
		return true
	}

	write()

	return {
		read() {
			return { ...parameters }
		},


		set(nextParameters) {
			parameters = sanitizeThinFilmParameters({ ...parameters, ...nextParameters })
			write()
			return this.read()
		},
	}
}


function registerPhasePatches(installContext, options) {
	const registerPatch = installContext?.patch?.registerPatch
	if (typeof registerPatch !== "function") {
		return { accepted: [], refused: [{ id: "todos", reason: "bancada sem registerPatch" }] }
	}

	const patchUniforms = { [SB_THIN_FILM_UNIFORM_NAME]: SB_THIN_FILM_UNIFORM_NAME }
	const definitions = [
		{
			id: DECLARATIONS_PATCH_ID,
			anchor: SB_THIN_FILM_ANCHORS.declarations,
			subSlot: DECLARATIONS_SUB_SLOT,
			code: options.glsl.declarationsCode,
			anchorState: options.anchors.declarations,
		},
		{
			id: APPLICATION_PATCH_ID,
			anchor: SB_THIN_FILM_ANCHORS.application,
			subSlot: APPLICATION_SUB_SLOT,
			code: options.glsl.applicationCode,
			anchorState: options.anchors.application,
			requiresDeclarations: true,
		},
	]

	const accepted = []
	const refused = []
	let declarationsAccepted = false
	for (const definition of definitions) {
		const order = options.resolvePatchOrder(PHASE_ID, definition.subSlot)
		const entry = { id: definition.id, anchor: definition.anchor, order }
		if (typeof order !== "number") {
			refused.push({ ...entry, reason: "o contrato nao reserva ordem no sub-slot " + definition.subSlot })
			continue
		}
		if (definition.anchorState?.present === false) {
			refused.push({ ...entry, reason: "ancora ausente: " + (definition.anchorState.reason ?? definition.anchor) })
			continue
		}
		if (definition.requiresDeclarations && !declarationsAccepted) {
			refused.push({ ...entry, reason: "sem as declaracoes aceitas, a chamada no main() nao compilaria" })
			continue
		}
		const result = registerPatch({
			id: definition.id,
			owner: PHASE_ID,
			anchor: definition.anchor,
			order,
			flagId: FLAG_ID,
			code: definition.code,
			materialPaths: PATCHED_MATERIAL_PATHS,
			uniforms: patchUniforms,
		})
		if (result?.accepted) {
			accepted.push(entry)
			if (definition.id === DECLARATIONS_PATCH_ID) declarationsAccepted = true
			continue
		}
		refused.push({ ...entry, reason: result?.reason ?? "recusa sem motivo declarado" })
	}
	return { accepted, refused }
}


function declareBudget(installContext) {
	const telemetry = installContext?.telemetry
	telemetry?.textureUnit?.(PHASE_ID, TEXTURE_UNITS_USED)
	telemetry?.closureBytes?.(PHASE_ID, CLOSURE_BYTES_READ)
}

function reportProblems(installContext, refused, certification) {
	const telemetry = installContext?.telemetry
	for (const problem of refused) {
		telemetry?.error?.(PHASE_ID, "patch recusado: " + problem.id + " (" + problem.reason + ")")
	}
	for (const problem of certification.problems) {
		telemetry?.error?.(PHASE_ID, "portao aberto: " + problem)
	}
}

function resolveProofParameters() {
	const preset = SB_SLAB_PRESETS[PROOF_SLAB_ID] ?? null
	return sanitizeThinFilmParameters({
		thicknessNanometers: preset?.thinFilmThicknessNanometers,
		filmIor: preset?.thinFilmIor,
	})
}


function mirrorSample(options) {
	const sample = {
		baseNormalReflectance: options?.baseNormalReflectance ?? DEFAULT_BASE_NORMAL_REFLECTANCE,
		cosThetaView: options?.cosThetaView ?? DEFAULT_VIEW_COSINE,
		thicknessNanometers: options?.thicknessNanometers,
		filmIor: options?.filmIor,
	}
	const reflectance = computeThinFilmReflectance(sample)
	return {
		...sample,
		reflectance,
		tint: computeThinFilmSpecularTint(sample),
		baseFresnel: computeBaseFresnel(sample.baseNormalReflectance, sample.cosThetaView),
		interference: describeThinFilmInterference(sample),
	}
}

function createThinFilmConsole(options) {
	const { uniformWriter, gates, glsl } = options
	return {
		flagId: FLAG_ID,
		uniformName: SB_THIN_FILM_UNIFORM_NAME,
		gates: { maxThinFilmDeltaE76: gates.maxThinFilmDeltaE76 },
		parameterNames: [SB_THIN_FILM_THICKNESS_PARAMETER, SB_THIN_FILM_IOR_PARAMETER],

		read: () => uniformWriter.read(),
		set: (parameters) => uniformWriter.set(parameters),


		preset(slabId) {
			const preset = SB_SLAB_PRESETS[slabId ?? PROOF_SLAB_ID] ?? null
			if (preset === null) return { error: "preset desconhecido: " + slabId, available: slabPresetIds() }
			return uniformWriter.set({
				thicknessNanometers: preset.thinFilmThicknessNanometers,
				filmIor: preset.thinFilmIor,
			})
		},


		mirror(options) {
			const parameters = uniformWriter.read()
			return mirrorSample({ ...parameters, ...options })
		},


		reference(options) {
			const mirror = this.mirror(options)
			const referenceColor = integrateThinFilmSpectralColor(mirror)
			return {
				...mirror,
				referenceColor,
				deltaE76: computeColorDeltaE76(mirror.reflectance, referenceColor),
			}
		},

		sensitivity: () => describeSpectralSensitivity(),
		certify: () => certifyThinFilm({ gates }),
		glsl: () => glsl,
	}
}


function publishConsoleApi(consoleApi) {
	const lab = typeof window === "undefined" ? null : getSubstrateHostSurface()
	if (!lab) return false
	lab.thinFilm = consoleApi
	return true
}


function describeInstall(state) {
	const { certification, patches, flag, consolePublished, parameters, proofParameters } = state
	const { spectralAgreement, neutrality, range, visibility, convergence } = certification
	const measurements = [
		"pior deltaE76 " +
			spectralAgreement.worstDeltaE76.toFixed(3) +
			" e medio " +
			spectralAgreement.averageDeltaE76.toFixed(3) +
			" vs integracao espectral densa, portao " +
			spectralAgreement.tolerance +
			", em " +
			spectralAgreement.angleCount +
			" angulos e " +
			spectralAgreement.thicknessCount +
			" espessuras (" +
			spectralAgreement.sampleCount +
			" amostras)",
		neutrality.ok
			? "espessura zero identica bit a bit em " + neutrality.checkedCount + " vistas"
			: "espessura zero MUDOU a imagem",
		"refletancia " + range.minimumReflectance.toFixed(4) + ".." + range.maximumReflectance.toFixed(4) + " em " + range.sampleCount + " amostras",
		"efeito visivel com deltaE76 " + visibility.maximumDeltaE76.toFixed(2) + " (minimo " + visibility.minimumRequired + ")",
		"franja de " +
			convergence.farThicknessNanometers +
		" nm em " +
			(convergence.ratio * 100).toFixed(1) +
			"% da de " +
			convergence.nearThicknessNanometers +
			" nm",
		"uniform " + SB_THIN_FILM_UNIFORM_NAME + " em " + parameters.thicknessNanometers + " nm e IOR " + parameters.filmIor,
		patches.accepted.length + "/" + PATCH_COUNT + " patches aceitos em " + PATCHED_MATERIAL_PATHS.join(", "),
		flag.registered ? "flag " + FLAG_ID : "sem flag (bancada ausente)",
		TEXTURE_UNITS_USED + " unidade de textura e " + CLOSURE_BYTES_READ + " bytes de closure declarados",
	]
	if (consolePublished) {
		measurements.push(
			"__sbLab.thinFilm publicado (preset " +
				PROOF_SLAB_ID +
				" acende " +
				proofParameters.thicknessNanometers +
				" nm)",
		)
	}
	const headline = certification.ok ? "filme fino certificado" : "PORTAO NAO FECHADO: " + certification.problems.join(" | ")
	const refusals =
		patches.refused.length === 0
			? ""
			: " | patches recusados: " + patches.refused.map((entry) => entry.id + " (" + entry.reason + ")").join(", ")
	return PHASE_ID + " " + headline + " (" + measurements.join(", ") + ")" + refusals
}


export function installPhase(installContext) {
	try {
		const contract = installContext?.contract ?? null
		const gates = contract?.SB_GATES ?? SB_GATES
		const resolvePatchOrder = contract?.patchOrderFor ?? patchOrderFor

		const flag = registerPhaseFlag(installContext)

		const initialParameters = sanitizeThinFilmParameters({ thicknessNanometers: 0 })
		const uniformValue = registerThinFilmUniform(installContext, initialParameters)
		const uniformWriter = createThinFilmUniformWriter({ uniformValue, initialParameters })

		const glsl = buildThinFilmGlsl()
		const anchors = inspectAnchors(installContext)
		const patches = registerPhasePatches(installContext, { glsl, anchors, resolvePatchOrder })
		declareBudget(installContext)

		const certification = certifyThinFilm({ gates })
		reportProblems(installContext, patches.refused, certification)

		const consoleApi = createThinFilmConsole({ uniformWriter, gates, glsl })
		const consolePublished = publishConsoleApi(consoleApi)

		return {
			summary: describeInstall({
				certification,
				patches,
				flag,
				consolePublished,
				parameters: uniformWriter.read(),
				proofParameters: resolveProofParameters(),
			}),
			certification,
			patches,
			anchors,
			flagId: FLAG_ID,
			uniforms: { thinFilm: Boolean(uniformValue) },
		}
	} catch (installError) {
		const message = installError?.message ?? String(installError)
		installContext?.telemetry?.error?.(PHASE_ID, message)
		return { summary: PHASE_ID + " nao instalou: " + message, failed: true }
	}
}
