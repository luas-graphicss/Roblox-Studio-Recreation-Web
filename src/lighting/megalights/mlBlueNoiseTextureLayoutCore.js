import { voxelCountOf, sliceIndexForFrame } from "./mlBlueNoiseDescriptor.js";

export const BLUE_NOISE_BYTES_PER_TEXEL = 4;

export function blueNoiseAtlasLayout(descriptor) {
	const width = descriptor.tileSize * descriptor.sliceCount;
	const height = descriptor.tileSize;
	return Object.freeze({
		width,
		height,
		tileSize: descriptor.tileSize,
		sliceCount: descriptor.sliceCount,
		channelCount: descriptor.channelCount,
		bytesPerTexel: BLUE_NOISE_BYTES_PER_TEXEL,
		byteLength: width * height * BLUE_NOISE_BYTES_PER_TEXEL,
	});
}


export function atlasTexelOf(layout, x, y, sliceIndex) {
	const tileSize = layout.tileSize;
	const wrappedX = ((Math.floor(x) % tileSize) + tileSize) % tileSize;
	const wrappedY = ((Math.floor(y) % tileSize) + tileSize) % tileSize;
	const wrappedSlice = sliceIndexForFrame(sliceIndex, layout.sliceCount);
	return { column: wrappedSlice * tileSize + wrappedX, row: wrappedY };
}

export function atlasByteOffsetOf(layout, x, y, sliceIndex, channelIndex) {
	const texel = atlasTexelOf(layout, x, y, sliceIndex);
	const channel = Math.max(0, Math.min(BLUE_NOISE_BYTES_PER_TEXEL - 1, Math.floor(channelIndex)));
	return (texel.row * layout.width + texel.column) * BLUE_NOISE_BYTES_PER_TEXEL + channel;
}


export function packBlueNoiseVolume(volume) {
	const layout = blueNoiseAtlasLayout(volume);
	const data = new Uint8Array(layout.byteLength);
	const voxelCount = voxelCountOf(volume);
	const tileSize = volume.tileSize;

	for (let channelIndex = 0; channelIndex < volume.channels.length; channelIndex++) {
		const channel = volume.channels[channelIndex];
		for (let voxelIndex = 0; voxelIndex < voxelCount; voxelIndex++) {
			const x = voxelIndex % tileSize;
			const y = Math.floor(voxelIndex / tileSize) % tileSize;
			const sliceIndex = Math.floor(voxelIndex / (tileSize * tileSize));
			data[atlasByteOffsetOf(layout, x, y, sliceIndex, channelIndex)] = channel[voxelIndex];
		}
	}

	return { layout, data };
}


export function readPackedByte(packed, x, y, sliceIndex, channelIndex) {
	return packed.data[atlasByteOffsetOf(packed.layout, x, y, sliceIndex, channelIndex)];
}
