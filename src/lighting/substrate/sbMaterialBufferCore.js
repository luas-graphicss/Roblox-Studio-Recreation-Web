import {
	SB_CLOSURE_BYTES_CEILING,
	SB_BYTES_PER_PIXEL_CEILING,
	SB_GATES,
	SB_MAX_CLOSURES_PER_PIXEL,
	SB_MAX_SLABS_PER_TREE,
	SB_RESERVED_TEXTURE_UNITS,
	SB_TIER_DEFAULTS,
	SB_TIER_NAMES,
} from "./sbMaterialContract.js"
import { SB_CLOSURE_HEADER_BYTES, SB_CLOSURE_HEADER_FIELDS, SB_CLOSURE_LAYOUTS, closureLayoutBytes, closureLayoutKinds } from "./sbClosureLayouts.js"
import { slabParameterSchema } from "./sbSlabParametersCore.js"
import { isSpecializedClosureKind, readSpecializedPayload, writeSpecializedPayload } from "./sbSpecializedClosureCore.js"
import { uniformsOwnedBy } from "./sbUniformNames.js"
import {
	channelRoundTripError,
	findChannelRangeProblems,
	maxAbsoluteQuantizationError,
	maxNormalizedQuantizationError,
	quantizationLevels,
	quantizationStep,
	readChannelCode,
	unpackChannel,
	packChannel,
	writeChannelCode,
} from "./sbClosurePackingCore.js"

export const SB_MATERIAL_BUFFER_OWNER = "SB-F8"
export const SB_MATERIAL_BUFFER_CLOSURE_KIND = "slab"
export const SB_MATERIAL_BUFFER_BYTES_PER_TEXEL = 4
export const SB_MATERIAL_BUFFER_TEXTURE_UNITS = SB_RESERVED_TEXTURE_UNITS.materialBuffer


export const SB_MATERIAL_BUFFER_UNIFORMS = Object.freeze({
	buffer: "uSbMaterialBuffer",
	size: "uSbMaterialBufferSize",
})


const SUPPORTED_BYTES_PER_CHANNEL = Object.freeze([1, 2])
const BYTE_MINIMUM = 0
const BYTE_MAXIMUM = 255
const SINGLE_CHANNEL = 1

const SLAB_PAYLOAD_FIELDS = SB_CLOSURE_LAYOUTS[SB_MATERIAL_BUFFER_CLOSURE_KIND].payload
const CLOSURE_KIND_NAMES = closureLayoutKinds()


const UNAUTHORED_FIELD_RANGES = Object.freeze({
	normal: {
		channelCount: 2,
		minimum: -1,
		maximum: 1,
		defaultValue: [0, 0],
		rationale: "par octaedrico da normal; zero significa usar o frame da geometria sem desvio",
	},
	tangent: {
		channelCount: 2,
		minimum: -1,
		maximum: 1,
		defaultValue: [0, 0],
		rationale: "par octaedrico do frame tangente; zero significa usar a tangente da malha",
	},
	specularProfileIndex: {
		channelCount: 1,
		minimum: 0,
		maximum: 255,
		defaultValue: 0,
		rationale: "indice inteiro do perfil; faixa igual ao degrau, entao a ida e volta e exata",
	},
	coverage: {
		channelCount: 1,
		minimum: 0,
		maximum: 1,
		defaultValue: 1,
		rationale: "fracao coberta pela camada do operador verticalLayering; 1 e camada inteira",
	},
	thickness: {
		channelCount: 1,
		minimum: 0,
		maximum: 1,
		defaultValue: 0,
		rationale: "espessura normalizada da camada; 0 e camada infinitamente fina",
	},
	transmittanceColor: {
		channelCount: 3,
		minimum: 0,
		maximum: 1,
		defaultValue: [1, 1, 1],
		rationale: "transmitancia por canal; 1 e passar tudo, sem absorcao",
	},
})


export const SB_CLOSURE_FLAG_BITS = Object.freeze({
	hasAnisotropy: 1,
	hasSecondLobe: 2,
	hasFuzz: 4,
	hasSubsurface: 8,
	hasThinFilm: 16,
	hasGlint: 32,
	hasTransmission: 64,
	hasEmissive: 128,
})

function isFiniteNumber(value) {
	return typeof value === "number" && Number.isFinite(value)
}

function clampToRange(value, minimum, maximum) {
	return Math.min(maximum, Math.max(minimum, value))
}

function clampInteger(value, minimum, maximum) {
	if (!isFiniteNumber(value)) return minimum
	return clampToRange(Math.round(value), minimum, maximum)
}

function glslTypeFor(channelCount) {
	if (channelCount === 2) return "vec2"
	if (channelCount === 3) return "vec3"
	return "float"
}

function channelDescriptorFor(fieldName) {
	const authored = slabParameterSchema(fieldName)
	if (authored !== null) {
		return {
			channelCount: authored.encoding.channelCount,
			minimum: authored.minimum,
			maximum: authored.maximum,
			defaultValue: authored.defaultValue,
			source: "authored",
			rationale: authored.rationale,
		}
	}
	const declared = UNAUTHORED_FIELD_RANGES[fieldName]
	if (declared !== undefined) return { ...declared, source: "declared" }
	return {
		channelCount: SINGLE_CHANNEL,
		minimum: 0,
		maximum: 1,
		defaultValue: 0,
		source: "undeclared",
		rationale: "campo do payload sem faixa declarada; findMaterialBufferProblems reclama disso",
	}
}

function buildHeaderFieldOffsets() {
	let byteOffset = 0
	const offsets = {}
	SB_CLOSURE_HEADER_FIELDS.forEach((field) => {
		offsets[field.name] = Object.freeze({
			name: field.name,
			byteOffset,
			byteCount: field.bytes,
			description: field.description,
		})
		byteOffset += field.bytes
	})
	return Object.freeze(offsets)
}





function buildFieldEncodings() {
	let byteOffset = SB_CLOSURE_HEADER_BYTES
	return Object.freeze(
		SLAB_PAYLOAD_FIELDS.map((field) => {
			const descriptor = channelDescriptorFor(field.name)
			const bytesPerChannel = field.bytes / descriptor.channelCount
			const encoding = Object.freeze({
				name: field.name,
				byteOffset,
				byteCount: field.bytes,
				channelCount: descriptor.channelCount,
				bytesPerChannel,
				minimum: descriptor.minimum,
				maximum: descriptor.maximum,
				defaultValue: descriptor.defaultValue,
				source: descriptor.source,
				rationale: descriptor.rationale,
				glslType: glslTypeFor(descriptor.channelCount),
				levels: quantizationLevels(bytesPerChannel),
				step: quantizationStep({ minimum: descriptor.minimum, maximum: descriptor.maximum, byteCount: bytesPerChannel }),
				maxNormalizedError: maxNormalizedQuantizationError(bytesPerChannel),
				maxAbsoluteError: maxAbsoluteQuantizationError({
					minimum: descriptor.minimum,
					maximum: descriptor.maximum,
					byteCount: bytesPerChannel,
				}),
			})
			byteOffset += field.bytes
			return encoding
		}),
	)
}

const HEADER_FIELD_OFFSETS = buildHeaderFieldOffsets()
const FIELD_ENCODINGS = buildFieldEncodings()
const FIELD_ENCODINGS_BY_NAME = Object.freeze(
	FIELD_ENCODINGS.reduce((index, encoding) => {
		index[encoding.name] = encoding
		return index
	}, {}),
)

export function closureHeaderFieldOffsets() {
	return HEADER_FIELD_OFFSETS
}

export function slabFieldEncodings() {
	return FIELD_ENCODINGS.slice()
}

export function slabFieldEncoding(fieldName) {
	const encoding = FIELD_ENCODINGS_BY_NAME[fieldName]
	return encoding === undefined ? null : encoding
}

export function slabFieldNames() {
	return FIELD_ENCODINGS.map((encoding) => encoding.name)
}


export function closureRecordBytes() {
	return closureLayoutBytes(SB_MATERIAL_BUFFER_CLOSURE_KIND)
}


export function closureRecordTexels() {
	return Math.ceil(closureRecordBytes() / SB_MATERIAL_BUFFER_BYTES_PER_TEXEL)
}


export function closureRecordStrideBytes() {
	return closureRecordTexels() * SB_MATERIAL_BUFFER_BYTES_PER_TEXEL
}

export function closureRecordPaddingBytes() {
	return closureRecordStrideBytes() - closureRecordBytes()
}


function firstChannelOf(value) {
	if (isFiniteNumber(value)) return value
	if (Array.isArray(value) && isFiniteNumber(value[0])) return value[0]
	return 0
}

function largestChannelOf(value) {
	if (isFiniteNumber(value)) return value
	if (!Array.isArray(value)) return 0
	return value.reduce((largest, channel) => (isFiniteNumber(channel) && channel > largest ? channel : largest), 0)
}

const FLAG_PREDICATES = Object.freeze({
	hasAnisotropy: (parameters) => firstChannelOf(parameters.anisotropy) > 0,
	hasSecondLobe: (parameters) => firstChannelOf(parameters.secondRoughnessWeight) > 0,
	hasFuzz: (parameters) => firstChannelOf(parameters.fuzzAmount) > 0,
	hasSubsurface: (parameters) => largestChannelOf(parameters.subsurfaceMeanFreePath) > 0,
	hasThinFilm: (parameters) => firstChannelOf(parameters.thinFilmThicknessNanometers) > 0,
	hasGlint: (parameters) => firstChannelOf(parameters.glintDensity) > 0,
	hasTransmission: (parameters) => firstChannelOf(parameters.thickness) > 0,
	hasEmissive: (parameters) => largestChannelOf(parameters.emissive) > 0,
})


export function closureFlagsFor(parameters) {
	const source = parameters === null || typeof parameters !== "object" ? {} : parameters
	return Object.keys(SB_CLOSURE_FLAG_BITS).reduce((flags, flagName) => {
		return FLAG_PREDICATES[flagName](source) ? flags + SB_CLOSURE_FLAG_BITS[flagName] : flags
	}, 0)
}


export function describeClosureFlags(flagBits) {
	const bits = clampInteger(flagBits, BYTE_MINIMUM, BYTE_MAXIMUM)
	return Object.keys(SB_CLOSURE_FLAG_BITS).reduce((described, flagName) => {
		const bit = SB_CLOSURE_FLAG_BITS[flagName]
		described[flagName] = Math.floor(bits / bit) % 2 === 1
		return described
	}, {})
}


export function normalizedClosureHeader(record) {
	const header = record?.header ?? {}
	const requestedKind = record?.kind
	return {
		kind: CLOSURE_KIND_NAMES.includes(requestedKind) ? requestedKind : SB_MATERIAL_BUFFER_CLOSURE_KIND,
		flags: clampInteger(header.flags ?? closureFlagsFor(record?.parameters), BYTE_MINIMUM, BYTE_MAXIMUM),
		closureCount: clampInteger(header.closureCount ?? 1, 1, SB_MAX_CLOSURES_PER_PIXEL),
		layerIndex: clampInteger(header.layerIndex ?? 0, 0, SB_MAX_SLABS_PER_TREE - 1),
	}
}

function writeClosureHeader(bytes, byteOffset, header) {
	const kindCode = Math.max(0, CLOSURE_KIND_NAMES.indexOf(header.kind))
	const codesByField = {
		kind: kindCode,
		flags: header.flags,
		closureCount: header.closureCount,
		layerIndex: header.layerIndex,
	}
	SB_CLOSURE_HEADER_FIELDS.forEach((field) => {
		const offset = HEADER_FIELD_OFFSETS[field.name]
		writeChannelCode(bytes, byteOffset + offset.byteOffset, codesByField[field.name], offset.byteCount)
	})
}

function readHeaderCode(bytes, byteOffset, fieldName) {
	const offset = HEADER_FIELD_OFFSETS[fieldName]
	const code = readChannelCode(bytes, byteOffset + offset.byteOffset, offset.byteCount)
	return code === null ? 0 : code
}


export function readClosureHeader(bytes, byteOffset = 0) {
	if (!hasRoomForRecord(bytes, byteOffset)) return null
	const kindCode = readHeaderCode(bytes, byteOffset, "kind")
	return {
		kind: CLOSURE_KIND_NAMES[kindCode] ?? SB_MATERIAL_BUFFER_CLOSURE_KIND,
		kindCode,
		flags: readHeaderCode(bytes, byteOffset, "flags"),
		closureCount: readHeaderCode(bytes, byteOffset, "closureCount"),
		layerIndex: readHeaderCode(bytes, byteOffset, "layerIndex"),
	}
}


function channelRangeFor(encoding) {
	return { minimum: encoding.minimum, maximum: encoding.maximum, byteCount: encoding.bytesPerChannel }
}

function channelByteOffset(encoding, channelIndex) {
	return encoding.byteOffset + channelIndex * encoding.bytesPerChannel
}


export function channelValuesFor(encoding, rawValue) {
	const fallback = encoding.defaultValue
	const channels = []
	for (let channelIndex = 0; encoding.channelCount > channelIndex; channelIndex += 1) {
		const fallbackChannel = Array.isArray(fallback) ? fallback[channelIndex] : fallback
		if (isFiniteNumber(rawValue)) {
			channels.push(rawValue)
			continue
		}
		if (Array.isArray(rawValue) && isFiniteNumber(rawValue[channelIndex])) {
			channels.push(rawValue[channelIndex])
			continue
		}
		channels.push(isFiniteNumber(fallbackChannel) ? fallbackChannel : encoding.minimum)
	}
	return channels
}

function writeClosurePayload(bytes, byteOffset, parameters) {
	const source = parameters === null || typeof parameters !== "object" ? {} : parameters
	FIELD_ENCODINGS.forEach((encoding) => {
		const range = channelRangeFor(encoding)
		channelValuesFor(encoding, source[encoding.name]).forEach((channelValue, channelIndex) => {
			packChannel(bytes, byteOffset + channelByteOffset(encoding, channelIndex), channelValue, range)
		})
	})
}

function readClosurePayload(bytes, byteOffset) {
	return FIELD_ENCODINGS.reduce((parameters, encoding) => {
		const range = channelRangeFor(encoding)
		const channels = []
		for (let channelIndex = 0; encoding.channelCount > channelIndex; channelIndex += 1) {
			const value = unpackChannel(bytes, byteOffset + channelByteOffset(encoding, channelIndex), range)
			channels.push(value === null ? encoding.minimum : value)
		}
		parameters[encoding.name] = encoding.channelCount === SINGLE_CHANNEL ? channels[0] : channels
		return parameters
	}, {})
}

function hasRoomForRecord(bytes, byteOffset) {
	if (bytes === null || bytes === undefined || !Number.isInteger(byteOffset) || 0 > byteOffset) return false
	return bytes.length >= byteOffset + closureRecordBytes()
}


export function writeClosureRecord(record, target = null, byteOffset = 0) {
	const bytes = target ?? new Uint8Array(closureRecordStrideBytes())
	if (!hasRoomForRecord(bytes, byteOffset)) return bytes
	const header = normalizedClosureHeader(record)
	writeClosureHeader(bytes, byteOffset, header)
	if (isSpecializedClosureKind(header.kind)) writeSpecializedPayload(header.kind, bytes, byteOffset, record?.parameters)
	else writeClosurePayload(bytes, byteOffset, record?.parameters)
	return bytes
}


export function readClosureRecord(bytes, byteOffset = 0) {
	if (!hasRoomForRecord(bytes, byteOffset)) return null
	const header = readClosureHeader(bytes, byteOffset)
	return {
		kind: header.kind,
		header,
		flags: describeClosureFlags(header.flags),
		parameters: isSpecializedClosureKind(header.kind) ? readSpecializedPayload(header.kind, bytes, byteOffset) : readClosurePayload(bytes, byteOffset),
	}
}


export function materialBufferLayout(closureCount) {
	const height = Math.max(1, clampInteger(closureCount, 1, Number.MAX_SAFE_INTEGER))
	const width = closureRecordTexels()
	const strideBytes = closureRecordStrideBytes()
	return {
		width,
		height,
		closureCount: height,
		bytesPerTexel: SB_MATERIAL_BUFFER_BYTES_PER_TEXEL,
		texelsPerClosure: width,
		strideBytes,
		byteLength: strideBytes * height,
	}
}


export function writeMaterialBuffer(records) {
	const recordList = Array.isArray(records) ? records : []
	const layout = materialBufferLayout(Math.max(1, recordList.length))
	const data = new Uint8Array(layout.byteLength)
	for (let closureIndex = 0; layout.closureCount > closureIndex; closureIndex += 1) {
		writeClosureRecord(recordList[closureIndex] ?? null, data, closureIndex * layout.strideBytes)
	}
	return { ...layout, data }
}


export function readMaterialBufferClosure(buffer, closureIndex) {
	const data = buffer?.data ?? buffer
	if (!Number.isInteger(closureIndex) || 0 > closureIndex) return null
	return readClosureRecord(data, closureIndex * closureRecordStrideBytes())
}


function tierAccounting() {
	const strideBytes = closureRecordStrideBytes()
	return SB_TIER_NAMES.map((tierName) => {
		const defaults = SB_TIER_DEFAULTS[tierName]
		const closuresPerPixel = defaults.closuresPerPixel
		const bytesPerPixel = closuresPerPixel * strideBytes
		return {
			tierName,
			substrateEnabled: defaults.substrateEnabled,
			closuresPerPixel,
			closureBudgetBytes: defaults.closureBytes,
			bytesPerPixel,
			pixelCeilingBytes: SB_BYTES_PER_PIXEL_CEILING,
			fitsClosureBudget: defaults.closureBytes >= strideBytes,
			fitsPixelCeiling: SB_BYTES_PER_PIXEL_CEILING >= bytesPerPixel,
		}
	})
}


export function materialBufferBudget() {
	const recordBytes = closureRecordBytes()
	const strideBytes = closureRecordStrideBytes()
	return {
		headerBytes: SB_CLOSURE_HEADER_BYTES,
		payloadBytes: recordBytes - SB_CLOSURE_HEADER_BYTES,
		recordBytes,
		strideBytes,
		paddingBytes: closureRecordPaddingBytes(),
		texelsPerClosure: closureRecordTexels(),
		bytesPerTexel: SB_MATERIAL_BUFFER_BYTES_PER_TEXEL,
		ceilingBytes: SB_CLOSURE_BYTES_CEILING,
		headroomBytes: SB_CLOSURE_BYTES_CEILING - strideBytes,
		textureUnits: SB_MATERIAL_BUFFER_TEXTURE_UNITS,
		fieldCount: FIELD_ENCODINGS.length,
		byTier: tierAccounting(),
	}
}


function measureFieldError(encoding, requestedParameters, decodedParameters) {
	const range = channelRangeFor(encoding)
	const requestedChannels = channelValuesFor(encoding, requestedParameters?.[encoding.name])
	const decodedValue = decodedParameters?.[encoding.name]
	const decodedChannels = encoding.channelCount === SINGLE_CHANNEL ? [decodedValue] : decodedValue ?? []
	let normalizedError = 0
	let absoluteError = 0
	requestedChannels.forEach((requestedChannel, channelIndex) => {
		const reference = channelRoundTripError(requestedChannel, range)
		const decodedChannel = decodedChannels[channelIndex]
		const channelAbsoluteError = isFiniteNumber(decodedChannel)
			? Math.abs(decodedChannel - reference.expected)
			: Math.abs(range.maximum - range.minimum)
		const width = range.maximum - range.minimum
		const channelNormalizedError = width > 0 ? channelAbsoluteError / width : 0
		if (channelAbsoluteError > absoluteError) absoluteError = channelAbsoluteError
		if (channelNormalizedError > normalizedError) normalizedError = channelNormalizedError
	})
	return { name: encoding.name, channelCount: encoding.channelCount, absoluteError, normalizedError }
}

function headerMatches(requestedHeader, decodedHeader) {
	if (decodedHeader === null) return false
	return (
		requestedHeader.kind === decodedHeader.kind &&
		requestedHeader.flags === decodedHeader.flags &&
		requestedHeader.closureCount === decodedHeader.closureCount &&
		requestedHeader.layerIndex === decodedHeader.layerIndex
	)
}


export function measureClosureRoundTripError(record) {
	const bytes = writeClosureRecord(record)
	const decoded = readClosureRecord(bytes)
	const fields = FIELD_ENCODINGS.map((encoding) => measureFieldError(encoding, record?.parameters, decoded?.parameters))
	const worstField = fields.reduce(
		(worst, field) => (field.normalizedError > worst.normalizedError ? field : worst),
		{ name: "nenhum", normalizedError: 0, absoluteError: 0 },
	)
	return {
		recordBytes: bytes.length,
		header: decoded?.header ?? null,
		headerMatches: headerMatches(normalizedClosureHeader(record), decoded?.header ?? null),
		fields,
		worstFieldName: worstField.name,
		worstNormalizedError: worstField.normalizedError,
		worstAbsoluteError: worstField.absoluteError,
	}
}

function findFieldProblems() {
	const gate = SB_GATES.maxQuantizationErrorPerChannel
	const problems = []
	let expectedOffset = SB_CLOSURE_HEADER_BYTES
	FIELD_ENCODINGS.forEach((encoding) => {
		if (encoding.byteOffset !== expectedOffset) {
			problems.push(`${encoding.name}: comeca no byte ${encoding.byteOffset}, esperado ${expectedOffset}`)
		}
		expectedOffset += encoding.byteCount
		if (encoding.source === "undeclared") {
			problems.push(`${encoding.name}: campo do payload sem faixa declarada pela SB-F4 nem pela SB-F8`)
		}
		if (!Number.isInteger(encoding.bytesPerChannel)) {
			problems.push(
				`${encoding.name}: ${encoding.byteCount} B nao divide em ${encoding.channelCount} canais inteiros`,
			)
			return
		}
		if (!SUPPORTED_BYTES_PER_CHANNEL.includes(encoding.bytesPerChannel)) {
			problems.push(
				`${encoding.name}: ${encoding.bytesPerChannel} B por canal; o leitor GLSL da SB-F8 decodifica 1 ou 2`,
			)
		}
		findChannelRangeProblems(channelRangeFor(encoding), encoding.name).forEach((problem) => problems.push(problem))
		if (encoding.maxNormalizedError > gate) {
			problems.push(`${encoding.name}: erro de ${encoding.maxNormalizedError} por canal acima do portao ${gate}`)
		}
	})
	return problems
}

function findBudgetProblems() {
	const budget = materialBufferBudget()
	const problems = []
	if (budget.payloadBytes + budget.headerBytes !== budget.recordBytes) {
		problems.push("registro: header mais payload nao fecha com o layout congelado")
	}
	if (0 > budget.headroomBytes) {
		problems.push(`registro: ${budget.strideBytes} B por closure passa do teto ${budget.ceilingBytes} B`)
	}
	if (budget.textureUnits !== 1) {
		problems.push(`textura: a SB-F8 reserva ${budget.textureUnits} unidades e o portao pede 1`)
	}
	budget.byTier.forEach((tier) => {
		if (!tier.substrateEnabled) return
		if (!tier.fitsClosureBudget) {
			problems.push(`tier ${tier.tierName}: orca ${tier.closureBudgetBytes} B por closure e o registro gasta ${budget.strideBytes} B`)
		}
		if (!tier.fitsPixelCeiling) {
			problems.push(`tier ${tier.tierName}: ${tier.bytesPerPixel} B por pixel passa do teto ${tier.pixelCeilingBytes} B`)
		}
	})
	return problems
}

function findUniformProblems() {
	const owned = uniformsOwnedBy(SB_MATERIAL_BUFFER_OWNER)
	return Object.values(SB_MATERIAL_BUFFER_UNIFORMS)
		.filter((uniformName) => !owned.includes(uniformName))
		.map((uniformName) => `uniform ${uniformName} nao esta registrado no contrato para a ${SB_MATERIAL_BUFFER_OWNER}`)
}


export function findMaterialBufferProblems() {
	return [...findFieldProblems(), ...findBudgetProblems(), ...findUniformProblems()]
}


export function describeMaterialBufferSummary() {
	return {
		owner: SB_MATERIAL_BUFFER_OWNER,
		closureKind: SB_MATERIAL_BUFFER_CLOSURE_KIND,
		uniforms: SB_MATERIAL_BUFFER_UNIFORMS,
		budget: materialBufferBudget(),
		fieldCount: FIELD_ENCODINGS.length,
		authoredFieldCount: FIELD_ENCODINGS.filter((encoding) => encoding.source === "authored").length,
		declaredFieldCount: FIELD_ENCODINGS.filter((encoding) => encoding.source === "declared").length,
		flagBits: SB_CLOSURE_FLAG_BITS,
		problems: findMaterialBufferProblems(),
	}
}
