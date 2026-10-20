export const SB_MINIMUM_TANGENT_LENGTH = 1e-4


export const SB_TANGENT_ROTATION_PERIOD = Math.PI

export const SB_TANGENT_FRAME_SOURCES = Object.freeze({
	tangentMap: "tangentMap",
	geometryTangent: "geometryTangent",
	normalFallback: "normalFallback",
})

const CANONICAL_AXES = Object.freeze([
	Object.freeze([1, 0, 0]),
	Object.freeze([0, 1, 0]),
	Object.freeze([0, 0, 1]),
])


function dotProduct(first, second) {
	return first[0] * second[0] + first[1] * second[1] + first[2] * second[2]
}

function crossProduct(first, second) {
	return [
		first[1] * second[2] - first[2] * second[1],
		first[2] * second[0] - first[0] * second[2],
		first[0] * second[1] - first[1] * second[0],
	]
}

function scaleVector(vector, scale) {
	return [vector[0] * scale, vector[1] * scale, vector[2] * scale]
}

function addVectors(first, second) {
	return [first[0] + second[0], first[1] + second[1], first[2] + second[2]]
}

function isFiniteVector(vector) {
	if (!Array.isArray(vector) || 3 > vector.length) return false
	return Number.isFinite(vector[0]) && Number.isFinite(vector[1]) && Number.isFinite(vector[2])
}


function normalizeVector(vector) {
	if (!isFiniteVector(vector)) return null
	const length = Math.sqrt(dotProduct(vector, vector))
	if (SB_MINIMUM_TANGENT_LENGTH > length) return null
	return [vector[0] / length, vector[1] / length, vector[2] / length]
}


function projectOntoTangentPlane(tangent, normal) {
	if (!isFiniteVector(tangent)) return null
	const alongNormal = dotProduct(normal, tangent)
	return normalizeVector([
		tangent[0] - normal[0] * alongNormal,
		tangent[1] - normal[1] * alongNormal,
		tangent[2] - normal[2] * alongNormal,
	])
}


export function deriveTangentFromNormal(normal) {
	const unitNormal = normalizeVector(normal)
	if (unitNormal === null) throw new Error("deriveTangentFromNormal: normal degenerada")
	let chosenAxis = CANONICAL_AXES[0]
	let smallestAlignment = Infinity
	for (const axis of CANONICAL_AXES) {
		const alignment = Math.abs(dotProduct(unitNormal, axis))
		if (smallestAlignment > alignment) {
			smallestAlignment = alignment
			chosenAxis = axis
		}
	}
	const projected = projectOntoTangentPlane(chosenAxis, unitNormal)
	if (projected === null) throw new Error("deriveTangentFromNormal: nenhum eixo canonico sobreviveu a projecao")
	return projected
}


export function rotateVectorAroundAxis(vector, axis, angleRadians) {
	const unitAxis = normalizeVector(axis)
	if (unitAxis === null || !Number.isFinite(angleRadians)) return [vector[0], vector[1], vector[2]]
	const cosine = Math.cos(angleRadians)
	const sine = Math.sin(angleRadians)
	const alongAxis = dotProduct(unitAxis, vector)
	const perpendicular = crossProduct(unitAxis, vector)
	return [
		vector[0] * cosine + perpendicular[0] * sine + unitAxis[0] * alongAxis * (1 - cosine),
		vector[1] * cosine + perpendicular[1] * sine + unitAxis[1] * alongAxis * (1 - cosine),
		vector[2] * cosine + perpendicular[2] * sine + unitAxis[2] * alongAxis * (1 - cosine),
	]
}

function resolveTangentSource(requestedSource, usedFallback) {
	if (usedFallback) return SB_TANGENT_FRAME_SOURCES.normalFallback
	if (requestedSource === SB_TANGENT_FRAME_SOURCES.geometryTangent) return SB_TANGENT_FRAME_SOURCES.geometryTangent
	return SB_TANGENT_FRAME_SOURCES.tangentMap
}


function normalizeRotationRadians(rotationRadians) {
	if (typeof rotationRadians !== "number" || !Number.isFinite(rotationRadians)) return 0
	const wrapped = rotationRadians % SB_TANGENT_ROTATION_PERIOD
	return 0 > wrapped ? wrapped + SB_TANGENT_ROTATION_PERIOD : wrapped
}


export function rotateTangentFrame(frame, rotationRadians) {
	const angle = normalizeRotationRadians(rotationRadians)
	const handedness = frame.handedness === -1 ? -1 : 1
	if (angle === 0) return { ...frame, handedness, rotationRadians: 0 }
	const rotatedTangent = normalizeVector(
		addVectors(scaleVector(frame.tangent, Math.cos(angle)), scaleVector(frame.bitangent, Math.sin(angle))),
	)
	if (rotatedTangent === null) return { ...frame, handedness, rotationRadians: 0 }
	return {
		...frame,
		tangent: rotatedTangent,
		bitangent: scaleVector(crossProduct(frame.normal, rotatedTangent), handedness),
		handedness,
		rotationRadians: angle,
	}
}


export function buildTangentFrame(options) {
	const normal = normalizeVector(options?.normal)
	if (normal === null) throw new Error("buildTangentFrame: normal degenerada, frame impossivel")
	const projectedTangent = projectOntoTangentPlane(options?.tangent, normal)
	const usedFallback = projectedTangent === null
	const tangent = usedFallback ? deriveTangentFromNormal(normal) : projectedTangent
	const handedness = options?.bitangentSign === -1 ? -1 : 1
	const frame = {
		normal,
		tangent,
		bitangent: scaleVector(crossProduct(normal, tangent), handedness),
		handedness,
		source: resolveTangentSource(options?.tangentSource, usedFallback),
		usedFallback,
	}
	return rotateTangentFrame(frame, options?.anisotropyRotation)
}


export function projectDirectionOntoFrame(frame, direction) {
	return [
		dotProduct(frame.tangent, direction),
		dotProduct(frame.bitangent, direction),
		dotProduct(frame.normal, direction),
	]
}


export function measureFrameOrthonormality(frame) {
	const axes = [frame.tangent, frame.bitangent, frame.normal]
	const lengthErrors = axes.map((axis) => Math.abs(Math.sqrt(dotProduct(axis, axis)) - 1))
	const angleErrors = [
		Math.abs(dotProduct(frame.tangent, frame.bitangent)),
		Math.abs(dotProduct(frame.tangent, frame.normal)),
		Math.abs(dotProduct(frame.bitangent, frame.normal)),
	]
	return { worstError: Math.max(...lengthErrors, ...angleErrors) }
}
