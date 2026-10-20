export const MGL_SEQUENCE_DIMENSION_COUNT = 4;

const POINT_SCALE = 1 / 4294967296;


const SOBOL_POLYNOMIALS = Object.freeze([
	Object.freeze({ degree: 1, coefficients: 0, initialM: Object.freeze([1]) }),
	Object.freeze({ degree: 2, coefficients: 1, initialM: Object.freeze([1, 3]) }),
	Object.freeze({ degree: 3, coefficients: 1, initialM: Object.freeze([1, 3, 1]) }),
]);

function buildDirectionNumbers(dimensionIndex) {
	const directions = new Uint32Array(32);
	if (dimensionIndex === 0) {
		for (let bit = 0; bit < 32; bit++) directions[bit] = (1 << (31 - bit)) >>> 0;
		return directions;
	}
	const polynomial = SOBOL_POLYNOMIALS[(dimensionIndex - 1) % SOBOL_POLYNOMIALS.length];
	const degree = polynomial.degree;
	const coefficients = polynomial.coefficients;
	const m = new Uint32Array(32);
	for (let index = 0; index < degree; index++) m[index] = polynomial.initialM[index];
	for (let index = degree; index < 32; index++) {
		let value = m[index - degree] ^ ((m[index - degree] << degree) >>> 0);
		for (let shift = 1; shift < degree; shift++) {
			const coefficientBit = (coefficients >>> (degree - 1 - shift)) & 1;
			if (coefficientBit) value ^= (m[index - shift] << shift) >>> 0;
		}
		m[index] = value >>> 0;
	}
	for (let index = 0; index < 32; index++) directions[index] = (m[index] << (31 - index)) >>> 0;
	return directions;
}

const DIRECTION_NUMBERS = (() => {
	const table = [];
	for (let dimensionIndex = 0; dimensionIndex < MGL_SEQUENCE_DIMENSION_COUNT; dimensionIndex++) {
		table.push(buildDirectionNumbers(dimensionIndex));
	}
	return table;
})();

export function reverseBits32(value) {
	let reversed = value >>> 0;
	reversed = ((reversed >>> 1) & 0x55555555) | ((reversed & 0x55555555) << 1);
	reversed = ((reversed >>> 2) & 0x33333333) | ((reversed & 0x33333333) << 2);
	reversed = ((reversed >>> 4) & 0x0f0f0f0f) | ((reversed & 0x0f0f0f0f) << 4);
	reversed = ((reversed >>> 8) & 0x00ff00ff) | ((reversed & 0x00ff00ff) << 8);
	reversed = (reversed >>> 16) | (reversed << 16);
	return reversed >>> 0;
}


export function sobolInteger(sampleIndex, dimensionIndex) {
	const directions = DIRECTION_NUMBERS[((dimensionIndex % MGL_SEQUENCE_DIMENSION_COUNT) + MGL_SEQUENCE_DIMENSION_COUNT) % MGL_SEQUENCE_DIMENSION_COUNT];
	let remaining = Math.max(0, Math.floor(sampleIndex)) >>> 0;
	let result = 0;
	let bit = 0;
	while (remaining !== 0 && bit < 32) {
		if (remaining & 1) result ^= directions[bit];
		remaining >>>= 1;
		bit++;
	}
	return result >>> 0;
}

function laineKarrasPermutation(value, seed) {
	let permuted = (value + seed) >>> 0;
	permuted = (permuted ^ Math.imul(permuted, 0x6c50b47c)) >>> 0;
	permuted = (permuted ^ Math.imul(permuted, 0xb82f1e52)) >>> 0;
	permuted = (permuted ^ Math.imul(permuted, 0xc7afe638)) >>> 0;
	permuted = (permuted ^ Math.imul(permuted, 0x8d22f6e6)) >>> 0;
	return permuted >>> 0;
}


export function owenScrambleInteger(value, seed) {
	return reverseBits32(laineKarrasPermutation(reverseBits32(value), seed >>> 0));
}

export function hashSeed(first, second) {
	let hashed = (Math.imul(first >>> 0, 0x9e3779b1) ^ Math.imul(second >>> 0, 0x85ebca6b)) >>> 0;
	hashed ^= hashed >>> 15;
	hashed = Math.imul(hashed, 0x2c1b3c6d);
	hashed ^= hashed >>> 12;
	hashed = Math.imul(hashed, 0x297a2d39);
	hashed ^= hashed >>> 15;
	return hashed >>> 0;
}


export function owenScrambledSobol(sampleIndex, dimensionIndex, seed) {
	const point = sobolInteger(sampleIndex, dimensionIndex);
	const scrambleSeed = seed === undefined || seed === null ? 0 : seed >>> 0;
	if (scrambleSeed === 0) return point * POINT_SCALE;
	return owenScrambleInteger(point, hashSeed(scrambleSeed, dimensionIndex + 1)) * POINT_SCALE;
}

function plasticConstant(dimensionCount) {
	let value = 2;
	for (let iteration = 0; iteration < 64; iteration++) {
		value = Math.pow(1 + value, 1 / (dimensionCount + 1));
	}
	return value;
}

export function irrationalStepsForDimensions(dimensionCount) {
	const count = Math.max(1, Math.floor(dimensionCount));
	const constant = plasticConstant(count);
	const steps = new Float64Array(count);
	for (let dimensionIndex = 0; dimensionIndex < count; dimensionIndex++) {
		const step = 1 / Math.pow(constant, dimensionIndex + 1);
		steps[dimensionIndex] = step - Math.floor(step);
	}
	return steps;
}

export const MGL_SEQUENCE_STEPS = irrationalStepsForDimensions(MGL_SEQUENCE_DIMENSION_COUNT);

function fract(value) {
	return value - Math.floor(value);
}


export function periodRotation(cycleIndex, dimensionIndex) {
	const dimension = ((dimensionIndex % MGL_SEQUENCE_DIMENSION_COUNT) + MGL_SEQUENCE_DIMENSION_COUNT) % MGL_SEQUENCE_DIMENSION_COUNT;
	return fract(Math.max(0, Math.floor(cycleIndex)) * MGL_SEQUENCE_STEPS[dimension]);
}


export function sampleFromBlueNoise(request) {
	const dimensionIndex = request.dimensionIndex || 0;
	const sobolPoint = owenScrambledSobol(request.sampleIndex || 0, dimensionIndex, request.scrambleSeed);
	return fract((request.blueNoiseValue || 0) + sobolPoint + periodRotation(request.cycleIndex || 0, dimensionIndex));
}
