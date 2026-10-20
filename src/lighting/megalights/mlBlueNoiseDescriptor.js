export const BLUE_NOISE_DEFAULTS = Object.freeze({
	tileSize: 32,
	sliceCount: 8,
	channelCount: 4,
	spatialSigma: 1.9,
	seed: 0x9e3779b9,
});

export const BLUE_NOISE_LIMITS = Object.freeze({
	minimumTileSize: 4,
	maximumTileSize: 128,
	minimumSliceCount: 2,
	maximumSliceCount: 64,
	maximumChannelCount: 4,
});

function clampInteger(value, minimum, maximum, fallback) {
	const asInteger = Math.floor(Number(value));
	if (!Number.isFinite(asInteger)) return fallback;
	return Math.max(minimum, Math.min(maximum, asInteger));
}

function positiveNumber(value, fallback) {
	const asNumber = Number(value);
	return Number.isFinite(asNumber) && asNumber > 0 ? asNumber : fallback;
}

export function normalizeBlueNoiseDescriptor(options) {
	const source = options || {};
	const limits = BLUE_NOISE_LIMITS;
	return Object.freeze({
		tileSize: clampInteger(source.tileSize, limits.minimumTileSize, limits.maximumTileSize, BLUE_NOISE_DEFAULTS.tileSize),
		sliceCount: clampInteger(source.sliceCount, limits.minimumSliceCount, limits.maximumSliceCount, BLUE_NOISE_DEFAULTS.sliceCount),
		channelCount: clampInteger(source.channelCount, 1, limits.maximumChannelCount, BLUE_NOISE_DEFAULTS.channelCount),
		spatialSigma: positiveNumber(source.spatialSigma, BLUE_NOISE_DEFAULTS.spatialSigma),
		seed: (Math.floor(Number(source.seed)) || BLUE_NOISE_DEFAULTS.seed) >>> 0,
	});
}

export function voxelCountOf(descriptor) {
	return descriptor.tileSize * descriptor.tileSize * descriptor.sliceCount;
}


export function pixelsPerSliceOf(descriptor) {
	return descriptor.tileSize * descriptor.tileSize;
}

function wrapIndex(value, period) {
	return ((Math.floor(value) % period) + period) % period;
}

export function blueNoiseVoxelIndex(descriptor, x, y, sliceIndex) {
	const tileSize = descriptor.tileSize;
	const wrappedSlice = wrapIndex(sliceIndex, descriptor.sliceCount);
	return (wrappedSlice * tileSize + wrapIndex(y, tileSize)) * tileSize + wrapIndex(x, tileSize);
}


export function sliceIndexForFrame(frameIndex, sliceCount) {
	return wrapIndex(frameIndex, sliceCount);
}


export function cycleIndexForFrame(frameIndex, sliceCount) {
	return Math.floor(Math.max(0, Math.floor(frameIndex)) / sliceCount);
}


export function blueNoiseValueAt(volume, channelIndex, x, y, sliceIndex) {
	const channel = volume.channels[wrapIndex(channelIndex, volume.channels.length)];
	return channel[blueNoiseVoxelIndex(volume, x, y, sliceIndex)] / 255;
}

export function describeBlueNoiseVolume(volume) {
	return {
		tileSize: volume.tileSize,
		sliceCount: volume.sliceCount,
		channelCount: volume.channelCount,
		voxelsPerChannel: voxelCountOf(volume),
		bytes: voxelCountOf(volume) * volume.channelCount,
		seed: volume.seed,
	};
}
