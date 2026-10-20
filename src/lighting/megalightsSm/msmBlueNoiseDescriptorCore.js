export const MSM_BLUE_NOISE_TILE_SIZE = 64;


export const MSM_BLUE_NOISE_SLICE_COUNT = 8;


export const MSM_BLUE_NOISE_CHANNEL_COUNT = 4;


export const MSM_BLUE_NOISE_BYTES_PER_TEXEL = MSM_BLUE_NOISE_CHANNEL_COUNT;


export const MSM_BLUE_NOISE_VALUE_LEVEL_COUNT = 256;


export const MSM_BLUE_NOISE_TEXTURE_UNIT_COST = 1;

export const MSM_BLUE_NOISE_PIXELS_PER_SLICE = MSM_BLUE_NOISE_TILE_SIZE * MSM_BLUE_NOISE_TILE_SIZE;
export const MSM_BLUE_NOISE_TEXTURE_WIDTH = MSM_BLUE_NOISE_TILE_SIZE;
export const MSM_BLUE_NOISE_TEXTURE_HEIGHT = MSM_BLUE_NOISE_TILE_SIZE * MSM_BLUE_NOISE_SLICE_COUNT;
export const MSM_BLUE_NOISE_TEXEL_COUNT = MSM_BLUE_NOISE_PIXELS_PER_SLICE * MSM_BLUE_NOISE_SLICE_COUNT;
export const MSM_BLUE_NOISE_BYTE_COUNT = MSM_BLUE_NOISE_TEXEL_COUNT * MSM_BLUE_NOISE_BYTES_PER_TEXEL;
export const MSM_BLUE_NOISE_KILOBYTE_COUNT = MSM_BLUE_NOISE_BYTE_COUNT / 1024;


export const MSM_BLUE_NOISE_TEXTURE_REQUIREMENTS = Object.freeze({
	format: "RGBA8",
	minFilter: "nearest",
	magFilter: "nearest",
	wrap: "repeat",
	generateMipmaps: false,
	linearColorSpace: true,
	allocatedOnce: true,
});


export const MSM_BLUE_NOISE_SAMPLING_LAW = Object.freeze({
	atlasOrientation: "vertical: slice index walks along Y, one tile per slice",
	texelFormula: "atlasX = wrapTileCoordinate(pixelX); atlasY = blueNoiseSliceForFrame(frameIndex) * 64 + wrapTileCoordinate(pixelY)",


	unitValueFormula: "unitValue = byte / 256 = texture(tMsmBlueNoise, uv).c * (255.0 / 256.0)",
	unitValueRange: "[0, 1)",
	mirrorArgumentOrder: Object.freeze({
		blueNoiseTexelIndexOf: Object.freeze({
			arguments: Object.freeze(["tileX", "tileY", "sliceIndex"]),
			glslCounterpart: "msmBlueNoiseTexel",
			ownerPhase: "MSM-F14",
		}),
		blueNoiseSliceForFrame: Object.freeze({
			arguments: Object.freeze(["frameIndex"]),
			glslCounterpart: "msmBlueNoiseSlice",
			ownerPhase: "MSM-F14",
		}),
		blueNoiseUnitValueFromByte: Object.freeze({
			arguments: Object.freeze(["byteValue"]),
			glslCounterpart: "msmBlueNoiseUnitValue",
			ownerPhase: "MSM-F14",
		}),
	}),
});

function wrapInteger(value, period) {
	const integerValue = Math.floor(Number(value));
	if (!Number.isFinite(integerValue)) return 0;
	const wrapped = integerValue % period;
	return wrapped >= 0 ? wrapped : wrapped + period;
}


export function wrapTileCoordinate(coordinate) {
	return wrapInteger(coordinate, MSM_BLUE_NOISE_TILE_SIZE);
}


export function blueNoiseSliceForFrame(frameIndex) {
	return wrapInteger(frameIndex, MSM_BLUE_NOISE_SLICE_COUNT);
}


export function wrapChannelIndex(channelIndex) {
	return wrapInteger(channelIndex, MSM_BLUE_NOISE_CHANNEL_COUNT);
}


export function blueNoiseTexelIndexOf(tileX, tileY, sliceIndex) {
	const atlasX = wrapTileCoordinate(tileX);
	const atlasY = blueNoiseSliceForFrame(sliceIndex) * MSM_BLUE_NOISE_TILE_SIZE + wrapTileCoordinate(tileY);
	return atlasY * MSM_BLUE_NOISE_TEXTURE_WIDTH + atlasX;
}


export function blueNoiseByteOffsetOf(tileX, tileY, sliceIndex, channelIndex) {
	return (
		blueNoiseTexelIndexOf(tileX, tileY, sliceIndex) * MSM_BLUE_NOISE_BYTES_PER_TEXEL + wrapChannelIndex(channelIndex)
	);
}


export function readBlueNoiseByte(bytes, tileX, tileY, sliceIndex, channelIndex) {
	if (!bytes) return 0;
	const storedByte = bytes[blueNoiseByteOffsetOf(tileX, tileY, sliceIndex, channelIndex)];
	return Number.isFinite(storedByte) ? storedByte : 0;
}


export function blueNoiseUnitValueFromByte(byteValue) {
	return byteValue / MSM_BLUE_NOISE_VALUE_LEVEL_COUNT;
}


export function readBlueNoiseSlicePlane(bytes, sliceIndex, channelIndex, target) {
	const plane =
		target && target.length === MSM_BLUE_NOISE_PIXELS_PER_SLICE ? target : new Float64Array(MSM_BLUE_NOISE_PIXELS_PER_SLICE);
	for (let tileY = 0; tileY < MSM_BLUE_NOISE_TILE_SIZE; tileY += 1) {
		for (let tileX = 0; tileX < MSM_BLUE_NOISE_TILE_SIZE; tileX += 1) {
			plane[tileY * MSM_BLUE_NOISE_TILE_SIZE + tileX] = readBlueNoiseByte(bytes, tileX, tileY, sliceIndex, channelIndex);
		}
	}
	return plane;
}


export function describeBlueNoiseShape() {
	return {
		tileSize: MSM_BLUE_NOISE_TILE_SIZE,
		sliceCount: MSM_BLUE_NOISE_SLICE_COUNT,
		channelCount: MSM_BLUE_NOISE_CHANNEL_COUNT,
		pixelsPerSlice: MSM_BLUE_NOISE_PIXELS_PER_SLICE,
		textureWidth: MSM_BLUE_NOISE_TEXTURE_WIDTH,
		textureHeight: MSM_BLUE_NOISE_TEXTURE_HEIGHT,
		texelCount: MSM_BLUE_NOISE_TEXEL_COUNT,
		byteCount: MSM_BLUE_NOISE_BYTE_COUNT,
		kilobyteCount: MSM_BLUE_NOISE_KILOBYTE_COUNT,
		textureUnitCost: MSM_BLUE_NOISE_TEXTURE_UNIT_COST,
		valueLevelCount: MSM_BLUE_NOISE_VALUE_LEVEL_COUNT,
	};
}


export function validateBlueNoiseShape() {
	const problems = [];
	if (MSM_BLUE_NOISE_TILE_SIZE % 2 !== 0) problems.push("the tile side has to be even for the wrap to be cheap");
	if (MSM_BLUE_NOISE_VALUE_LEVEL_COUNT % MSM_BLUE_NOISE_SLICE_COUNT !== 0) {
		problems.push("the slice count has to divide the 256 byte levels, or the temporal strata cannot be exact");
	}
	if (MSM_BLUE_NOISE_BYTES_PER_TEXEL !== MSM_BLUE_NOISE_CHANNEL_COUNT) {
		problems.push("one byte per channel is the RGBA8 contract of plan 5.1");
	}
	if (MSM_BLUE_NOISE_TEXTURE_HEIGHT !== MSM_BLUE_NOISE_TILE_SIZE * MSM_BLUE_NOISE_SLICE_COUNT) {
		problems.push("the vertical atlas has to be exactly one tile per slice");
	}
	if (MSM_BLUE_NOISE_BYTE_COUNT !== 128 * 1024) {
		problems.push("plan 5.1 books 128 KB for this buffer, this shape costs " + MSM_BLUE_NOISE_BYTE_COUNT + " bytes");
	}
	return { ok: problems.length === 0, problems };
}
