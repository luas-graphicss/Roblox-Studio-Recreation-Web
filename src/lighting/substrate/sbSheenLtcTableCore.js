import { clampToUnitRange, fitSheenLtcFromStatistics, integrateSheenLobeStatistics } from "./sbFuzzSheenCore.js"


export const SB_SHEEN_TABLE_VIEW_COSINE_STEPS = 32
export const SB_SHEEN_TABLE_ROUGHNESS_STEPS = 32


export const SB_SHEEN_TABLE_QUADRATURE_STEPS = 32

export const SB_SHEEN_TABLE_CHANNELS = 4


export const SB_SHEEN_TABLE_TEXTURE_UNIT_CONSUMER = "sheenLtc"

const ALBEDO_CHANNEL = 0
const LTC_SCALE_CHANNEL = 1
const LTC_SKEW_CHANNEL = 2
const MEAN_LENGTH_CHANNEL = 3


export function buildSheenLtcTable(options) {
	const viewCosineSteps = Math.max(2, Math.round(options?.viewCosineSteps ?? SB_SHEEN_TABLE_VIEW_COSINE_STEPS))
	const roughnessSteps = Math.max(2, Math.round(options?.roughnessSteps ?? SB_SHEEN_TABLE_ROUGHNESS_STEPS))
	const data = new Float32Array(viewCosineSteps * roughnessSteps * SB_SHEEN_TABLE_CHANNELS)

	for (let roughnessIndex = 0; roughnessIndex < roughnessSteps; roughnessIndex += 1) {
		const sheenRoughness = roughnessIndex / (roughnessSteps - 1)
		for (let viewCosineIndex = 0; viewCosineIndex < viewCosineSteps; viewCosineIndex += 1) {
			const viewCosine = viewCosineIndex / (viewCosineSteps - 1)
			const statistics = integrateSheenLobeStatistics({
				viewCosine,
				sheenRoughness,
				polarSteps: options?.polarSteps ?? SB_SHEEN_TABLE_QUADRATURE_STEPS,
				azimuthSteps: options?.azimuthSteps ?? SB_SHEEN_TABLE_QUADRATURE_STEPS,
			})
			const fitted = fitSheenLtcFromStatistics(statistics)
			const offset = (roughnessIndex * viewCosineSteps + viewCosineIndex) * SB_SHEEN_TABLE_CHANNELS
			data[offset + ALBEDO_CHANNEL] = fitted.albedo
			data[offset + LTC_SCALE_CHANNEL] = fitted.ltcScale
			data[offset + LTC_SKEW_CHANNEL] = fitted.ltcSkew
			data[offset + MEAN_LENGTH_CHANNEL] = fitted.meanLength
		}
	}

	return { viewCosineSteps, roughnessSteps, channels: SB_SHEEN_TABLE_CHANNELS, data }
}

function clampIndex(index, steps) {
	return Math.min(Math.max(index, 0), steps - 1)
}


export function sheenLtcTableEntryAt(table, viewCosineIndex, roughnessIndex) {
	const clampedViewIndex = clampIndex(Math.round(viewCosineIndex), table.viewCosineSteps)
	const clampedRoughnessIndex = clampIndex(Math.round(roughnessIndex), table.roughnessSteps)
	const offset = (clampedRoughnessIndex * table.viewCosineSteps + clampedViewIndex) * table.channels
	return {
		albedo: table.data[offset + ALBEDO_CHANNEL],
		ltcScale: table.data[offset + LTC_SCALE_CHANNEL],
		ltcSkew: table.data[offset + LTC_SKEW_CHANNEL],
		meanLength: table.data[offset + MEAN_LENGTH_CHANNEL],
	}
}


export function sampleSheenLtcTable(table, viewCosine, sheenRoughness) {
	const viewPosition = clampToUnitRange(viewCosine) * (table.viewCosineSteps - 1)
	const roughnessPosition = clampToUnitRange(sheenRoughness) * (table.roughnessSteps - 1)
	const lowViewIndex = clampIndex(Math.floor(viewPosition), table.viewCosineSteps)
	const lowRoughnessIndex = clampIndex(Math.floor(roughnessPosition), table.roughnessSteps)
	const highViewIndex = clampIndex(lowViewIndex + 1, table.viewCosineSteps)
	const highRoughnessIndex = clampIndex(lowRoughnessIndex + 1, table.roughnessSteps)
	const viewFraction = viewPosition - lowViewIndex
	const roughnessFraction = roughnessPosition - lowRoughnessIndex

	const lowLow = sheenLtcTableEntryAt(table, lowViewIndex, lowRoughnessIndex)
	const highLow = sheenLtcTableEntryAt(table, highViewIndex, lowRoughnessIndex)
	const lowHigh = sheenLtcTableEntryAt(table, lowViewIndex, highRoughnessIndex)
	const highHigh = sheenLtcTableEntryAt(table, highViewIndex, highRoughnessIndex)

	function blend(channelName) {
		const lowRow = lowLow[channelName] + (highLow[channelName] - lowLow[channelName]) * viewFraction
		const highRow = lowHigh[channelName] + (highHigh[channelName] - lowHigh[channelName]) * viewFraction
		return lowRow + (highRow - lowRow) * roughnessFraction
	}

	return {
		albedo: blend("albedo"),
		ltcScale: blend("ltcScale"),
		ltcSkew: blend("ltcSkew"),
		meanLength: blend("meanLength"),
	}
}


export function sheenLtcTableTexturePayload(table) {
	return {
		data: table.data,
		width: table.viewCosineSteps,
		height: table.roughnessSteps,
		channels: table.channels,
	}
}


export function sheenLtcTableChecksum(table) {
	const bytes = new Uint8Array(table.data.buffer, table.data.byteOffset, table.data.byteLength)
	let hash = 0x811c9dc5
	for (let index = 0; index < bytes.length; index += 1) {
		hash ^= bytes[index]
		hash = Math.imul(hash, 0x01000193) >>> 0
	}
	return hash.toString(16).padStart(8, "0")
}
