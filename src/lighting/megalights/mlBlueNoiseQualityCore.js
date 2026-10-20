import { voxelCountOf, blueNoiseValueAt, pixelsPerSliceOf } from "./mlBlueNoiseDescriptor.js";


export const LOW_FREQUENCY_LIMIT = 0.125;
export const HIGH_FREQUENCY_LIMIT = 0.25;

function discreteFourierTransform2d(values, width, height) {
	const rowReal = new Float64Array(width * height);
	const rowImag = new Float64Array(width * height);
	for (let y = 0; y < height; y++) {
		for (let column = 0; column < width; column++) {
			let real = 0;
			let imaginary = 0;
			for (let x = 0; x < width; x++) {
				const angle = (-2 * Math.PI * column * x) / width;
				const sample = values[y * width + x];
				real += sample * Math.cos(angle);
				imaginary += sample * Math.sin(angle);
			}
			rowReal[y * width + column] = real;
			rowImag[y * width + column] = imaginary;
		}
	}
	const real = new Float64Array(width * height);
	const imaginary = new Float64Array(width * height);
	for (let column = 0; column < width; column++) {
		for (let row = 0; row < height; row++) {
			let sumReal = 0;
			let sumImaginary = 0;
			for (let y = 0; y < height; y++) {
				const angle = (-2 * Math.PI * row * y) / height;
				const cosine = Math.cos(angle);
				const sine = Math.sin(angle);
				const rowRealValue = rowReal[y * width + column];
				const rowImagValue = rowImag[y * width + column];
				sumReal += rowRealValue * cosine - rowImagValue * sine;
				sumImaginary += rowRealValue * sine + rowImagValue * cosine;
			}
			real[row * width + column] = sumReal;
			imaginary[row * width + column] = sumImaginary;
		}
	}
	return { real, imaginary };
}


export function radialPowerSpectrum(values, width, height) {
	const spectrum = discreteFourierTransform2d(values, width, height);
	let lowBandPower = 0;
	let lowBandBins = 0;
	let highBandPower = 0;
	let highBandBins = 0;
	for (let row = 0; row < height; row++) {
		for (let column = 0; column < width; column++) {
			if (row === 0 && column === 0) continue;
			const frequencyX = Math.min(column, width - column) / width;
			const frequencyY = Math.min(row, height - row) / height;
			const radius = Math.sqrt(frequencyX * frequencyX + frequencyY * frequencyY);
			const index = row * width + column;
			const power = spectrum.real[index] * spectrum.real[index] + spectrum.imaginary[index] * spectrum.imaginary[index];
			if (radius <= LOW_FREQUENCY_LIMIT) {
				lowBandPower += power;
				lowBandBins++;
			} else if (radius >= HIGH_FREQUENCY_LIMIT) {
				highBandPower += power;
				highBandBins++;
			}
		}
	}
	const lowBandMeanPower = lowBandBins ? lowBandPower / lowBandBins : 0;
	const highBandMeanPower = highBandBins ? highBandPower / highBandBins : 0;
	return {
		lowBandMeanPower,
		highBandMeanPower,
		lowBandBins,
		highBandBins,
		lowToHighPowerRatio: highBandMeanPower > 0 ? lowBandMeanPower / highBandMeanPower : Number.POSITIVE_INFINITY,
	};
}


export function slicePlaneOf(volume, channelIndex, sliceIndex) {
	const tileSize = volume.tileSize;
	const plane = new Float64Array(tileSize * tileSize);
	for (let y = 0; y < tileSize; y++) {
		for (let x = 0; x < tileSize; x++) {
			plane[y * tileSize + x] = blueNoiseValueAt(volume, channelIndex, x, y, sliceIndex);
		}
	}
	return plane;
}

export function spatialSpectrumReport(volume, channelIndex) {
	const perSliceRatios = [];
	for (let sliceIndex = 0; sliceIndex < volume.sliceCount; sliceIndex++) {
		const plane = slicePlaneOf(volume, channelIndex, sliceIndex);
		perSliceRatios.push(radialPowerSpectrum(plane, volume.tileSize, volume.tileSize).lowToHighPowerRatio);
	}
	const total = perSliceRatios.reduce((sum, ratio) => sum + ratio, 0);
	return {
		perSliceRatios,
		worstLowToHighPowerRatio: Math.max.apply(null, perSliceRatios),
		meanLowToHighPowerRatio: total / perSliceRatios.length,
	};
}


export function cyclicLagOneAutocorrelation(values) {
	const count = values.length;
	if (count < 2) return null;
	let mean = 0;
	for (let index = 0; index < count; index++) mean += values[index];
	mean /= count;
	let variance = 0;
	let covariance = 0;
	for (let index = 0; index < count; index++) {
		const current = values[index] - mean;
		const next = values[(index + 1) % count] - mean;
		variance += current * current;
		covariance += current * next;
	}
	if (variance <= 0) return null;
	return covariance / variance;
}


export function temporalLagOneAutocorrelation(volume, channelIndex) {
	const tileSize = volume.tileSize;
	const sliceCount = volume.sliceCount;
	let total = 0;
	let counted = 0;
	for (let y = 0; y < tileSize; y++) {
		for (let x = 0; x < tileSize; x++) {
			const sequence = new Float64Array(sliceCount);
			for (let sliceIndex = 0; sliceIndex < sliceCount; sliceIndex++) {
				sequence[sliceIndex] = blueNoiseValueAt(volume, channelIndex, x, y, sliceIndex);
			}
			const autocorrelation = cyclicLagOneAutocorrelation(sequence);
			if (autocorrelation === null) continue;
			total += autocorrelation;
			counted++;
		}
	}
	return counted ? total / counted : 0;
}


export function slicePairSeparation(volume, channelIndex, frameCount) {
	const pixelCount = pixelsPerSliceOf(volume);
	const slices = Math.min(frameCount, volume.sliceCount);
	let minimumMeanAbsoluteDifference = Number.POSITIVE_INFINITY;
	let identicalPairCount = 0;
	for (let first = 0; first < slices; first++) {
		for (let second = first + 1; second < slices; second++) {
			let totalAbsoluteDifference = 0;
			for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
				const x = pixelIndex % volume.tileSize;
				const y = Math.floor(pixelIndex / volume.tileSize);
				totalAbsoluteDifference += Math.abs(
					blueNoiseValueAt(volume, channelIndex, x, y, first) - blueNoiseValueAt(volume, channelIndex, x, y, second),
				);
			}
			const meanAbsoluteDifference = totalAbsoluteDifference / pixelCount;
			if (meanAbsoluteDifference === 0) identicalPairCount++;
			if (meanAbsoluteDifference < minimumMeanAbsoluteDifference) minimumMeanAbsoluteDifference = meanAbsoluteDifference;
		}
	}
	return { comparedSlices: slices, identicalPairCount, minimumMeanAbsoluteDifference };
}


export function whiteNoiseHashValue(x, y, frameIndex, dimensionIndex) {
	let hashed =
		(Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x85ebca6b) ^ Math.imul(frameIndex | 0, 0xc2b2ae35) ^ Math.imul((dimensionIndex | 0) + 1, 0x9e3779b1)) >>> 0;
	hashed ^= hashed >>> 15;
	hashed = Math.imul(hashed, 0x2c1b3c6d);
	hashed ^= hashed >>> 12;
	hashed = Math.imul(hashed, 0x297a2d39);
	hashed ^= hashed >>> 15;
	return (hashed >>> 0) / 4294967296;
}


export function createHashNoiseVolume(descriptor) {
	const voxelCount = voxelCountOf(descriptor);
	const tileSize = descriptor.tileSize;
	const channels = [];
	for (let channelIndex = 0; channelIndex < descriptor.channelCount; channelIndex++) {
		const channel = new Uint8Array(voxelCount);
		for (let voxelIndex = 0; voxelIndex < voxelCount; voxelIndex++) {
			const x = voxelIndex % tileSize;
			const y = Math.floor(voxelIndex / tileSize) % tileSize;
			const sliceIndex = Math.floor(voxelIndex / (tileSize * tileSize));
			channel[voxelIndex] = Math.min(255, Math.floor(whiteNoiseHashValue(x, y, sliceIndex, channelIndex) * 256));
		}
		channels.push(channel);
	}
	return Object.assign({}, descriptor, { channels });
}


export function temporalAccumulationError(request) {
	const width = request.width;
	const height = request.height;
	const frameCount = request.frameCount;
	const integrand = typeof request.integrand === "function" ? request.integrand : (value) => value;
	const exactIntegral = request.exactIntegral === undefined ? 0.5 : request.exactIntegral;
	let squaredErrorTotal = 0;
	let absoluteErrorTotal = 0;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let accumulated = 0;
			for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
				accumulated += integrand(request.sampleAt(x, y, frameIndex));
			}
			const error = accumulated / frameCount - exactIntegral;
			squaredErrorTotal += error * error;
			absoluteErrorTotal += Math.abs(error);
		}
	}
	const pixelCount = width * height;
	return {
		frameCount,
		pixelCount,
		rootMeanSquareError: Math.sqrt(squaredErrorTotal / pixelCount),
		meanAbsoluteError: absoluteErrorTotal / pixelCount,
	};
}
