import { relativeStandardDeviationForCount } from "./sbGlintCore.js"
import { SB_GLINT_LOD_LEVEL_COUNT, cellAreaForLevel } from "./sbGlintLodCore.js"

export const SB_GLINT_LUT_WIDTH = 64
export const SB_GLINT_LUT_HEIGHT = SB_GLINT_LOD_LEVEL_COUNT
export const SB_GLINT_LUT_CHANNEL_COUNT = 4


export const SB_GLINT_LUT_MAXIMUM_DENSITY = 100000


export const SB_GLINT_LUT_SMOOTH_FADE_START_COUNT = 16
export const SB_GLINT_LUT_SMOOTH_FADE_END_COUNT = 64

const BYTE_MAXIMUM = 255

function clampToUnitRange(value) {
	return Math.min(Math.max(value, 0), 1)
}

export function encodeUnitByte(value) {
	return Math.round(clampToUnitRange(Number(value) || 0) * BYTE_MAXIMUM)
}

export function decodeUnitByte(byteValue) {
	return (Number(byteValue) || 0) / BYTE_MAXIMUM
}


export function densityAxisPosition(glintDensity) {
	const density = Math.max(Number(glintDensity) || 0, 0)
	return clampToUnitRange(Math.log(1 + density) / Math.log(1 + SB_GLINT_LUT_MAXIMUM_DENSITY))
}

export function densityForColumn(columnIndex) {
	const column = Math.min(Math.max(Math.trunc(Number(columnIndex) || 0), 0), SB_GLINT_LUT_WIDTH - 1)
	const axisPosition = column / (SB_GLINT_LUT_WIDTH - 1)
	return Math.expm1(axisPosition * Math.log(1 + SB_GLINT_LUT_MAXIMUM_DENSITY))
}

export function columnForDensity(glintDensity) {
	return Math.round(densityAxisPosition(glintDensity) * (SB_GLINT_LUT_WIDTH - 1))
}


export function smoothFadeWeightForCount(expectedCount) {
	const count = Math.max(Number(expectedCount) || 0, 0)
	const span = SB_GLINT_LUT_SMOOTH_FADE_END_COUNT - SB_GLINT_LUT_SMOOTH_FADE_START_COUNT
	return clampToUnitRange((count - SB_GLINT_LUT_SMOOTH_FADE_START_COUNT) / span)
}

function maximumExpectedCount() {
	return SB_GLINT_LUT_MAXIMUM_DENSITY * cellAreaForLevel(SB_GLINT_LOD_LEVEL_COUNT - 1)
}

export function encodeExpectedCount(expectedCount) {
	const count = Math.max(Number(expectedCount) || 0, 0)
	return clampToUnitRange(Math.log(1 + count) / Math.log(1 + maximumExpectedCount()))
}

export function decodeExpectedCount(encodedValue) {
	const encoded = clampToUnitRange(Number(encodedValue) || 0)
	return Math.expm1(encoded * Math.log(1 + maximumExpectedCount()))
}


export function glintLutEntry(level, columnIndex) {
	const glintDensity = densityForColumn(columnIndex)
	const expectedCount = glintDensity * cellAreaForLevel(level)
	return {
		level,
		columnIndex,
		glintDensity,
		expectedCount,
		relativeStandardDeviation: relativeStandardDeviationForCount(expectedCount),
		smoothFadeWeight: smoothFadeWeightForCount(expectedCount),
	}
}


export function buildGlintLutData() {
	const data = new Uint8Array(SB_GLINT_LUT_WIDTH * SB_GLINT_LUT_HEIGHT * SB_GLINT_LUT_CHANNEL_COUNT)
	for (let level = 0; level < SB_GLINT_LUT_HEIGHT; level += 1) {
		for (let columnIndex = 0; columnIndex < SB_GLINT_LUT_WIDTH; columnIndex += 1) {
			const entry = glintLutEntry(level, columnIndex)
			const offset = (level * SB_GLINT_LUT_WIDTH + columnIndex) * SB_GLINT_LUT_CHANNEL_COUNT
			data[offset] = encodeUnitByte(encodeExpectedCount(entry.expectedCount))
			data[offset + 1] = encodeUnitByte(entry.relativeStandardDeviation)
			data[offset + 2] = encodeUnitByte(entry.smoothFadeWeight)
			data[offset + 3] = BYTE_MAXIMUM
		}
	}
	return {
		data,
		width: SB_GLINT_LUT_WIDTH,
		height: SB_GLINT_LUT_HEIGHT,
		channelCount: SB_GLINT_LUT_CHANNEL_COUNT,
		byteLength: data.length,
		maximumDensity: SB_GLINT_LUT_MAXIMUM_DENSITY,
	}
}


export function readGlintLutEntry(lut, level, columnIndex) {
	const offset = (level * lut.width + columnIndex) * lut.channelCount
	return {
		expectedCount: decodeExpectedCount(decodeUnitByte(lut.data[offset])),
		relativeStandardDeviation: decodeUnitByte(lut.data[offset + 1]),
		smoothFadeWeight: decodeUnitByte(lut.data[offset + 2]),
	}
}


export function glintLutRoundTripError() {
	const lut = buildGlintLutData()
	let worstError = 0
	for (let level = 0; level < lut.height; level += 1) {
		for (let columnIndex = 0; columnIndex < lut.width; columnIndex += 1) {
			const exact = glintLutEntry(level, columnIndex)
			const decoded = readGlintLutEntry(lut, level, columnIndex)
			worstError = Math.max(worstError, Math.abs(decoded.smoothFadeWeight - exact.smoothFadeWeight))
		}
	}
	return { worstError, width: lut.width, height: lut.height, byteLength: lut.byteLength }
}
