import { SB_RESERVED_TEXTURE_UNITS } from "./sbMaterialContract.js"
import {
	channelRoundTripError,
	describeChannelEncoding,
	findChannelRangeProblems,
	maxNormalizedQuantizationError,
	packChannel,
	unpackChannel,
} from "./sbClosurePackingCore.js"
import { normalizeNormal } from "./sbNormalBlendCore.js"

export const SB_DECAL_BUFFER_OWNER = "SB-F29"
export const SB_DECAL_BUFFER_TEXTURE_UNIT_CONSUMER = "decalBuffer"
export const SB_DECAL_BUFFER_RESERVED_TEXTURE_UNITS = SB_RESERVED_TEXTURE_UNITS.decalBuffer
export const SB_DECAL_BUFFER_BYTES_PER_TEXEL = 4
export const SB_MAX_DECALS_PER_PIXEL = 4
export const SB_MAX_DECAL_SORT_ORDER = 255
export const SB_DECAL_QUANTIZATION_CEILING = 1 / 255


export const SB_DECAL_REFUSAL_CODES = Object.freeze({
	missingDecalId: "missingDecalId",
	duplicateDecalId: "duplicateDecalId",
	decalCeilingExceeded: "decalCeilingExceeded",
})

const DEFAULT_DECAL_NORMAL = Object.freeze([0, 0, 1])
const DECAL_BATTERY_SEED = 20260904
const DECAL_BATTERY_SIZE = 24

const DECAL_FIELD_DECLARATIONS = Object.freeze([
	Object.freeze({ name: "sortOrder", minimum: 0, maximum: SB_MAX_DECAL_SORT_ORDER, byteCount: 1 }),
	Object.freeze({ name: "roughness", minimum: 0, maximum: 1, byteCount: 1 }),
	Object.freeze({ name: "normalX", minimum: -1, maximum: 1, byteCount: 2 }),
	Object.freeze({ name: "normalY", minimum: -1, maximum: 1, byteCount: 2 }),
	Object.freeze({ name: "opacity", minimum: 0, maximum: 1, byteCount: 1 }),
])

function buildFieldEncodings(declarations) {
	let nextByteOffset = 0
	const encodings = declarations.map((declaration) => {
		const encoding = Object.freeze({
			name: declaration.name,
			minimum: declaration.minimum,
			maximum: declaration.maximum,
			byteCount: declaration.byteCount,
			byteOffset: nextByteOffset,
		})
		nextByteOffset += declaration.byteCount
		return encoding
	})
	return Object.freeze(encodings)
}

const FIELD_ENCODINGS = buildFieldEncodings(DECAL_FIELD_DECLARATIONS)
const FIELD_ENCODINGS_BY_NAME = Object.freeze(
	FIELD_ENCODINGS.reduce((encodingsByName, encoding) => {
		encodingsByName[encoding.name] = encoding
		return encodingsByName
	}, {}),
)
const DECAL_RECORD_BYTES = FIELD_ENCODINGS.reduce((total, encoding) => total + encoding.byteCount, 0)
const DECAL_RECORD_TEXELS = Math.ceil(DECAL_RECORD_BYTES / SB_DECAL_BUFFER_BYTES_PER_TEXEL)
const DECAL_RECORD_STRIDE_BYTES = DECAL_RECORD_TEXELS * SB_DECAL_BUFFER_BYTES_PER_TEXEL

function isFiniteNumber(value) {
	return typeof value === "number" && Number.isFinite(value)
}

function clampToRange(value, minimum, maximum) {
	if (minimum > value) return minimum
	if (value > maximum) return maximum
	return value
}

function clampUnitInterval(value) {
	return clampToRange(isFiniteNumber(value) ? value : 0, 0, 1)
}

function clampSortOrder(value) {
	if (!isFiniteNumber(value)) return 0
	return Math.round(clampToRange(value, 0, SB_MAX_DECAL_SORT_ORDER))
}

function readableDecalId(decal) {
	const id = decal?.id
	return typeof id === "string" ? id.trim() : ""
}


function channelRangeOf(encoding) {
	return { minimum: encoding.minimum, maximum: encoding.maximum, byteCount: encoding.byteCount }
}

export function decalFieldNames() {
	return FIELD_ENCODINGS.map((encoding) => encoding.name)
}

export function decalFieldEncoding(fieldName) {
	return FIELD_ENCODINGS_BY_NAME[fieldName] ?? null
}

export function decalRecordBytes() {
	return DECAL_RECORD_BYTES
}

export function decalRecordTexels() {
	return DECAL_RECORD_TEXELS
}

export function decalRecordStrideBytes() {
	return DECAL_RECORD_STRIDE_BYTES
}

export function decalRecordPaddingBytes() {
	return DECAL_RECORD_STRIDE_BYTES - DECAL_RECORD_BYTES
}


export function normalFromEncodedChannels(normalX, normalY) {
	const clampedX = clampToRange(isFiniteNumber(normalX) ? normalX : 0, -1, 1)
	const clampedY = clampToRange(isFiniteNumber(normalY) ? normalY : 0, -1, 1)
	const squaredLength = clampedX * clampedX + clampedY * clampedY
	const reconstructedZ = Math.sqrt(Math.max(0, 1 - squaredLength))
	return normalizeNormal([clampedX, clampedY, reconstructedZ])
}


export function sanitizeDecal(decal) {
	const source = decal === null || typeof decal !== "object" ? {} : decal
	const normal = Array.isArray(source.normal) ? source.normal : DEFAULT_DECAL_NORMAL
	return Object.freeze({
		id: readableDecalId(source),
		sortOrder: clampSortOrder(source.sortOrder),
		roughness: clampUnitInterval(source.roughness),
		normal: Object.freeze(normalizeNormal(normal)),
		opacity: clampUnitInterval(source.opacity),
	})
}


function compareDecals(leftDecal, rightDecal) {
	if (leftDecal.sortOrder !== rightDecal.sortOrder) return leftDecal.sortOrder - rightDecal.sortOrder
	if (leftDecal.id === rightDecal.id) return 0
	return leftDecal.id > rightDecal.id ? 1 : -1
}


export function orderDecals(decals) {
	const refusals = []
	const acceptedDecals = []
	const seenIds = new Set()
	const incomingDecals = Array.isArray(decals) ? decals : []

	incomingDecals.forEach((incomingDecal, incomingIndex) => {
		const decal = sanitizeDecal(incomingDecal)
		if ("" === decal.id) {
			refusals.push({
				code: SB_DECAL_REFUSAL_CODES.missingDecalId,
				reason: `decal na posicao ${incomingIndex} nao tem id: sem id nao existe desempate estavel`,
			})
			return
		}
		if (seenIds.has(decal.id)) {
			refusals.push({
				code: SB_DECAL_REFUSAL_CODES.duplicateDecalId,
				reason: `id "${decal.id}" repetido: dois decais iguais deixariam a ordem de aplicacao ambigua`,
			})
			return
		}
		seenIds.add(decal.id)
		acceptedDecals.push(decal)
	})

	const sortedDecals = acceptedDecals.slice().sort(compareDecals)
	const ordered = sortedDecals.slice(0, SB_MAX_DECALS_PER_PIXEL)
	const dropped = sortedDecals.slice(SB_MAX_DECALS_PER_PIXEL).map((decal) => ({
		id: decal.id,
		code: SB_DECAL_REFUSAL_CODES.decalCeilingExceeded,
		reason: `decal "${decal.id}" passou do teto de ${SB_MAX_DECALS_PER_PIXEL} decais por pixel`,
	}))

	return { ordered, dropped, refusals }
}

function channelValuesOf(decal) {
	return {
		sortOrder: decal.sortOrder,
		roughness: decal.roughness,
		normalX: decal.normal[0],
		normalY: decal.normal[1],
		opacity: decal.opacity,
	}
}


export function writeDecalRecord(decal, target = null, byteOffset = 0) {
	const bytes = target ?? new Uint8Array(DECAL_RECORD_STRIDE_BYTES)
	const values = channelValuesOf(sanitizeDecal(decal))
	FIELD_ENCODINGS.forEach((encoding) => {
		packChannel(bytes, byteOffset + encoding.byteOffset, values[encoding.name], channelRangeOf(encoding))
	})
	return bytes
}


export function readDecalRecord(bytes, byteOffset = 0) {
	if (bytes === null || bytes === undefined) return null
	if (!Number.isInteger(byteOffset) || 0 > byteOffset) return null
	if (byteOffset + DECAL_RECORD_BYTES > bytes.length) return null

	const values = {}
	for (const encoding of FIELD_ENCODINGS) {
		const value = unpackChannel(bytes, byteOffset + encoding.byteOffset, channelRangeOf(encoding))
		if (value === null) return null
		values[encoding.name] = value
	}

	return Object.freeze({
		sortOrder: Math.round(values.sortOrder),
		roughness: values.roughness,
		normal: Object.freeze(normalFromEncodedChannels(values.normalX, values.normalY)),
		opacity: values.opacity,
	})
}


export function writeDecalBuffer(decals) {
	const { ordered, dropped, refusals } = orderDecals(decals)
	const bytes = new Uint8Array(DECAL_RECORD_STRIDE_BYTES * ordered.length)
	ordered.forEach((decal, decalIndex) => {
		writeDecalRecord(decal, bytes, decalIndex * DECAL_RECORD_STRIDE_BYTES)
	})
	return {
		bytes,
		decalCount: ordered.length,
		ordered,
		dropped,
		refusals,
		strideBytes: DECAL_RECORD_STRIDE_BYTES,
		texelCount: DECAL_RECORD_TEXELS * ordered.length,
	}
}

export function readDecalBufferEntry(buffer, decalIndex) {
	const bytes = buffer?.bytes ?? buffer
	if (!Number.isInteger(decalIndex) || 0 > decalIndex) return null
	return readDecalRecord(bytes, decalIndex * DECAL_RECORD_STRIDE_BYTES)
}


export function measureDecalRoundTripError(decal) {
	const values = channelValuesOf(sanitizeDecal(decal))
	let worstFieldName = FIELD_ENCODINGS[0].name
	let worstNormalizedError = 0
	for (const encoding of FIELD_ENCODINGS) {
		const measurement = channelRoundTripError(values[encoding.name], channelRangeOf(encoding))
		if (measurement.normalizedError > worstNormalizedError) {
			worstNormalizedError = measurement.normalizedError
			worstFieldName = encoding.name
		}
	}
	return {
		worstFieldName,
		worstNormalizedError,
		ceiling: SB_DECAL_QUANTIZATION_CEILING,
		withinCeiling: SB_DECAL_QUANTIZATION_CEILING >= worstNormalizedError,
	}
}

function createDeterministicSequence(seed) {
	let state = seed >>> 0
	return function nextValue() {
		state = (1664525 * state + 1013904223) >>> 0
		return state / 4294967296
	}
}


export function createDecalBattery(size = DECAL_BATTERY_SIZE) {
	const nextValue = createDeterministicSequence(DECAL_BATTERY_SEED)
	const battery = []
	for (let decalIndex = 0; size > decalIndex; decalIndex += 1) {
		battery.push({
			id: `decal-${decalIndex}`,
			sortOrder: Math.round(nextValue() * SB_MAX_DECAL_SORT_ORDER),
			roughness: nextValue(),
			normal: [nextValue() * 2 - 1, nextValue() * 2 - 1, nextValue()],
			opacity: nextValue(),
		})
	}
	return battery
}

function sameBytes(firstBytes, secondBytes) {
	if (firstBytes.length !== secondBytes.length) return false
	for (let byteIndex = 0; firstBytes.length > byteIndex; byteIndex += 1) {
		if (firstBytes[byteIndex] !== secondBytes[byteIndex]) return false
	}
	return true
}

function shuffleDeterministically(items, seed) {
	const nextValue = createDeterministicSequence(seed)
	const shuffled = items.slice()
	for (let itemIndex = shuffled.length - 1; itemIndex > 0; itemIndex -= 1) {
		const swapIndex = Math.floor(nextValue() * (itemIndex + 1))
		const held = shuffled[itemIndex]
		shuffled[itemIndex] = shuffled[swapIndex]
		shuffled[swapIndex] = held
	}
	return shuffled
}

function findLayoutProblems() {
	const problems = []
	let expectedByteOffset = 0
	for (const encoding of FIELD_ENCODINGS) {
		problems.push(...findChannelRangeProblems(channelRangeOf(encoding), `decal.${encoding.name}`))
		if (encoding.byteOffset !== expectedByteOffset) {
			problems.push(
				`campo ${encoding.name} comeca em ${encoding.byteOffset} e deveria comecar em ${expectedByteOffset}: o registro tem buraco ou sobreposicao`,
			)
		}
		expectedByteOffset += encoding.byteCount
		const fieldError = maxNormalizedQuantizationError(encoding.byteCount)
		if (fieldError > SB_DECAL_QUANTIZATION_CEILING) {
			problems.push(
				`campo ${encoding.name} erra ${fieldError} por canal, acima do teto ${SB_DECAL_QUANTIZATION_CEILING}`,
			)
		}
	}
	if (expectedByteOffset !== DECAL_RECORD_BYTES) {
		problems.push(`soma dos campos e ${expectedByteOffset} B e o registro diz ter ${DECAL_RECORD_BYTES} B`)
	}
	if (DECAL_RECORD_STRIDE_BYTES % SB_DECAL_BUFFER_BYTES_PER_TEXEL !== 0) {
		problems.push(`o passo de ${DECAL_RECORD_STRIDE_BYTES} B nao fecha em texels de ${SB_DECAL_BUFFER_BYTES_PER_TEXEL} B`)
	}
	return problems
}

function findRoundTripProblems(battery) {
	const problems = []
	for (const decal of battery) {
		const measurement = measureDecalRoundTripError(decal)
		if (!measurement.withinCeiling) {
			problems.push(
				`decal ${decal.id} erra ${measurement.worstNormalizedError} no campo ${measurement.worstFieldName}, acima do teto ${SB_DECAL_QUANTIZATION_CEILING}`,
			)
		}
		const decoded = readDecalRecord(writeDecalRecord(decal))
		if (decoded === null) {
			problems.push(`decal ${decal.id} nao voltou do buffer`)
			continue
		}
		if (decoded.sortOrder !== sanitizeDecal(decal).sortOrder) {
			problems.push(`decal ${decal.id} perdeu o sortOrder na ida e volta`)
		}
	}
	return problems
}

function findOrderingProblems(battery) {
	const problems = []
	const reference = writeDecalBuffer(battery)
	for (const shuffleSeed of [1, 7, 4242]) {
		const shuffled = writeDecalBuffer(shuffleDeterministically(battery, shuffleSeed))
		if (!sameBytes(reference.bytes, shuffled.bytes)) {
			problems.push(`embaralhar a entrada com a semente ${shuffleSeed} mudou os bytes do DBuffer`)
		}
	}
	if (reference.decalCount > SB_MAX_DECALS_PER_PIXEL) {
		problems.push(`o buffer aceitou ${reference.decalCount} decais, acima do teto ${SB_MAX_DECALS_PER_PIXEL}`)
	}
	if (battery.length > SB_MAX_DECALS_PER_PIXEL && 0 === reference.dropped.length) {
		problems.push("decais acima do teto sumiram sem motivo declarado")
	}
	const duplicated = writeDecalBuffer([battery[0], battery[0]])
	if (1 !== duplicated.refusals.length) {
		problems.push("id repetido entrou no DBuffer em vez de virar recusa")
	}
	const withoutId = writeDecalBuffer([{ roughness: 0.5, opacity: 1 }])
	if (1 !== withoutId.refusals.length) {
		problems.push("decal sem id entrou no DBuffer em vez de virar recusa")
	}
	if (0 !== writeDecalBuffer([]).bytes.length) {
		problems.push("sem decal o DBuffer deveria ter zero bytes")
	}
	return problems
}


export function findDecalBufferProblems(options = {}) {
	const battery = options.battery ?? createDecalBattery()
	return [...findLayoutProblems(), ...findRoundTripProblems(battery), ...findOrderingProblems(battery)]
}

export function describeDecalBufferSummary() {
	return {
		owner: SB_DECAL_BUFFER_OWNER,
		recordBytes: DECAL_RECORD_BYTES,
		recordStrideBytes: DECAL_RECORD_STRIDE_BYTES,
		recordTexels: DECAL_RECORD_TEXELS,
		paddingBytes: decalRecordPaddingBytes(),
		maxDecalsPerPixel: SB_MAX_DECALS_PER_PIXEL,
		quantizationCeiling: SB_DECAL_QUANTIZATION_CEILING,
		textureUnitConsumer: SB_DECAL_BUFFER_TEXTURE_UNIT_CONSUMER,
		reservedTextureUnits: SB_DECAL_BUFFER_RESERVED_TEXTURE_UNITS,
		consumedTextureUnits: 0,
		fields: FIELD_ENCODINGS.map((encoding) => ({
			name: encoding.name,
			byteOffset: encoding.byteOffset,
			...describeChannelEncoding(channelRangeOf(encoding)),
		})),
	}
}
