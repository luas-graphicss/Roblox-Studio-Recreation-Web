import {
	SB_SPECULAR_PROFILE_NEUTRAL_INDEX,
	clampCosine,
	specularProfileCount,
	specularProfileGain,
	specularProfileIds,
} from "./sbSpecularProfileCatalog.js"


export const SB_SPECULAR_PROFILE_LUT_SIZE = 32


export const SB_SPECULAR_PROFILE_GAIN_STEPS_PER_UNIT = 128


export const SB_SPECULAR_PROFILE_MAX_GAIN = 255 / SB_SPECULAR_PROFILE_GAIN_STEPS_PER_UNIT


export const SB_SPECULAR_PROFILE_ATLAS_CHANNELS = 4


export const SB_SPECULAR_PROFILE_TEXTURE_UNITS = 1


export const SB_SPECULAR_PROFILE_CLOSURE_BYTES = 1

export function specularProfileAtlasWidth() {
	return SB_SPECULAR_PROFILE_LUT_SIZE
}

export function specularProfileAtlasHeight() {
	return SB_SPECULAR_PROFILE_LUT_SIZE * specularProfileCount()
}


export function specularProfileAxisValue(axisIndex) {
	const lastIndex = SB_SPECULAR_PROFILE_LUT_SIZE - 1
	const clampedIndex = Math.min(lastIndex, Math.max(0, axisIndex))
	return clampedIndex / lastIndex
}


export function specularProfileAxisCoordinate(cosTheta) {
	return clampCosine(cosTheta) * (SB_SPECULAR_PROFILE_LUT_SIZE - 1)
}

export function encodeSpecularProfileGain(gain) {
	if (!Number.isFinite(gain)) return SB_SPECULAR_PROFILE_GAIN_STEPS_PER_UNIT
	const encoded = Math.round(gain * SB_SPECULAR_PROFILE_GAIN_STEPS_PER_UNIT)
	return Math.min(255, Math.max(0, encoded))
}

export function decodeSpecularProfileGain(byteValue) {
	return byteValue / SB_SPECULAR_PROFILE_GAIN_STEPS_PER_UNIT
}


export function specularProfileQuantizationStepAsRangeFraction() {
	return 1 / SB_SPECULAR_PROFILE_GAIN_STEPS_PER_UNIT / SB_SPECULAR_PROFILE_MAX_GAIN
}


export function specularProfileAtlasSignature() {
	return [
		"sbSpecularProfileAtlas",
		SB_SPECULAR_PROFILE_LUT_SIZE,
		SB_SPECULAR_PROFILE_GAIN_STEPS_PER_UNIT,
		specularProfileIds().join("+"),
	].join(":")
}

function atlasByteOffset(profileIndex, viewIndex, lightIndex) {
	const row = profileIndex * SB_SPECULAR_PROFILE_LUT_SIZE + lightIndex
	return (row * specularProfileAtlasWidth() + viewIndex) * SB_SPECULAR_PROFILE_ATLAS_CHANNELS
}

export function buildSpecularProfileAtlas() {
	const lutSize = SB_SPECULAR_PROFILE_LUT_SIZE
	const profileCount = specularProfileCount()
	const width = specularProfileAtlasWidth()
	const height = specularProfileAtlasHeight()
	const data = new Uint8Array(width * height * SB_SPECULAR_PROFILE_ATLAS_CHANNELS)

	for (let profileIndex = 0; profileCount > profileIndex; profileIndex += 1) {
		for (let lightIndex = 0; lutSize > lightIndex; lightIndex += 1) {
			for (let viewIndex = 0; lutSize > viewIndex; viewIndex += 1) {
				const gain = specularProfileGain(
					profileIndex,
					specularProfileAxisValue(viewIndex),
					specularProfileAxisValue(lightIndex),
				)
				const encodedGain = encodeSpecularProfileGain(gain)
				const offset = atlasByteOffset(profileIndex, viewIndex, lightIndex)
				data[offset] = encodedGain
				data[offset + 1] = encodedGain
				data[offset + 2] = encodedGain
				data[offset + 3] = 255
			}
		}
	}

	return {
		lutSize,
		profileCount,
		width,
		height,
		channels: SB_SPECULAR_PROFILE_ATLAS_CHANNELS,
		data,
		byteLength: data.length,
		signature: specularProfileAtlasSignature(),
	}
}


export function readSpecularProfileTexel(atlas, profileIndex, viewIndex, lightIndex) {
	if (!atlas || !atlas.data) return 1
	const lastAxisIndex = atlas.lutSize - 1
	const clampedProfile = Math.min(atlas.profileCount - 1, Math.max(0, profileIndex))
	const clampedView = Math.min(lastAxisIndex, Math.max(0, viewIndex))
	const clampedLight = Math.min(lastAxisIndex, Math.max(0, lightIndex))
	return decodeSpecularProfileGain(atlas.data[atlasByteOffset(clampedProfile, clampedView, clampedLight)])
}


function interpolateLinear(from, to, fraction) {
	return from + (to - from) * fraction
}


export function sampleSpecularProfileGain(atlas, profileIndex, cosThetaView, cosThetaLight) {
	if (!atlas || !atlas.data) return 1
	const validIndex = Number.isInteger(profileIndex) && profileIndex >= 0 && atlas.profileCount > profileIndex
	const resolvedProfile = validIndex ? profileIndex : SB_SPECULAR_PROFILE_NEUTRAL_INDEX

	const columnCoordinate = specularProfileAxisCoordinate(cosThetaView)
	const rowCoordinate = specularProfileAxisCoordinate(cosThetaLight)
	const leftColumn = Math.floor(columnCoordinate)
	const lowerRow = Math.floor(rowCoordinate)
	const rightColumn = Math.min(atlas.lutSize - 1, leftColumn + 1)
	const upperRow = Math.min(atlas.lutSize - 1, lowerRow + 1)
	const columnFraction = columnCoordinate - leftColumn
	const rowFraction = rowCoordinate - lowerRow

	const lowerGain = interpolateLinear(
		readSpecularProfileTexel(atlas, resolvedProfile, leftColumn, lowerRow),
		readSpecularProfileTexel(atlas, resolvedProfile, rightColumn, lowerRow),
		columnFraction,
	)
	const upperGain = interpolateLinear(
		readSpecularProfileTexel(atlas, resolvedProfile, leftColumn, upperRow),
		readSpecularProfileTexel(atlas, resolvedProfile, rightColumn, upperRow),
		columnFraction,
	)
	return interpolateLinear(lowerGain, upperGain, rowFraction)
}


export function findSpecularProfileEncodingProblems(atlas) {
	const builtAtlas = atlas ?? buildSpecularProfileAtlas()
	const problems = []
	const halfStep = 0.5 / SB_SPECULAR_PROFILE_GAIN_STEPS_PER_UNIT

	if (builtAtlas.byteLength !== builtAtlas.width * builtAtlas.height * SB_SPECULAR_PROFILE_ATLAS_CHANNELS) {
		problems.push("o atlas nao tem o tamanho declarado")
	}
	if (builtAtlas.height !== builtAtlas.lutSize * builtAtlas.profileCount) {
		problems.push("a altura do atlas nao fecha com a quantidade de perfis")
	}

	for (let profileIndex = 0; builtAtlas.profileCount > profileIndex; profileIndex += 1) {
		for (let lightIndex = 0; builtAtlas.lutSize > lightIndex; lightIndex += 1) {
			for (let viewIndex = 0; builtAtlas.lutSize > viewIndex; viewIndex += 1) {
				const rawGain = specularProfileGain(
					profileIndex,
					specularProfileAxisValue(viewIndex),
					specularProfileAxisValue(lightIndex),
				)
				const storedGain = readSpecularProfileTexel(builtAtlas, profileIndex, viewIndex, lightIndex)
				if (rawGain > SB_SPECULAR_PROFILE_MAX_GAIN) {
					problems.push("perfil " + profileIndex + " passou do ganho maximo representavel")
				}
				if (Math.abs(rawGain - storedGain) > halfStep + 1e-9) {
					problems.push("perfil " + profileIndex + " perdeu mais de meio degrau na quantizacao")
				}
				if (profileIndex === SB_SPECULAR_PROFILE_NEUTRAL_INDEX && storedGain !== 1) {
					problems.push("o perfil neutro quantizado deixou de ser 1 exato")
				}
			}
		}
	}

	return Array.from(new Set(problems))
}

export function describeSpecularProfileLut(atlas) {
	const builtAtlas = atlas ?? buildSpecularProfileAtlas()
	return {
		lutSize: builtAtlas.lutSize,
		profileCount: builtAtlas.profileCount,
		width: builtAtlas.width,
		height: builtAtlas.height,
		byteLength: builtAtlas.byteLength,
		maxGain: SB_SPECULAR_PROFILE_MAX_GAIN,
		gainStepsPerUnit: SB_SPECULAR_PROFILE_GAIN_STEPS_PER_UNIT,
		quantizationStepAsRangeFraction: specularProfileQuantizationStepAsRangeFraction(),
		textureUnits: SB_SPECULAR_PROFILE_TEXTURE_UNITS,
		signature: builtAtlas.signature,
	}
}


export function compareSpecularProfiles(atlas, leftProfileIndex, rightProfileIndex) {
	const builtAtlas = atlas ?? buildSpecularProfileAtlas()
	let maximumDifference = 0
	let differenceSum = 0
	let differingTexels = 0
	let texelCount = 0

	for (let lightIndex = 0; builtAtlas.lutSize > lightIndex; lightIndex += 1) {
		for (let viewIndex = 0; builtAtlas.lutSize > viewIndex; viewIndex += 1) {
			const leftGain = readSpecularProfileTexel(builtAtlas, leftProfileIndex, viewIndex, lightIndex)
			const rightGain = readSpecularProfileTexel(builtAtlas, rightProfileIndex, viewIndex, lightIndex)
			const difference = Math.abs(leftGain - rightGain)
			maximumDifference = Math.max(maximumDifference, difference)
			differenceSum += difference
			if (difference > 0) differingTexels += 1
			texelCount += 1
		}
	}

	return {
		maximumDifference,
		meanDifference: differenceSum / texelCount,
		differingTexels,
		texelCount,
		differingFraction: differingTexels / texelCount,
	}
}
