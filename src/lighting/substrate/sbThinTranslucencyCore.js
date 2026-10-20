import { evaluateSlabDiffuseBsdf } from "./sbSlabDiffuseCore.js"
import {
	SB_MINIMUM_CHANNEL_TRANSMITTANCE,
	SB_REFERENCE_THICKNESS,
	absorbanceFromTransmittanceColor,
	normalizeTransmittanceColor,
	transmittanceFromAbsorbance,
} from "./sbTransmittanceCore.js"
import {
	SB_DEFAULT_THIN_TRANSLUCENCY_PROFILE_ID,
	thinTranslucencyProfile,
	thinTranslucencyProfileIds,
} from "./sbThinTranslucencyProfiles.js"


export const SB_THIN_SLAB_EXTINCTION_PER_MILLIMETER = 10


export const SB_THIN_SHADER_PHASE_ASYMMETRY = 0.55

export const SB_THIN_TRANSLUCENCY_LIMITS = Object.freeze({
	minimumThicknessMillimeters: 0,

	maximumThicknessMillimeters: 4,

	minimumPhaseAsymmetry: -0.95,
	maximumPhaseAsymmetry: 0.95,
})


export const SB_THIN_FRONT_DIFFUSE_MODEL = "SB-F17 energyNormalizedRetro"
export const SB_THIN_FRONT_DIFFUSE_FALLBACK_MODEL = "lambert (piso, SB-F17 indisponivel)"

const CHANNEL_COUNT = 3
const FULL_SPHERE_STERADIANS = 4 * Math.PI
const RECIPROCAL_PI = 1 / Math.PI
const MINIMUM_PHASE_DENOMINATOR = 1e-4
const LUMINANCE_WEIGHTS = Object.freeze([0.2126, 0.7152, 0.0722])
const DEFAULT_ALBEDO = Object.freeze([0, 0, 0])
const DEFAULT_LIGHT_COLOR = Object.freeze([1, 1, 1])
const DEFAULT_REFERENCE_ROUGHNESS = 0.5
const SURFACE_NORMAL = Object.freeze([0, 0, 1])
const DEFAULT_INCIDENCE_ANGLE_RADIANS = Math.PI / 4
const DEFAULT_POLAR_STEPS = 48
const DEFAULT_AZIMUTH_STEPS = 96
const ENERGY_TOLERANCE = 1e-9

function isFiniteNumber(value) {
	return typeof value === "number" && Number.isFinite(value)
}

function clampToRange(value, minimum, maximum) {
	return Math.min(maximum, Math.max(minimum, value))
}

function sanitizeChannels(raw, fallbackChannels, minimum, maximum) {
	if (isFiniteNumber(raw)) {
		const replicated = clampToRange(raw, minimum, maximum)
		return [replicated, replicated, replicated]
	}
	if (!Array.isArray(raw) || raw.length !== CHANNEL_COUNT) return fallbackChannels.slice()
	return raw.map((channel, index) =>
		isFiniteNumber(channel) ? clampToRange(channel, minimum, maximum) : fallbackChannels[index],
	)
}

function dotProduct(left, right) {
	return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function normalizeVector(vector) {
	if (!Array.isArray(vector) || vector.length !== CHANNEL_COUNT) return SURFACE_NORMAL.slice()
	const squaredLength = dotProduct(vector, vector)
	if (!Number.isFinite(squaredLength) || 0 >= squaredLength) return SURFACE_NORMAL.slice()
	const length = Math.sqrt(squaredLength)
	return vector.map((component) => component / length)
}

export function luminanceOf(channels) {
	return channels.reduce((total, channel, index) => total + channel * LUMINANCE_WEIGHTS[index], 0)
}

export function sanitizeAlbedo(raw) {
	return sanitizeChannels(raw, DEFAULT_ALBEDO, 0, 1)
}


export function sanitizeLightColor(raw) {
	return sanitizeChannels(raw, DEFAULT_LIGHT_COLOR, 0, Number.MAX_VALUE)
}


export function sanitizeThicknessMillimeters(raw) {
	if (!isFiniteNumber(raw)) return SB_THIN_TRANSLUCENCY_LIMITS.minimumThicknessMillimeters
	return clampToRange(
		raw,
		SB_THIN_TRANSLUCENCY_LIMITS.minimumThicknessMillimeters,
		SB_THIN_TRANSLUCENCY_LIMITS.maximumThicknessMillimeters,
	)
}

export function sanitizePhaseAsymmetry(raw) {
	if (!isFiniteNumber(raw)) return 0
	return clampToRange(
		raw,
		SB_THIN_TRANSLUCENCY_LIMITS.minimumPhaseAsymmetry,
		SB_THIN_TRANSLUCENCY_LIMITS.maximumPhaseAsymmetry,
	)
}

export function sanitizeReferenceRoughness(raw) {
	if (!isFiniteNumber(raw)) return DEFAULT_REFERENCE_ROUGHNESS
	return clampToRange(raw, 0, 1)
}


export function sanitizeThinTranslucency(raw) {
	const source = raw === null || typeof raw !== "object" ? {} : raw
	return {
		transmittanceColor: normalizeTransmittanceColor(source.transmittanceColor),
		thicknessMillimeters: sanitizeThicknessMillimeters(source.thicknessMillimeters),
		phaseAsymmetry: sanitizePhaseAsymmetry(source.phaseAsymmetry),
		referenceRoughness: sanitizeReferenceRoughness(source.referenceRoughness),
	}
}

export function opticalDepthFor(thicknessMillimeters) {
	const thickness = sanitizeThicknessMillimeters(thicknessMillimeters)
	return (thickness * SB_THIN_SLAB_EXTINCTION_PER_MILLIMETER) / SB_REFERENCE_THICKNESS
}


export function interactionFraction(opticalDepth) {
	if (!isFiniteNumber(opticalDepth) || 0 >= opticalDepth) return 0
	return 1 - Math.exp(-opticalDepth)
}


export function survivalFractions(transmittanceColor, opticalDepth) {
	return transmittanceFromAbsorbance(
		absorbanceFromTransmittanceColor(transmittanceColor),
		Math.max(opticalDepth, 0),
	)
}

export function thinTransmittance(rawThinTranslucency) {
	const thinTranslucency = sanitizeThinTranslucency(rawThinTranslucency)
	const opticalDepth = opticalDepthFor(thinTranslucency.thicknessMillimeters)
	const interaction = interactionFraction(opticalDepth)
	if (interaction === 0) return [0, 0, 0]
	return survivalFractions(thinTranslucency.transmittanceColor, opticalDepth).map(
		(survival) => interaction * survival,
	)
}


export function transmittanceWithinEnergyBudget(transmittance, albedo) {
	const sanitizedAlbedo = sanitizeAlbedo(albedo)
	return transmittance.map((channel, index) => Math.min(channel, Math.max(0, 1 - sanitizedAlbedo[index])))
}


export function resolveThinTranslucency(request) {
	const source = request === null || typeof request !== "object" ? {} : request
	const thinTranslucency = sanitizeThinTranslucency(source.thinTranslucency ?? source)
	const albedo = sanitizeAlbedo(source.albedo)
	const opticalDepth = opticalDepthFor(thinTranslucency.thicknessMillimeters)
	const rawTransmittance = thinTransmittance(thinTranslucency)
	const transmittance = transmittanceWithinEnergyBudget(rawTransmittance, albedo)
	return {
		...thinTranslucency,
		albedo,
		opticalDepth,
		interaction: interactionFraction(opticalDepth),
		survival: survivalFractions(thinTranslucency.transmittanceColor, opticalDepth),
		rawTransmittance,
		transmittance,
		transmittanceLuminance: luminanceOf(transmittance),
		clampedByEnergyBudget: rawTransmittance.some(
			(channel, index) => channel > transmittance[index] + ENERGY_TOLERANCE,
		),
	}
}


export function henyeyGreensteinPhase(scatteringCosine, phaseAsymmetry) {
	const asymmetry = sanitizePhaseAsymmetry(phaseAsymmetry)
	const squaredAsymmetry = asymmetry * asymmetry
	const cosine = clampToRange(isFiniteNumber(scatteringCosine) ? scatteringCosine : 0, -1, 1)
	const denominator = Math.max(1 + squaredAsymmetry - 2 * asymmetry * cosine, MINIMUM_PHASE_DENOMINATOR)
	return (1 - squaredAsymmetry) / (FULL_SPHERE_STERADIANS * Math.pow(denominator, 1.5))
}


export function scatteringCosineFor(lightDirection, outgoingDirection) {
	const incomingPropagation = normalizeVector(lightDirection).map((component) => -component)
	return clampToRange(dotProduct(incomingPropagation, normalizeVector(outgoingDirection)), -1, 1)
}


export function backlitCosine(surfaceNormal, lightDirection) {
	return Math.max(0, -dotProduct(normalizeVector(surfaceNormal), normalizeVector(lightDirection)))
}


export function thinTransmissionBtdf(request) {
	const transmittance = normalizeTransmittanceColor(request?.transmittance)
	const phase = henyeyGreensteinPhase(
		scatteringCosineFor(request?.lightDirection, request?.outgoingDirection),
		request?.phaseAsymmetry,
	)
	return transmittance.map((channel) => channel * phase)
}


export function transmittedRadiance(request) {
	const cosine = backlitCosine(request?.surfaceNormal ?? SURFACE_NORMAL, request?.lightDirection)
	if (0 >= cosine) return [0, 0, 0]
	const lightColor = sanitizeLightColor(request?.lightColor)
	return thinTransmissionBtdf(request).map((channel, index) => channel * cosine * lightColor[index])
}


export function transmittedEnvironmentRadiance(transmittance, backsideIrradiance) {
	const irradiance = sanitizeLightColor(backsideIrradiance)
	return normalizeTransmittanceColor(transmittance).map(
		(channel, index) => channel * RECIPROCAL_PI * irradiance[index],
	)
}

function backsideLightDirectionFor(incidenceAngleRadians) {
	const angle = isFiniteNumber(incidenceAngleRadians) ? incidenceAngleRadians : DEFAULT_INCIDENCE_ANGLE_RADIANS
	return [Math.sin(angle), 0, -Math.cos(angle)]
}

function frontLightDirectionFor(incidenceAngleRadians) {
	const angle = isFiniteNumber(incidenceAngleRadians) ? incidenceAngleRadians : DEFAULT_INCIDENCE_ANGLE_RADIANS
	return [Math.sin(angle), 0, Math.cos(angle)]
}


export function frontDiffuseBsdf(albedo, referenceRoughness, lightDirection) {
	try {
		const byChannel = evaluateSlabDiffuseBsdf({
			slab: { albedo, roughness: referenceRoughness },
			viewDirection: SURFACE_NORMAL.slice(),
			lightDirection,
		})
		if (Array.isArray(byChannel) && byChannel.length === CHANNEL_COUNT && byChannel.every(isFiniteNumber)) {
			return { byChannel, model: SB_THIN_FRONT_DIFFUSE_MODEL }
		}
	} catch {

	}
	return {
		byChannel: sanitizeAlbedo(albedo).map((channel) => channel * RECIPROCAL_PI),
		model: SB_THIN_FRONT_DIFFUSE_FALLBACK_MODEL,
	}
}


export function integratePhaseOverSphere(phaseAsymmetry, polarSteps) {
	const polarTotal = polarSteps ?? DEFAULT_POLAR_STEPS * 4
	const polarStep = Math.PI / polarTotal
	let total = 0
	for (let polarIndex = 0; polarTotal > polarIndex; polarIndex += 1) {
		const polarAngle = (polarIndex + 0.5) * polarStep
		const phase = henyeyGreensteinPhase(Math.cos(polarAngle), phaseAsymmetry)
		total += phase * Math.sin(polarAngle) * polarStep * 2 * Math.PI
	}
	return total
}


export function integrateTransmittedEnergy(request) {
	const resolved = resolveThinTranslucency(request)
	const lightDirection = backsideLightDirectionFor(request?.incidenceAngleRadians)
	const polarSteps = request?.polarSteps ?? DEFAULT_POLAR_STEPS
	const azimuthSteps = request?.azimuthSteps ?? DEFAULT_AZIMUTH_STEPS
	const polarStep = Math.PI / 2 / polarSteps
	const azimuthStep = (2 * Math.PI) / azimuthSteps
	let lobeFraction = 0
	for (let polarIndex = 0; polarSteps > polarIndex; polarIndex += 1) {
		const polarAngle = (polarIndex + 0.5) * polarStep
		const sinPolar = Math.sin(polarAngle)
		const cosPolar = Math.cos(polarAngle)
		for (let azimuthIndex = 0; azimuthSteps > azimuthIndex; azimuthIndex += 1) {
			const azimuthAngle = (azimuthIndex + 0.5) * azimuthStep
			const outgoingDirection = [sinPolar * Math.cos(azimuthAngle), sinPolar * Math.sin(azimuthAngle), cosPolar]
			const phase = henyeyGreensteinPhase(
				scatteringCosineFor(lightDirection, outgoingDirection),
				resolved.phaseAsymmetry,
			)
			lobeFraction += phase * cosPolar * sinPolar * polarStep * azimuthStep
		}
	}
	const byChannel = resolved.transmittance.map((channel) => channel * lobeFraction)
	const maximumChannel = Math.max(...byChannel)
	const transmittanceMaximum = Math.max(...resolved.transmittance)
	return {
		lobeFraction,
		byChannel,
		maximumChannel,
		transmittanceMaximum,
		withinBudget:
			transmittanceMaximum + ENERGY_TOLERANCE >= maximumChannel && 1 + ENERGY_TOLERANCE >= transmittanceMaximum,
	}
}


export function measureFrontToBackRatio(request) {
	const resolved = resolveThinTranslucency(request)
	const incidenceAngleRadians = isFiniteNumber(request?.incidenceAngleRadians)
		? request.incidenceAngleRadians
		: DEFAULT_INCIDENCE_ANGLE_RADIANS
	const lightColor = sanitizeLightColor(request?.lightColor)
	const cosineIncidence = Math.max(Math.cos(incidenceAngleRadians), 0)
	const front = frontDiffuseBsdf(
		resolved.albedo,
		resolved.referenceRoughness,
		frontLightDirectionFor(incidenceAngleRadians),
	)
	const frontByChannel = front.byChannel.map((channel, index) => channel * cosineIncidence * lightColor[index])
	const backByChannel = transmittedRadiance({
		transmittance: resolved.transmittance,
		phaseAsymmetry: resolved.phaseAsymmetry,
		surfaceNormal: SURFACE_NORMAL.slice(),
		lightDirection: backsideLightDirectionFor(incidenceAngleRadians),
		outgoingDirection: SURFACE_NORMAL.slice(),
		lightColor,
	})
	const frontLuminance = luminanceOf(frontByChannel)
	const backLuminance = luminanceOf(backByChannel)
	return {
		incidenceAngleRadians,
		frontModel: front.model,
		frontByChannel,
		backByChannel,
		frontLuminance,
		backLuminance,
		ratio: 0 >= backLuminance ? null : frontLuminance / backLuminance,
		transmittance: resolved.transmittance,
	}
}


export function measureThinTranslucencyProfile(profileId, options) {
	const profile = thinTranslucencyProfile(profileId)
	if (profile === null) return null
	const measurementRequest = {
		thinTranslucency: {
			transmittanceColor: profile.transmittanceColor,
			thicknessMillimeters: profile.thicknessMillimeters,
			phaseAsymmetry: profile.phaseAsymmetry,
			referenceRoughness: profile.referenceRoughness,
		},
		albedo: profile.referenceAlbedo,
		incidenceAngleRadians: options?.incidenceAngleRadians,
	}
	return {
		profileId,
		label: profile.label,
		...resolveThinTranslucency(measurementRequest),
		energy: integrateTransmittedEnergy({ ...measurementRequest, ...options }),
		frontToBack: measureFrontToBackRatio(measurementRequest),
	}
}


export function findPeakThicknessMillimeters(rawThinTranslucency, sampleCount) {
	const thinTranslucency = sanitizeThinTranslucency(rawThinTranslucency)
	const total = sampleCount ?? 800
	const maximumThickness = SB_THIN_TRANSLUCENCY_LIMITS.maximumThicknessMillimeters
	let peakThickness = 0
	let peakLuminance = 0
	for (let sampleIndex = 0; total >= sampleIndex; sampleIndex += 1) {
		const thicknessMillimeters = (sampleIndex / total) * maximumThickness
		const luminance = luminanceOf(thinTransmittance({ ...thinTranslucency, thicknessMillimeters }))
		if (luminance > peakLuminance) {
			peakLuminance = luminance
			peakThickness = thicknessMillimeters
		}
	}
	return { thicknessMillimeters: peakThickness, luminance: peakLuminance }
}

export function packThinTranslucencyUniform(rawThinTranslucency) {
	const thinTranslucency = sanitizeThinTranslucency(rawThinTranslucency)
	return [...thinTranslucency.transmittanceColor, thinTranslucency.thicknessMillimeters]
}

export function unpackThinTranslucencyUniform(packedValue) {
	if (!Array.isArray(packedValue) || packedValue.length !== CHANNEL_COUNT + 1) {
		return sanitizeThinTranslucency(null)
	}
	return sanitizeThinTranslucency({
		transmittanceColor: packedValue.slice(0, CHANNEL_COUNT),
		thicknessMillimeters: packedValue[CHANNEL_COUNT],
	})
}


export function findThinTranslucencyProblems() {
	const problems = []
	const limits = SB_THIN_TRANSLUCENCY_LIMITS

	if (0 >= SB_THIN_SLAB_EXTINCTION_PER_MILLIMETER) {
		problems.push("a extincao da lamina tem de ser positiva")
	}
	if (SB_THIN_SHADER_PHASE_ASYMMETRY !== sanitizePhaseAsymmetry(SB_THIN_SHADER_PHASE_ASYMMETRY)) {
		problems.push("a assimetria do shader esta fora da faixa segura de Henyey-Greenstein")
	}
	if (SB_MINIMUM_CHANNEL_TRANSMITTANCE >= 0.001) {
		problems.push("o piso de canal de sbTransmittanceCore ficou alto demais para lamina fina")
	}

	thinTranslucencyProfileIds().forEach((profileId) => {
		const profile = thinTranslucencyProfile(profileId)
		if (profile.transmittanceColor.length !== CHANNEL_COUNT) {
			problems.push(`${profileId}: transmittanceColor precisa de 3 canais`)
		}
		if (profile.referenceAlbedo.length !== CHANNEL_COUNT) {
			problems.push(`${profileId}: referenceAlbedo precisa de 3 canais`)
		}
		if (profile.thicknessMillimeters > limits.maximumThicknessMillimeters) {
			problems.push(`${profileId}: espessura acima do teto declarado`)
		}
		if (limits.minimumThicknessMillimeters >= profile.thicknessMillimeters) {
			problems.push(`${profileId}: perfil sem espessura nao transmite nada`)
		}
		if (profile.phaseAsymmetry !== sanitizePhaseAsymmetry(profile.phaseAsymmetry)) {
			problems.push(`${profileId}: assimetria fora da faixa segura`)
		}
		const measurement = measureThinTranslucencyProfile(profileId)
		if (!measurement.energy.withinBudget) {
			problems.push(`${profileId}: energia transmitida acima da transmitancia`)
		}
		if (measurement.frontToBack.ratio === null) {
			problems.push(`${profileId}: contraluz nao produziu resposta mensuravel`)
		}
		if (measurement.frontToBack.frontModel !== SB_THIN_FRONT_DIFFUSE_MODEL) {
			problems.push(`${profileId}: a resposta da frente caiu no piso -- ${measurement.frontToBack.frontModel}`)
		}
	})

	return problems
}


export function describeThinTranslucency(options) {
	return {
		extinctionPerMillimeter: SB_THIN_SLAB_EXTINCTION_PER_MILLIMETER,
		shaderPhaseAsymmetry: SB_THIN_SHADER_PHASE_ASYMMETRY,
		referenceThickness: SB_REFERENCE_THICKNESS,
		limits: SB_THIN_TRANSLUCENCY_LIMITS,
		defaultProfileId: SB_DEFAULT_THIN_TRANSLUCENCY_PROFILE_ID,
		profiles: thinTranslucencyProfileIds().map((profileId) => measureThinTranslucencyProfile(profileId, options)),
		problems: findThinTranslucencyProblems(),
	}
}

export const SB_THIN_TRANSLUCENCY_MATERIAL_DATA_KEY = "sbThinTranslucency"
export const SB_THIN_TRANSLUCENCY_PER_SLOT_UNIFORM_NAME = "uSbRuntimeThin"
export const SB_THIN_TRANSLUCENCY_SLOT_COUNT = 3
export const SB_THIN_TRANSLUCENCY_OPAQUE_UNIFORM = Object.freeze([0, 0, 0, 0])

export function resolveMaterialThinTranslucency(materialData, resolveProfile) {
	const authored = materialData?.[SB_THIN_TRANSLUCENCY_MATERIAL_DATA_KEY]
	if (authored === null || typeof authored !== "object") {
		return { active: false, source: "none", profileId: null, packed: [...SB_THIN_TRANSLUCENCY_OPAQUE_UNIFORM] }
	}
	if (typeof authored.profileId === "string") {
		const profile = typeof resolveProfile === "function" ? resolveProfile(authored.profileId) : null
		if (profile === null || profile === undefined) {
			return { active: false, source: "unknownProfile", profileId: authored.profileId, packed: [...SB_THIN_TRANSLUCENCY_OPAQUE_UNIFORM] }
		}
		const packed = packThinTranslucencyUniform(profile)
		return { active: packed[CHANNEL_COUNT] > 0, source: "profile", profileId: authored.profileId, packed }
	}
	const packed = packThinTranslucencyUniform(authored)
	return { active: packed[CHANNEL_COUNT] > 0, source: "explicit", profileId: null, packed }
}

export function coatSlotsOf(parents) {
	const coats = new Set()
	for (const parent of Array.isArray(parents) || ArrayBuffer.isView(parents) ? parents : []) {
		if (Number.isInteger(parent) && parent >= 0) coats.add(parent)
		else if (Number.isFinite(parent) && parent >= 0) coats.add(Math.round(parent))
	}
	return coats
}

export function packThinTranslucencyPerSlot(request = {}) {
	const target = request.target ?? new Float32Array(SB_THIN_TRANSLUCENCY_SLOT_COUNT * (CHANNEL_COUNT + 1))
	target.fill(0)
	const closures = Array.isArray(request.closures) ? request.closures : []
	const coats = coatSlotsOf(request.parents)
	const packed = Array.isArray(request.packed) ? request.packed : [...SB_THIN_TRANSLUCENCY_OPAQUE_UNIFORM]
	const applied = []
	closures.slice(0, SB_THIN_TRANSLUCENCY_SLOT_COUNT).forEach((closure, slot) => {
		const kind = closure?.kind ?? closure?.bsdf ?? "slab"
		if (kind !== "slab" || coats.has(slot) || !(packed[CHANNEL_COUNT] > 0)) return
		target.set(packed, slot * (CHANNEL_COUNT + 1))
		applied.push(slot)
	})
	return { target, applied, coatSlots: [...coats].sort() }
}
