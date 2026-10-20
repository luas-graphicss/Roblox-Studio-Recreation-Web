import { normalizeBlueNoiseDescriptor, voxelCountOf, pixelsPerSliceOf } from "./mlBlueNoiseDescriptor.js";
import { createEnergyKernel, createEnergyField, createTieBreakers } from "./mlBlueNoiseEnergyField.js";
import { createSpatialMaskBuilder, spatialGroupsOf, groupPixelLists } from "./mlBlueNoiseSpatialMask.js";
import { createTemporalBandOrder } from "./mlBlueNoiseTemporalOrder.js";

const CHANNEL_SEED_STRIDE = 0x9e3779b1;
const ASSEMBLY_TIE_BREAKER_SEED_MIX = 0x5bf03635;


const MASK_WORK_SHARE = 0.5;


const DEFAULT_STEP_WORK_UNITS = 4096;

function createChannelRanker(descriptor, kernel, channelIndex) {
	const sliceCount = descriptor.sliceCount;
	const pixelCount = pixelsPerSliceOf(descriptor);
	const voxelCount = voxelCountOf(descriptor);
	const channelSeed = (descriptor.seed + Math.imul(channelIndex + 1, CHANNEL_SEED_STRIDE)) >>> 0;
	const bandOrder = createTemporalBandOrder(sliceCount);
	const maskBuilder = createSpatialMaskBuilder({ descriptor, kernel, seed: channelSeed });
	const tieBreakers = createTieBreakers(voxelCount, (channelSeed ^ ASSEMBLY_TIE_BREAKER_SEED_MIX) >>> 0);
	const ranks = new Int32Array(voxelCount).fill(-1);
	const sliceFields = [];
	const candidatePixelsBySlice = [];
	const candidateCountBySlice = new Int32Array(sliceCount);
	let pixelsByGroup = null;
	let bandIndex = 0;
	let assignedRankCount = 0;
	let nextSliceToServe = 0;

	function beginBand(nextBandIndex) {
		bandIndex = nextBandIndex;
		for (let sliceIndex = 0; sliceIndex < sliceCount; sliceIndex++) {
			const hostedPixels = pixelsByGroup[bandOrder.groupHostedBy(sliceIndex, bandIndex)];
			candidatePixelsBySlice[sliceIndex].set(hostedPixels);
			candidateCountBySlice[sliceIndex] = hostedPixels.length;
		}


		nextSliceToServe = bandIndex % sliceCount;
	}

	function beginAssembly() {
		const groups = spatialGroupsOf(maskBuilder.ranks(), sliceCount);
		pixelsByGroup = groupPixelLists(groups, sliceCount);
		for (let sliceIndex = 0; sliceIndex < sliceCount; sliceIndex++) {
			sliceFields.push(createEnergyField(descriptor, kernel));
			candidatePixelsBySlice.push(new Int32Array(pixelCount));
		}
		beginBand(0);
	}

	function nextSliceWithCandidates() {
		for (let attempt = 0; attempt < sliceCount; attempt++) {
			const sliceIndex = (nextSliceToServe + attempt) % sliceCount;
			if (candidateCountBySlice[sliceIndex] > 0) {
				nextSliceToServe = (sliceIndex + 1) % sliceCount;
				return sliceIndex;
			}
		}
		return -1;
	}

	function leastCrowdedCandidatePosition(sliceIndex) {
		const fieldValues = sliceFields[sliceIndex].values;
		const candidates = candidatePixelsBySlice[sliceIndex];
		const candidateCount = candidateCountBySlice[sliceIndex];
		const voxelBase = sliceIndex * pixelCount;
		let bestPosition = 0;
		let bestScore = fieldValues[candidates[0]] + tieBreakers[voxelBase + candidates[0]];
		for (let position = 1; position < candidateCount; position++) {
			const pixelIndex = candidates[position];
			const score = fieldValues[pixelIndex] + tieBreakers[voxelBase + pixelIndex];
			if (score < bestScore) {
				bestScore = score;
				bestPosition = position;
			}
		}
		return bestPosition;
	}

	function rankCandidate(sliceIndex, position) {
		const candidates = candidatePixelsBySlice[sliceIndex];
		const pixelIndex = candidates[position];
		candidateCountBySlice[sliceIndex]--;
		candidates[position] = candidates[candidateCountBySlice[sliceIndex]];
		ranks[sliceIndex * pixelCount + pixelIndex] = assignedRankCount;
		assignedRankCount++;
		sliceFields[sliceIndex].addSampleAt(pixelIndex);
	}

	function stepAssembly(workUnitBudget) {
		let consumedUnits = 0;
		while (assignedRankCount < voxelCount && consumedUnits < workUnitBudget) {
			const sliceIndex = nextSliceWithCandidates();
			if (sliceIndex < 0) {
				beginBand(bandIndex + 1);
				continue;
			}
			consumedUnits += candidateCountBySlice[sliceIndex] + kernel.tapCount;
			rankCandidate(sliceIndex, leastCrowdedCandidatePosition(sliceIndex));
		}
		return consumedUnits;
	}

	return {
		isComplete() {
			return assignedRankCount >= voxelCount;
		},
		progress() {
			const maskProgress = maskBuilder.progress() * MASK_WORK_SHARE;
			return maskProgress + (assignedRankCount / voxelCount) * (1 - MASK_WORK_SHARE);
		},
		step(workUnitBudget) {
			const budget = workUnitBudget > 0 ? workUnitBudget : 1;
			let consumedUnits = 0;
			if (!maskBuilder.isComplete()) {
				consumedUnits += maskBuilder.step(budget);
				if (maskBuilder.isComplete()) beginAssembly();
			}
			if (maskBuilder.isComplete() && consumedUnits < budget) {
				consumedUnits += stepAssembly(budget - consumedUnits);
			}
			return consumedUnits;
		},


		values() {
			const bytes = new Uint8Array(voxelCount);
			for (let voxelIndex = 0; voxelIndex < voxelCount; voxelIndex++) {
				bytes[voxelIndex] = Math.min(255, Math.floor((ranks[voxelIndex] * 256) / voxelCount));
			}
			return bytes;
		},
	};
}

export function createBlueNoiseVolumeBuilder(options) {
	const descriptor = normalizeBlueNoiseDescriptor(options);
	const kernel = createEnergyKernel(descriptor);
	const rankers = [];
	for (let channelIndex = 0; channelIndex < descriptor.channelCount; channelIndex++) {
		rankers.push(createChannelRanker(descriptor, kernel, channelIndex));
	}


	let activeChannelIndex = 0;

	function isComplete() {
		return activeChannelIndex >= rankers.length;
	}


	function step(workUnitBudget) {
		const budget = workUnitBudget > 0 ? workUnitBudget : DEFAULT_STEP_WORK_UNITS;
		let consumedUnits = 0;
		while (!isComplete() && consumedUnits < budget) {
			const ranker = rankers[activeChannelIndex];
			consumedUnits += ranker.step(budget - consumedUnits);
			if (ranker.isComplete()) activeChannelIndex++;
		}
		return { consumedUnits, complete: isComplete(), progress: progress() };
	}

	function progress() {
		let total = 0;
		for (let channelIndex = 0; channelIndex < rankers.length; channelIndex++) total += rankers[channelIndex].progress();
		return total / rankers.length;
	}

	function volume() {
		const channels = [];
		for (let channelIndex = 0; channelIndex < rankers.length; channelIndex++) channels.push(rankers[channelIndex].values());
		return Object.freeze(Object.assign({}, descriptor, { channels }));
	}

	function build() {
		while (!isComplete()) step(Number.MAX_SAFE_INTEGER);
		return volume();
	}


	return { descriptor, kernel, isComplete, progress, step, volume, build };
}


export function generateBlueNoiseVolume(options) {
	return createBlueNoiseVolumeBuilder(options).build();
}


export function estimatedWorkUnits(descriptor) {
	const normalized = normalizeBlueNoiseDescriptor(descriptor);
	const pixelCount = pixelsPerSliceOf(normalized);
	const voxelCount = voxelCountOf(normalized);
	const kernel = createEnergyKernel(normalized);
	const maskScanUnits = (pixelCount * pixelCount) / 2;
	const assemblyScanUnits = (pixelCount * pixelCount) / 2;
	const kernelUnits = (pixelCount + voxelCount) * kernel.tapCount;
	return Math.round((maskScanUnits + assemblyScanUnits + kernelUnits) * normalized.channelCount);
}
