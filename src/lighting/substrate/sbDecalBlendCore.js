import { SB_NORMAL_BLEND_MODES, blendNormals, normalizeNormal } from "./sbNormalBlendCore.js"
import { blendSlabParameters } from "./sbHorizontalMixingCore.js"
import { normalFromEncodedChannels, orderDecals, sanitizeDecal } from "./sbDecalBufferCore.js"

export const SB_DECAL_BLEND_OWNER = "SB-F29"
export const SB_DECAL_BLEND_NORMAL_MODE = SB_NORMAL_BLEND_MODES.linear
export const SB_DECAL_BLENDED_FIELD_NAMES = Object.freeze(["roughness", "normal"])

const DEFAULT_SURFACE_NORMAL = Object.freeze([0, 0, 1])
const NORMAL_SWEEP_SAMPLE_COUNT = 17
const UNIT_LENGTH_TOLERANCE = 1e-6
const ENDPOINT_TOLERANCE = 1e-9

function isFiniteNumber(value) {
	return typeof value === "number" && Number.isFinite(value)
}


export function blendDecalRoughness(baseRoughness, decalRoughness, opacity) {
	const blended = blendSlabParameters({ roughness: baseRoughness }, { roughness: decalRoughness }, opacity)
	return blended.roughness
}

export function blendDecalNormal(baseNormal, decalNormal, opacity) {
	return blendNormals(baseNormal, decalNormal, opacity, { mode: SB_DECAL_BLEND_NORMAL_MODE })
}


export function surfaceNormalOf(parameters) {
	const storedNormal = parameters?.normal
	if (!Array.isArray(storedNormal)) return normalizeNormal(DEFAULT_SURFACE_NORMAL)
	if (storedNormal.length >= 3) return normalizeNormal(storedNormal)
	if (2 === storedNormal.length) return normalFromEncodedChannels(storedNormal[0], storedNormal[1])
	return normalizeNormal(DEFAULT_SURFACE_NORMAL)
}


export function applyDecalToParameters(parameters, decal) {
	const sanitizedDecal = sanitizeDecal(decal)
	if (0 === sanitizedDecal.opacity) return parameters

	const source = parameters === null || typeof parameters !== "object" ? {} : parameters
	const baseRoughness = isFiniteNumber(source.roughness) ? source.roughness : 0
	const blendedNormal = blendDecalNormal(surfaceNormalOf(source), sanitizedDecal.normal, sanitizedDecal.opacity)

	return {
		...source,
		roughness: blendDecalRoughness(baseRoughness, sanitizedDecal.roughness, sanitizedDecal.opacity),
		normal: [blendedNormal[0], blendedNormal[1], blendedNormal[2]],
	}
}


export function resolveDecalsIntoParameters(parameters, decals) {
	const { ordered, dropped, refusals } = orderDecals(decals)
	const appliedDecalIds = []
	let resolvedParameters = parameters
	for (const decal of ordered) {
		const nextParameters = applyDecalToParameters(resolvedParameters, decal)
		if (nextParameters !== resolvedParameters) appliedDecalIds.push(decal.id)
		resolvedParameters = nextParameters
	}
	return {
		parameters: resolvedParameters,
		appliedDecalIds,
		dropped,
		refusals,
		changed: resolvedParameters !== parameters,
	}
}


export function resolveDecalsIntoClosureRecord(record, decals) {
	const source = record === null || typeof record !== "object" ? {} : record
	const resolution = resolveDecalsIntoParameters(source.parameters, decals)
	return {
		record: resolution.changed ? { ...source, parameters: resolution.parameters } : record,
		appliedDecalIds: resolution.appliedDecalIds,
		dropped: resolution.dropped,
		refusals: resolution.refusals,
		changed: resolution.changed,
	}
}

export function createReferenceSlabParameters() {
	return {
		albedo: [0.62, 0.31, 0.18],
		f0: [0.04, 0.04, 0.04],
		roughness: 0.22,
		normal: [0.1, -0.15, 0.98],
		opacity: 1,
	}
}

export function createReferenceDecals() {
	return [
		{ id: "mud", sortOrder: 10, roughness: 0.85, normal: [0.35, 0.12, 0.93], opacity: 0.75 },
		{ id: "scratch", sortOrder: 20, roughness: 0.4, normal: [-0.2, 0.3, 0.93], opacity: 0.5 },
	]
}

function vectorLength(vector) {
	return Math.sqrt(vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2])
}

function findIdentityProblems() {
	const problems = []
	const parameters = createReferenceSlabParameters()

	const withoutDecals = resolveDecalsIntoParameters(parameters, [])
	if (!Object.is(withoutDecals.parameters, parameters)) {
		problems.push("sem decal a resolucao deveria devolver o mesmo objeto de parametros")
	}
	if (withoutDecals.changed) problems.push("sem decal a resolucao se declarou alterada")

	const transparentDecal = { id: "invisible", sortOrder: 0, roughness: 1, normal: [0.9, 0, 0.44], opacity: 0 }
	const withTransparentDecal = resolveDecalsIntoParameters(parameters, [transparentDecal])
	if (!Object.is(withTransparentDecal.parameters, parameters)) {
		problems.push("decal com opacidade 0 mexeu nos parametros")
	}
	return problems
}

function findChangedFieldProblems() {
	const problems = []
	const parameters = createReferenceSlabParameters()
	const decal = { id: "paint", sortOrder: 0, roughness: 0.9, normal: [0.3, 0.1, 0.95], opacity: 1 }
	const resolved = resolveDecalsIntoParameters(parameters, [decal]).parameters

	if (!(Math.abs(resolved.roughness - decal.roughness) > ENDPOINT_TOLERANCE ? false : true)) {
		problems.push(`com opacidade 1 a rugosidade deveria virar a do decal e virou ${resolved.roughness}`)
	}
	const resolvedNormal = surfaceNormalOf(resolved)
	const decalNormal = sanitizeDecal(decal).normal
	for (let axisIndex = 0; 3 > axisIndex; axisIndex += 1) {
		if (Math.abs(resolvedNormal[axisIndex] - decalNormal[axisIndex]) > 1e-6) {
			problems.push("com opacidade 1 a normal deveria virar a do decal")
			break
		}
	}
	for (const fieldName of Object.keys(parameters)) {
		if (SB_DECAL_BLENDED_FIELD_NAMES.includes(fieldName)) continue
		if (!Object.is(resolved[fieldName], parameters[fieldName])) {
			problems.push(`o decal mexeu no campo ${fieldName}, que nao e dele`)
		}
	}
	return problems
}

function findSweepProblems() {
	const problems = []
	const parameters = createReferenceSlabParameters()
	const baseNormal = surfaceNormalOf(parameters)
	const decalNormal = [0.5, -0.4, 0.76]
	let previousRoughness = null

	for (let sampleIndex = 0; NORMAL_SWEEP_SAMPLE_COUNT > sampleIndex; sampleIndex += 1) {
		const opacity = sampleIndex / (NORMAL_SWEEP_SAMPLE_COUNT - 1)
		const blendedNormal = blendDecalNormal(baseNormal, decalNormal, opacity)
		if (Math.abs(vectorLength(blendedNormal) - 1) > UNIT_LENGTH_TOLERANCE) {
			problems.push(`a normal misturada perdeu o comprimento unitario na opacidade ${opacity}`)
		}
		const roughness = blendDecalRoughness(0.2, 0.8, opacity)
		if (previousRoughness !== null && previousRoughness > roughness) {
			problems.push(`a rugosidade andou para tras na opacidade ${opacity}`)
		}
		previousRoughness = roughness
	}

	if (Math.abs(blendDecalRoughness(0.2, 0.8, 0) - 0.2) > ENDPOINT_TOLERANCE) {
		problems.push("opacidade 0 nao devolveu a rugosidade do slab")
	}
	if (Math.abs(blendDecalRoughness(0.2, 0.8, 1) - 0.8) > ENDPOINT_TOLERANCE) {
		problems.push("opacidade 1 nao devolveu a rugosidade do decal")
	}
	return problems
}

function findOrderProblems() {
	const problems = []
	const parameters = createReferenceSlabParameters()
	const decals = createReferenceDecals()
	const forwardOrder = resolveDecalsIntoParameters(parameters, decals).parameters
	const reverseOrder = resolveDecalsIntoParameters(parameters, decals.slice().reverse()).parameters
	if (JSON.stringify(forwardOrder) !== JSON.stringify(reverseOrder)) {
		problems.push("inverter a lista de decais mudou o resultado: a ordem nao esta deterministica")
	}
	return problems
}


export function findDecalBlendProblems() {
	return [...findIdentityProblems(), ...findChangedFieldProblems(), ...findSweepProblems(), ...findOrderProblems()]
}

export function describeDecalBlend() {
	const parameters = createReferenceSlabParameters()
	const resolution = resolveDecalsIntoParameters(parameters, createReferenceDecals())
	return {
		owner: SB_DECAL_BLEND_OWNER,
		normalBlendMode: SB_DECAL_BLEND_NORMAL_MODE,
		blendedFields: SB_DECAL_BLENDED_FIELD_NAMES,
		baseRoughness: parameters.roughness,
		resolvedRoughness: resolution.parameters.roughness,
		baseNormal: surfaceNormalOf(parameters),
		resolvedNormal: surfaceNormalOf(resolution.parameters),
		appliedDecalIds: resolution.appliedDecalIds,
	}
}
