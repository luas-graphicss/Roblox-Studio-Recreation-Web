const KERNEL_SIGMA_MULTIPLIER = 2.5;


export const ENERGY_TIE_BREAKER_MAGNITUDE = 1e-3;

export function createEnergyKernel(descriptor) {
	const radius = Math.min(
		Math.ceil(descriptor.spatialSigma * KERNEL_SIGMA_MULTIPLIER),
		Math.floor((descriptor.tileSize - 1) / 2),
	);
	const denominator = 2 * descriptor.spatialSigma * descriptor.spatialSigma;
	const offsetsX = [];
	const offsetsY = [];
	const weights = [];

	for (let deltaY = -radius; deltaY <= radius; deltaY++) {
		for (let deltaX = -radius; deltaX <= radius; deltaX++) {


			if (deltaX === 0 && deltaY === 0) continue;
			offsetsX.push(deltaX);
			offsetsY.push(deltaY);
			weights.push(Math.exp(-(deltaX * deltaX + deltaY * deltaY) / denominator));
		}
	}

	return Object.freeze({
		radius,
		tapCount: weights.length,
		offsetsX: Int32Array.from(offsetsX),
		offsetsY: Int32Array.from(offsetsY),
		weights: Float64Array.from(weights),
	});
}


export function createEnergyField(descriptor, kernel) {
	const tileSize = descriptor.tileSize;
	const values = new Float64Array(tileSize * tileSize);

	return {
		values,
		tapCount: kernel.tapCount,
		addSampleAt(pixelIndex) {
			const x = pixelIndex % tileSize;
			const y = Math.floor(pixelIndex / tileSize);
			for (let tap = 0; tap < kernel.tapCount; tap++) {
				const targetX = (x + kernel.offsetsX[tap] + tileSize) % tileSize;
				const targetY = (y + kernel.offsetsY[tap] + tileSize) % tileSize;
				values[targetY * tileSize + targetX] += kernel.weights[tap];
			}
		},
	};
}


export function createTieBreakers(count, seed) {
	const tieBreakers = new Float64Array(count);
	for (let index = 0; index < count; index++) {
		let hashed = (index ^ seed) >>> 0;
		hashed ^= hashed >>> 16;
		hashed = Math.imul(hashed, 0x7feb352d);
		hashed ^= hashed >>> 15;
		hashed = Math.imul(hashed, 0x846ca68b);
		hashed ^= hashed >>> 16;
		tieBreakers[index] = ((hashed >>> 0) / 4294967296) * ENERGY_TIE_BREAKER_MAGNITUDE;
	}
	return tieBreakers;
}
