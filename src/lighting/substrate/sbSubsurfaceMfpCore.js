import { SB_CLOSURE_LAYOUTS } from "./sbClosureLayouts.js"
import { SB_TIER_NAMES, tierDefaults } from "./sbMaterialContract.js"
import { slabParameterSchema } from "./sbSlabParametersCore.js"
import {
	SB_DEFAULT_SINGLE_SCATTERING_ALBEDO,
	cumulativeProfile,
	describeDiffusionProfile,
	shapingDistance,
} from "./sbDiffusionProfileCore.js"

export const SB_SUBSURFACE_PHASE_ID = "SB-F21"
export const SB_SUBSURFACE_PARAMETER_NAME = "subsurfaceMeanFreePath"
export const SB_SUBSURFACE_PHASE_PARAMETER_NAME = "subsurfacePhase"


export const SB_SUBSURFACE_CLOSURE_FIELDS = Object.freeze([
	SB_SUBSURFACE_PARAMETER_NAME,
	SB_SUBSURFACE_PHASE_PARAMETER_NAME,
])

export const SB_SUBSURFACE_MODES = Object.freeze({
	screenSpace: "screenSpace",
	simpleVolume: "simpleVolume",
	wrap: "wrap",
})

export const SB_SUBSURFACE_MODE_NAMES = Object.freeze(Object.keys(SB_SUBSURFACE_MODES))


export const SB_SUBSURFACE_LUT_WIDTH = 64
export const SB_SUBSURFACE_LUT_HEIGHT = 1
export const SB_SUBSURFACE_LUT_CHANNELS = 4


export const SB_SHARP_TERM_RADIUS_MILLIMETERS = 0.5


export const SB_REFERENCE_THICKNESS_MILLIMETERS = 1





export const SB_LEGACY_SSS_LITE_MAXIMUM_MILLIMETERS = 8

const FALLBACK_TIER_NAME = "forte"
const CHANNEL_COUNT = 3
const BYTE_MAXIMUM = 255

function clampToUnitRange(value) {
	if (!Number.isFinite(value)) return 0
	return Math.min(1, Math.max(0, value))
}

function toChannels(raw) {
	const asArray = Array.isArray(raw) ? raw : [raw, raw, raw]
	const channels = []
	for (let index = 0; index !== CHANNEL_COUNT; index += 1) {
		const value = Number(asArray[index])
		channels.push(Number.isFinite(value) ? value : 0)
	}
	return channels
}

function toByte(unitValue) {
	return Math.round(clampToUnitRange(unitValue) * BYTE_MAXIMUM)
}


export function maximumMeanFreePathMillimeters() {
	const maximum = Number(slabParameterSchema(SB_SUBSURFACE_PARAMETER_NAME)?.maximum)
	return Number.isFinite(maximum) && maximum > 0 ? maximum : 0
}


export function minimumMeanFreePathMillimeters() {
	const minimum = Number(slabParameterSchema(SB_SUBSURFACE_PARAMETER_NAME)?.minimum)
	return Number.isFinite(minimum) ? minimum : 0
}


export function sanitizeMeanFreePath(raw) {
	const minimum = minimumMeanFreePathMillimeters()
	const maximum = maximumMeanFreePathMillimeters()
	return toChannels(raw).map((channel) => Math.min(maximum, Math.max(minimum, channel)))
}


export function sanitizeSubsurfacePhase(raw) {
	const schema = slabParameterSchema(SB_SUBSURFACE_PHASE_PARAMETER_NAME)
	const minimum = Number.isFinite(Number(schema?.minimum)) ? Number(schema.minimum) : -1
	const maximum = Number.isFinite(Number(schema?.maximum)) ? Number(schema.maximum) : 1
	const value = Number(raw)
	if (!Number.isFinite(value)) return 0
	return Math.min(maximum, Math.max(minimum, value))
}


export function isSubsurfaceActive(meanFreePathMillimeters) {
	return sanitizeMeanFreePath(meanFreePathMillimeters).some((channel) => channel > 0)
}


export function diffusionStrength(meanFreePathMillimeters) {
	const maximum = maximumMeanFreePathMillimeters()
	if (!(maximum > 0)) return 0
	const channels = sanitizeMeanFreePath(meanFreePathMillimeters)
	return clampToUnitRange(Math.max(channels[0], channels[1], channels[2]) / maximum)
}


export function resolveSubsurfaceMode(options = {}) {
	const tierName = SB_TIER_NAMES.includes(options.tierName) ? options.tierName : FALLBACK_TIER_NAME
	const tierMode = SB_SUBSURFACE_MODE_NAMES.includes(tierDefaults(tierName)?.subsurfaceMode)
		? tierDefaults(tierName).subsurfaceMode
		: SB_SUBSURFACE_MODES.wrap
	const requestedMode = options.requestedMode
	if (requestedMode === undefined || requestedMode === null) {
		return { mode: tierMode, tierName, source: "tier", refusal: null }
	}
	if (SB_SUBSURFACE_MODE_NAMES.includes(requestedMode)) {
		return { mode: requestedMode, tierName, source: "operador", refusal: null }
	}
	return { mode: tierMode, tierName, source: "tier", refusal: "modo desconhecido: " + String(requestedMode) }
}


export function wrapWidthFor(meanFreePathMillimeters) {
	const maximum = maximumMeanFreePathMillimeters()
	if (!(maximum > 0)) return 0
	const value = Number(meanFreePathMillimeters)
	if (!Number.isFinite(value) || 0 >= value) return 0
	return clampToUnitRange(value / maximum)
}


export function bleedFractionForChannel(options = {}) {
	const meanFreePathMillimeters = Number(options.meanFreePathMillimeters)
	if (!Number.isFinite(meanFreePathMillimeters) || 0 >= meanFreePathMillimeters) return 0
	const mode = SB_SUBSURFACE_MODE_NAMES.includes(options.mode) ? options.mode : SB_SUBSURFACE_MODES.screenSpace

	if (mode === SB_SUBSURFACE_MODES.wrap) {
		const wrapWidth = wrapWidthFor(meanFreePathMillimeters)
		return clampToUnitRange(wrapWidth / (1 + wrapWidth))
	}
	if (mode === SB_SUBSURFACE_MODES.simpleVolume) {
		return clampToUnitRange(1 - Math.exp(-meanFreePathMillimeters / SB_REFERENCE_THICKNESS_MILLIMETERS))
	}
	const shaping = shapingDistance({
		meanFreePathMillimeters,
		singleScatteringAlbedo: options.singleScatteringAlbedo,
	})
	return clampToUnitRange(1 - cumulativeProfile(SB_SHARP_TERM_RADIUS_MILLIMETERS, shaping))
}


export function wrappedDiffuse(dotNormalLight, wrapWidth) {
	const width = clampToUnitRange(wrapWidth)
	const cosine = Number.isFinite(dotNormalLight) ? dotNormalLight : 0
	const denominator = (1 + width) * (1 + width)
	return Math.max(0, (cosine + width) / denominator)
}


export function henyeyGreensteinPhase(cosineTheta, anisotropy) {
	const asymmetry = Math.min(0.99, Math.max(-0.99, Number.isFinite(anisotropy) ? anisotropy : 0))
	const cosine = Math.min(1, Math.max(-1, Number.isFinite(cosineTheta) ? cosineTheta : 0))
	const squared = asymmetry * asymmetry
	const denominator = 1 + squared - 2 * asymmetry * cosine
	if (!(denominator > 0)) return 0
	return (1 - squared) / (4 * Math.PI * Math.pow(denominator, 1.5))
}


export function volumeTransmittance(options = {}) {
	const thickness = Math.max(0, Number(options.thicknessMillimeters) || 0)
	return sanitizeMeanFreePath(options.meanFreePathMillimeters).map((channel) =>
		channel > 0 ? Math.exp(-thickness / channel) : 0,
	)
}


export function redistributeDiffuse(options = {}) {
	const directDiffuse = toChannels(options.directDiffuse)
	const indirectDiffuse = toChannels(options.indirectDiffuse)
	const bleedFraction = toChannels(options.bleedFraction).map(clampToUnitRange)
	const movedEnergy = directDiffuse.map((value, index) => value * bleedFraction[index])
	const totalBefore = directDiffuse.concat(indirectDiffuse).reduce((total, value) => total + value, 0)
	const nextDirect = directDiffuse.map((value, index) => value - movedEnergy[index])
	const nextIndirect = indirectDiffuse.map((value, index) => value + movedEnergy[index])
	return {
		directDiffuse: nextDirect,
		indirectDiffuse: nextIndirect,
		movedEnergy,
		totalBefore,
		totalAfter: nextDirect.concat(nextIndirect).reduce((total, value) => total + value, 0),
	}
}


export function convertLegacySssLiteToMeanFreePath(options = {}) {
	const scatterStrength = clampToUnitRange(options.scatterStrength)
	const scatterColor = toChannels(options.scatterColor ?? [1, 1, 1]).map(clampToUnitRange)
	const reach = Math.min(SB_LEGACY_SSS_LITE_MAXIMUM_MILLIMETERS, maximumMeanFreePathMillimeters())
	const longestChannel = scatterStrength * reach
	return sanitizeMeanFreePath(scatterColor.map((channel) => longestChannel * channel))
}


export function subsurfaceClosureBytes() {
	const payload = SB_CLOSURE_LAYOUTS?.slab?.payload ?? []
	return payload
		.filter((field) => SB_SUBSURFACE_CLOSURE_FIELDS.includes(field.name))
		.reduce((total, field) => total + field.bytes, 0)
}


export function bakeDiffusionLutRows(options = {}) {
	const requestedWidth = Math.floor(Number(options.width))
	const width = Number.isFinite(requestedWidth) && requestedWidth > 1 ? requestedWidth : SB_SUBSURFACE_LUT_WIDTH
	const mode = SB_SUBSURFACE_MODE_NAMES.includes(options.mode) ? options.mode : SB_SUBSURFACE_MODES.screenSpace
	const singleScatteringAlbedo = options.singleScatteringAlbedo ?? SB_DEFAULT_SINGLE_SCATTERING_ALBEDO
	const maximum = maximumMeanFreePathMillimeters()
	const rows = []
	for (let texelIndex = 0; texelIndex !== width; texelIndex += 1) {
		const meanFreePathMillimeters = (texelIndex / (width - 1)) * maximum
		rows.push({
			meanFreePathMillimeters,
			bleedFraction: bleedFractionForChannel({ meanFreePathMillimeters, mode, singleScatteringAlbedo }),
			wrapWidth: wrapWidthFor(meanFreePathMillimeters),
			referenceTransmittance:
				meanFreePathMillimeters > 0
					? Math.exp(-SB_REFERENCE_THICKNESS_MILLIMETERS / meanFreePathMillimeters)
					: 0,
		})
	}
	return rows
}


export function bakeDiffusionLutBytes(options = {}) {
	const rows = bakeDiffusionLutRows(options)
	const bytes = new Uint8Array(rows.length * SB_SUBSURFACE_LUT_CHANNELS)
	for (let rowIndex = 0; rowIndex !== rows.length; rowIndex += 1) {
		const offset = rowIndex * SB_SUBSURFACE_LUT_CHANNELS
		bytes[offset] = toByte(rows[rowIndex].bleedFraction)
		bytes[offset + 1] = toByte(rows[rowIndex].wrapWidth)
		bytes[offset + 2] = toByte(rows[rowIndex].referenceTransmittance)
		bytes[offset + 3] = BYTE_MAXIMUM
	}
	return bytes
}


export function resolveSubsurface(options = {}) {
	const modeResolution = resolveSubsurfaceMode(options)
	const meanFreePathMillimeters = sanitizeMeanFreePath(options.meanFreePathMillimeters)
	const singleScatteringAlbedo = options.singleScatteringAlbedo ?? SB_DEFAULT_SINGLE_SCATTERING_ALBEDO
	return {
		phaseId: SB_SUBSURFACE_PHASE_ID,
		mode: modeResolution.mode,
		modeSource: modeResolution.source,
		modeRefusal: modeResolution.refusal,
		tierName: modeResolution.tierName,
		active: isSubsurfaceActive(meanFreePathMillimeters),
		meanFreePathMillimeters,
		maximumMeanFreePathMillimeters: maximumMeanFreePathMillimeters(),
		singleScatteringAlbedo,
		subsurfacePhase: sanitizeSubsurfacePhase(options.subsurfacePhase),
		strength: diffusionStrength(meanFreePathMillimeters),
		bleedFractionByChannel: meanFreePathMillimeters.map((channel) =>
			bleedFractionForChannel({
				meanFreePathMillimeters: channel,
				mode: modeResolution.mode,
				singleScatteringAlbedo,
			}),
		),
		closureBytes: subsurfaceClosureBytes(),
		lutWidth: SB_SUBSURFACE_LUT_WIDTH,
	}
}


export function describeSubsurface(options = {}) {
	const resolved = resolveSubsurface(options)
	const longestChannel = Math.max(
		resolved.meanFreePathMillimeters[0],
		resolved.meanFreePathMillimeters[1],
		resolved.meanFreePathMillimeters[2],
	)
	return {
		...resolved,
		longestChannelMillimeters: longestChannel,
		profile: describeDiffusionProfile({
			meanFreePathMillimeters: longestChannel,
			singleScatteringAlbedo: resolved.singleScatteringAlbedo,
		}),
	}
}
