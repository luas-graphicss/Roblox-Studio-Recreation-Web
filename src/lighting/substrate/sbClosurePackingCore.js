export const SB_BITS_PER_BYTE = 8
export const SB_MIN_CHANNEL_BYTES = 1
export const SB_MAX_CHANNEL_BYTES = 4

const BYTE_STATES = 256
const BYTE_MASK = 255
const ROUNDING_FRACTION_OF_STEP = 0.5

function isFiniteNumber(value) {
	return typeof value === "number" && Number.isFinite(value)
}

function clampToRange(value, minimum, maximum) {
	return Math.min(maximum, Math.max(minimum, value))
}


export function isUsableChannelByteCount(byteCount) {
	if (!Number.isInteger(byteCount)) return false
	return byteCount >= SB_MIN_CHANNEL_BYTES && SB_MAX_CHANNEL_BYTES >= byteCount
}


export function quantizationLevels(byteCount) {
	if (!isUsableChannelByteCount(byteCount)) return 0
	return Math.pow(BYTE_STATES, byteCount) - 1
}


export function maxNormalizedQuantizationError(byteCount) {
	const levels = quantizationLevels(byteCount)
	return levels === 0 ? 1 : ROUNDING_FRACTION_OF_STEP / levels
}

function rangeWidthOf(range) {
	const minimum = range?.minimum
	const maximum = range?.maximum
	if (!isFiniteNumber(minimum) || !isFiniteNumber(maximum)) return 0
	return maximum - minimum
}


export function quantizationStep(range) {
	const levels = quantizationLevels(range?.byteCount)
	if (levels === 0) return 0
	return rangeWidthOf(range) / levels
}


export function maxAbsoluteQuantizationError(range) {
	return quantizationStep(range) * ROUNDING_FRACTION_OF_STEP
}


export function normalizeValue(value, minimum, maximum) {
	const width = maximum - minimum
	if (!isFiniteNumber(value) || !isFiniteNumber(width) || !(width > 0)) return 0
	return clampToRange((value - minimum) / width, 0, 1)
}


export function denormalizeValue(normalized, minimum, maximum) {
	if (!isFiniteNumber(minimum) || !isFiniteNumber(maximum)) return 0
	return minimum + clampToRange(normalized, 0, 1) * (maximum - minimum)
}


export function quantizeChannel(value, range) {
	const levels = quantizationLevels(range?.byteCount)
	if (levels === 0) return 0
	return Math.round(normalizeValue(value, range.minimum, range.maximum) * levels)
}


export function dequantizeChannel(code, range) {
	const levels = quantizationLevels(range?.byteCount)
	if (levels === 0) return isFiniteNumber(range?.minimum) ? range.minimum : 0
	const safeCode = isFiniteNumber(code) ? Math.round(code) : 0
	const clampedCode = clampToRange(safeCode, 0, levels)
	return denormalizeValue(clampedCode / levels, range.minimum, range.maximum)
}

function hasRoomFor(bytes, byteOffset, byteCount) {
	if (bytes === null || bytes === undefined || !Number.isInteger(byteOffset)) return false
	if (0 > byteOffset) return false
	return bytes.length >= byteOffset + byteCount
}


export function writeChannelCode(bytes, byteOffset, code, byteCount) {
	if (!isUsableChannelByteCount(byteCount)) return false
	if (!hasRoomFor(bytes, byteOffset, byteCount)) return false
	let remaining = isFiniteNumber(code) ? Math.max(0, Math.round(code)) : 0
	for (let index = byteCount - 1; index >= 0; index -= 1) {
		bytes[byteOffset + index] = remaining % BYTE_STATES
		remaining = Math.floor(remaining / BYTE_STATES)
	}
	return true
}


export function readChannelCode(bytes, byteOffset, byteCount) {
	if (!isUsableChannelByteCount(byteCount)) return null
	if (!hasRoomFor(bytes, byteOffset, byteCount)) return null
	let code = 0
	for (let index = 0; byteCount > index; index += 1) {
		code = code * BYTE_STATES + (Number(bytes[byteOffset + index]) & BYTE_MASK)
	}
	return code
}


export function packChannel(bytes, byteOffset, value, range) {
	const code = quantizeChannel(value, range)
	return writeChannelCode(bytes, byteOffset, code, range?.byteCount) ? code : null
}


export function unpackChannel(bytes, byteOffset, range) {
	const code = readChannelCode(bytes, byteOffset, range?.byteCount)
	return code === null ? null : dequantizeChannel(code, range)
}


export function channelRoundTripError(value, range) {
	const code = quantizeChannel(value, range)
	const decoded = dequantizeChannel(code, range)
	const width = rangeWidthOf(range)
	const expected = isFiniteNumber(value) ? clampToRange(value, range.minimum, range.maximum) : range?.minimum ?? 0
	const absoluteError = Math.abs(decoded - expected)
	return {
		code,
		expected,
		decoded,
		absoluteError,
		normalizedError: width > 0 ? absoluteError / width : 0,
	}
}


export function findChannelRangeProblems(range, label) {
	const name = label ?? "canal"
	const problems = []
	if (!isUsableChannelByteCount(range?.byteCount)) {
		problems.push(`${name}: byteCount ${range?.byteCount} fora de [${SB_MIN_CHANNEL_BYTES}, ${SB_MAX_CHANNEL_BYTES}]`)
		return problems
	}
	if (!isFiniteNumber(range.minimum) || !isFiniteNumber(range.maximum)) {
		problems.push(`${name}: faixa precisa de minimum e maximum finitos`)
		return problems
	}
	if (!(range.maximum > range.minimum)) {
		problems.push(`${name}: maximum ${range.maximum} precisa ser maior que minimum ${range.minimum}`)
	}
	return problems
}


export function describeChannelEncoding(range) {
	const byteCount = range?.byteCount
	return {
		byteCount,
		bitCount: isUsableChannelByteCount(byteCount) ? byteCount * SB_BITS_PER_BYTE : 0,
		levels: quantizationLevels(byteCount),
		step: quantizationStep(range),
		maxNormalizedError: maxNormalizedQuantizationError(byteCount),
		maxAbsoluteError: maxAbsoluteQuantizationError(range),
	}
}
