export const SB_REFERENCE_SEED = 20260905

const UINT32_LIMIT = 4294967296
const FALLBACK_STATE = 0x9e3779b9


function normalizeSeed(seed) {
	const numericSeed = Number(seed)
	if (!Number.isFinite(numericSeed)) return FALLBACK_STATE
	const truncatedSeed = Math.floor(Math.abs(numericSeed)) % UINT32_LIMIT
	return truncatedSeed === 0 ? FALLBACK_STATE : truncatedSeed >>> 0
}


function advanceState(state) {
	let nextState = state >>> 0
	nextState ^= nextState << 13
	nextState >>>= 0
	nextState ^= nextState >>> 17
	nextState ^= nextState << 5
	return nextState >>> 0
}

export function createSeededRandomGenerator(seed) {
	const initialState = normalizeSeed(seed)
	let state = initialState
	return {
		seed: initialState,
		nextFloat() {
			state = advanceState(state)
			return state / UINT32_LIMIT
		},
	}
}


export function deriveSeed(seed, index) {
	const mixedState = (normalizeSeed(seed) ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0
	return normalizeSeed(advanceState(mixedState))
}


export function resolveStratifiedSampleCount(requestedSampleCount) {
	const requested = Math.floor(Number(requestedSampleCount))
	if (!Number.isFinite(requested) || requested < 1) return 1
	const gridSize = Math.max(1, Math.round(Math.sqrt(requested)))
	return gridSize * gridSize
}


export function generateStratifiedSamples(options) {
	const sampleCount = resolveStratifiedSampleCount(options?.sampleCount)
	const gridSize = Math.round(Math.sqrt(sampleCount))
	const random = createSeededRandomGenerator(options?.seed ?? SB_REFERENCE_SEED)
	const samples = new Array(sampleCount)
	let sampleIndex = 0
	for (let row = 0; row < gridSize; row += 1) {
		for (let column = 0; column < gridSize; column += 1) {
			samples[sampleIndex] = {
				u: (column + random.nextFloat()) / gridSize,
				v: (row + random.nextFloat()) / gridSize,
			}
			sampleIndex += 1
		}
	}
	return { samples, sampleCount, gridSize, seed: random.seed }
}
