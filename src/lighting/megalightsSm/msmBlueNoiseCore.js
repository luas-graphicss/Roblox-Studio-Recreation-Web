import {
	MSM_BLUE_NOISE_BYTE_COUNT,
	MSM_BLUE_NOISE_CHANNEL_COUNT,
	MSM_BLUE_NOISE_PIXELS_PER_SLICE,
	MSM_BLUE_NOISE_SLICE_COUNT,
	MSM_BLUE_NOISE_TILE_SIZE,
	MSM_BLUE_NOISE_VALUE_LEVEL_COUNT,
	blueNoiseByteOffsetOf,
	blueNoiseUnitValueFromByte,
	describeBlueNoiseShape,
	readBlueNoiseByte,
} from "./msmBlueNoiseDescriptorCore.js";
import { MSM_ENERGY_KERNEL_SIGMA } from "./msmBlueNoiseEnergyFieldCore.js";
import { MSM_VOID_AND_CLUSTER_INITIAL_DENSITY, buildVoidAndClusterRankMask } from "./msmVoidAndClusterMaskCore.js";


export const MSM_BLUE_NOISE_OWNER_PHASE = "MSM-F11";


export const MSM_BLUE_NOISE_SLICE_BYTE_STEP = MSM_BLUE_NOISE_VALUE_LEVEL_COUNT / MSM_BLUE_NOISE_SLICE_COUNT;


export const MSM_BLUE_NOISE_CHANNEL_SEEDS = Object.freeze([0x4d534d00, 0x4d534d01, 0x4d534d02, 0x4d534d03]);


export const MSM_BLUE_NOISE_DECLARED_RESIDUALS = Object.freeze([
	Object.freeze({
		id: "sharedSpatialRankAcrossSlices",
		statement:
			"the 8 slices of a channel share one spatial rank order and differ only by a 32 byte value rotation; " +
			"the structure of the pattern does not change between frames, only the values do",
		reason:
			"independent masks per slice would destroy the exact per pixel stratum coverage, which is what pays for the " +
			"6 frame convergence of gate G6",
		observableAs: "a stable dither texture whose levels cycle, never as a repeated frame",
	}),
	Object.freeze({
		id: "temporalMeanBandOfEightStrata",
		statement: "the mean of the 8 samples of a pixel sits within 1/16 of 0.5, not exactly on it",
		reason: "eight strata of width 1/8 cannot centre closer than half a stratum; this is the floor of the design, not an error",
		observableAs: "a residual bias below 6.25% of the range, removed by the temporal filter of MSM-F13",
	}),
]);


export function blueNoiseByteForRank(rank, rankCount, sliceIndex) {
	const level = Math.floor((rank * MSM_BLUE_NOISE_VALUE_LEVEL_COUNT) / rankCount);
	const rotated = level + sliceIndex * MSM_BLUE_NOISE_SLICE_BYTE_STEP;
	return rotated % MSM_BLUE_NOISE_VALUE_LEVEL_COUNT;
}


export function generateBlueNoiseVolume(options) {
	const source = options && typeof options === "object" ? options : {};
	const sigma = Number.isFinite(source.sigma) && source.sigma > 0 ? Number(source.sigma) : MSM_ENERGY_KERNEL_SIGMA;
	const initialDensity =
		Number.isFinite(source.initialDensity) && source.initialDensity > 0 && source.initialDensity < 1
			? Number(source.initialDensity)
			: MSM_VOID_AND_CLUSTER_INITIAL_DENSITY;
	const seeds =
		Array.isArray(source.seeds) && source.seeds.length === MSM_BLUE_NOISE_CHANNEL_COUNT
			? source.seeds.slice()
			: MSM_BLUE_NOISE_CHANNEL_SEEDS.slice();

	const bytes = new Uint8Array(MSM_BLUE_NOISE_BYTE_COUNT);
	const channelRankMasks = [];

	for (let channelIndex = 0; channelIndex < MSM_BLUE_NOISE_CHANNEL_COUNT; channelIndex += 1) {
		const mask = buildVoidAndClusterRankMask({
			tileSize: MSM_BLUE_NOISE_TILE_SIZE,
			sigma,
			initialDensity,
			seed: seeds[channelIndex],
		});
		channelRankMasks.push(mask.ranks);

		for (let sliceIndex = 0; sliceIndex < MSM_BLUE_NOISE_SLICE_COUNT; sliceIndex += 1) {
			for (let tileY = 0; tileY < MSM_BLUE_NOISE_TILE_SIZE; tileY += 1) {
				for (let tileX = 0; tileX < MSM_BLUE_NOISE_TILE_SIZE; tileX += 1) {
					const rank = mask.ranks[tileY * MSM_BLUE_NOISE_TILE_SIZE + tileX];
					bytes[blueNoiseByteOffsetOf(tileX, tileY, sliceIndex, channelIndex)] = blueNoiseByteForRank(
						rank,
						MSM_BLUE_NOISE_PIXELS_PER_SLICE,
						sliceIndex,
					);
				}
			}
		}
	}

	return Object.freeze({
		ownerPhase: MSM_BLUE_NOISE_OWNER_PHASE,
		bytes,
		shape: describeBlueNoiseShape(),
		seeds: Object.freeze(seeds),
		sigma,
		initialDensity,
		sliceByteStep: MSM_BLUE_NOISE_SLICE_BYTE_STEP,
		channelRankMasks: Object.freeze(channelRankMasks),
	});
}


export function blueNoiseByteAt(volume, tileX, tileY, sliceIndex, channelIndex) {
	return readBlueNoiseByte(volume ? volume.bytes : null, tileX, tileY, sliceIndex, channelIndex);
}


export function blueNoiseUnitValueAt(volume, tileX, tileY, sliceIndex, channelIndex) {
	return blueNoiseUnitValueFromByte(blueNoiseByteAt(volume, tileX, tileY, sliceIndex, channelIndex));
}


export function describeBlueNoiseVolume(volume) {
	if (!volume) return { ownerPhase: MSM_BLUE_NOISE_OWNER_PHASE, built: false };
	return {
		ownerPhase: volume.ownerPhase,
		built: true,
		...volume.shape,
		sliceByteStep: volume.sliceByteStep,
		sigma: volume.sigma,
		initialDensity: volume.initialDensity,
		seeds: volume.seeds,
		declaredResidualCount: MSM_BLUE_NOISE_DECLARED_RESIDUALS.length,
	};
}
