import { discreteMicrofacetCount, litMicrofacetFraction, relativeStandardDeviationForCount } from "./sbGlintCore.js"
import {
	SB_GLINT_BASE_CELL_SIZE,
	SB_GLINT_COARSEST_LEVEL,
	SB_GLINT_LOD_LEVEL_COUNT,
	cellAreaForLevel,
	evaluateGlintWithLod,
} from "./sbGlintLodCore.js"
import { buildGlintLutData, glintLutRoundTripError } from "./sbGlintLutCore.js"


export const SB_GLINT_CERTIFICATION_SLAB = Object.freeze({
	glintDensity: 4000,
	glintRoughness: 0.04,
	baseRoughness: 0.22,
})

export const SB_GLINT_CERTIFICATION_HALF_VECTOR_COSINE = 0.985
export const SB_GLINT_CERTIFICATION_FRAME_COUNT = 30
export const SB_GLINT_CERTIFICATION_CELL_GRID_SIZE = 48
export const SB_GLINT_CERTIFICATION_ZERO_DENSITY_GRID_SIZE = 32
export const SB_GLINT_CERTIFICATION_UNBIASED_SAMPLE_COUNT = 20000
export const SB_GLINT_CERTIFICATION_EXPECTED_COUNTS = Object.freeze([0.25, 1, 4, 12, 40])
export const SB_GLINT_CERTIFICATION_LEVEL_EPSILON = 0.00001
export const SB_GLINT_CERTIFICATION_EPSILON_REFINEMENT = 10
export const SB_GLINT_CERTIFICATION_RELATIVE_JUMP_CEILING = 0.0001
export const SB_GLINT_CERTIFICATION_SIGMA_MULTIPLIER = 3

const DEFAULT_TEMPORAL_VARIANCE_GATE = 0.02
const DEFAULT_ENERGY_DEVIATION_GATE = 0.05
const SURFACE_POINT_STEP = 0.0037
const BOUNDARY_SURFACE_X = 0.321
const BOUNDARY_SURFACE_Y = 0.654

function footprintAreaForLevel(level) {
	return cellAreaForLevel(level)
}

function mean(values) {
	if (values.length === 0) return 0
	let total = 0
	for (const value of values) total += value
	return total / values.length
}

function variance(values) {
	if (values.length < 2) return 0
	const average = mean(values)
	let total = 0
	for (const value of values) total += (value - average) * (value - average)
	return total / values.length
}

function slabOptions(extraOptions) {
	return {
		glintDensity: SB_GLINT_CERTIFICATION_SLAB.glintDensity,
		glintRoughness: SB_GLINT_CERTIFICATION_SLAB.glintRoughness,
		baseRoughness: SB_GLINT_CERTIFICATION_SLAB.baseRoughness,
		halfVectorCosine: SB_GLINT_CERTIFICATION_HALF_VECTOR_COSINE,
		...extraOptions,
	}
}

function certificationLitFraction() {
	return litMicrofacetFraction({
		glintRoughness: SB_GLINT_CERTIFICATION_SLAB.glintRoughness,
		baseRoughness: SB_GLINT_CERTIFICATION_SLAB.baseRoughness,
	})
}


export function measureZeroDensityIdentity() {
	const gridSize = SB_GLINT_CERTIFICATION_ZERO_DENSITY_GRID_SIZE
	let worstAbsoluteDifference = 0
	let identicalCount = 0
	let sampleCount = 0
	for (let row = 0; row < gridSize; row += 1) {
		for (let column = 0; column < gridSize; column += 1) {
			const evaluation = evaluateGlintWithLod(
				slabOptions({
					glintDensity: 0,
					surfaceX: column * SURFACE_POINT_STEP,
					surfaceY: row * SURFACE_POINT_STEP,
					footprintArea: footprintAreaForLevel((row % SB_GLINT_LOD_LEVEL_COUNT) + 0.5),
				}),
			)
			sampleCount += 1
			if (evaluation.response === evaluation.smoothResponse) identicalCount += 1
			worstAbsoluteDifference = Math.max(
				worstAbsoluteDifference,
				Math.abs(evaluation.response - evaluation.smoothResponse),
			)
		}
	}
	return { sampleCount, identicalCount, worstAbsoluteDifference, identical: identicalCount === sampleCount }
}


function findLitSurfacePoint() {
	const footprintArea = footprintAreaForLevel(0.5)
	for (let step = 0; step < 20000; step += 1) {
		const surfaceX = step * SURFACE_POINT_STEP
		const surfaceY = (step % 97) * SURFACE_POINT_STEP
		const evaluation = evaluateGlintWithLod(slabOptions({ surfaceX, surfaceY, footprintArea }))
		if (evaluation.response > evaluation.smoothResponse) {
			return { surfaceX, surfaceY, footprintArea, searchSteps: step + 1, ratio: evaluation.ratio }
		}
	}
	return { surfaceX: 0, surfaceY: 0, footprintArea, searchSteps: 0, ratio: 1 }
}


export function measureTemporalStability(options) {
	const frameCount = Math.max(Math.trunc(Number(options?.frameCount) || SB_GLINT_CERTIFICATION_FRAME_COUNT), 2)
	const litPoint = findLitSurfacePoint()
	const responses = []
	for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
		const evaluation = evaluateGlintWithLod(
			slabOptions({
				surfaceX: litPoint.surfaceX,
				surfaceY: litPoint.surfaceY,
				footprintArea: litPoint.footprintArea,
			}),
		)
		responses.push(evaluation.response)
	}
	const firstResponse = responses[0]
	let maximumAbsoluteDeviation = 0
	for (const response of responses) {
		maximumAbsoluteDeviation = Math.max(maximumAbsoluteDeviation, Math.abs(response - firstResponse))
	}
	const averageResponse = mean(responses)
	const absoluteVariance = variance(responses)
	return {
		frameCount,
		meanResponse: averageResponse,
		variance: absoluteVariance,
		relativeVariance: averageResponse > 0 ? absoluteVariance / (averageResponse * averageResponse) : 0,
		maximumAbsoluteDeviation,
		identicalAcrossFrames: maximumAbsoluteDeviation === 0,
		litPointRatio: litPoint.ratio,
		litPointSearchSteps: litPoint.searchSteps,
	}
}


export function measureCountUnbiasedness(options) {
	const sampleCount = Math.max(
		Math.trunc(Number(options?.sampleCount) || SB_GLINT_CERTIFICATION_UNBIASED_SAMPLE_COUNT),
		100,
	)
	const levels = []
	let worstDeviation = 0
	for (const expectedCount of SB_GLINT_CERTIFICATION_EXPECTED_COUNTS) {
		let total = 0
		for (let cellIndex = 0; cellIndex < sampleCount; cellIndex += 1) {
			total += discreteMicrofacetCount({ expectedCount, cellX: cellIndex, cellY: -cellIndex, level: 0 })
		}
		const measuredMean = total / sampleCount
		const deviation = Math.abs(measuredMean / expectedCount - 1)
		worstDeviation = Math.max(worstDeviation, deviation)
		levels.push({
			expectedCount,
			measuredMean,
			deviation,
			standardError: 1 / Math.sqrt(expectedCount * sampleCount),
		})
	}
	return { sampleCount, levels, worstDeviation }
}


export function measureLodAliasing(options) {
	const gridSize = Math.max(Math.trunc(Number(options?.gridSize) || SB_GLINT_CERTIFICATION_CELL_GRID_SIZE), 8)
	const litFraction = certificationLitFraction()
	const levels = []
	for (let level = 0; level < SB_GLINT_LOD_LEVEL_COUNT; level += 1) {
		const cellArea = cellAreaForLevel(level)
		const expectedCount = SB_GLINT_CERTIFICATION_SLAB.glintDensity * cellArea * litFraction
		const ratios = []
		for (let row = 0; row < gridSize; row += 1) {
			for (let column = 0; column < gridSize; column += 1) {
				const count = discreteMicrofacetCount({ expectedCount, cellX: column, cellY: row, level })
				ratios.push(count / expectedCount)
			}
		}
		const measuredMean = mean(ratios)
		const standardDeviation = Math.sqrt(variance(ratios))
		const standardError = standardDeviation / Math.sqrt(ratios.length)
		levels.push({
			level,
			cellSize: SB_GLINT_BASE_CELL_SIZE * Math.pow(2, level),
			expectedCount,
			sampleCount: ratios.length,
			meanRatio: measuredMean,
			standardDeviation,
			predictedStandardDeviation: relativeStandardDeviationForCount(expectedCount),
			standardError,
			meanWithinThreeSigma:
				Math.abs(measuredMean - 1) <= SB_GLINT_CERTIFICATION_SIGMA_MULTIPLIER * standardError,
		})
	}
	let standardDeviationDecreases = true
	for (let index = 1; index < levels.length; index += 1) {
		if (!(levels[index].standardDeviation < levels[index - 1].standardDeviation)) standardDeviationDecreases = false
	}
	const beyondChain = evaluateGlintWithLod(
		slabOptions({
			surfaceX: 0.123,
			surfaceY: 0.456,
			footprintArea: footprintAreaForLevel(SB_GLINT_COARSEST_LEVEL + 4),
		}),
	)
	return {
		levels,
		standardDeviationDecreases,
		standardDeviationRange: [levels[0].standardDeviation, levels[levels.length - 1].standardDeviation],
		meansWithinThreeSigma: levels.every((entry) => entry.meanWithinThreeSigma),
		fadesToSmoothBeyondChain: beyondChain.response === beyondChain.smoothResponse,
		beyondChainFadeWeight: beyondChain.lod.smoothFadeWeight,
	}
}


function measureBoundaryJump(level, levelEpsilon) {
	const below = evaluateGlintWithLod(
		slabOptions({
			surfaceX: BOUNDARY_SURFACE_X,
			surfaceY: BOUNDARY_SURFACE_Y,
			footprintArea: footprintAreaForLevel(level - levelEpsilon),
		}),
	)
	const above = evaluateGlintWithLod(
		slabOptions({
			surfaceX: BOUNDARY_SURFACE_X,
			surfaceY: BOUNDARY_SURFACE_Y,
			footprintArea: footprintAreaForLevel(level + levelEpsilon),
		}),
	)
	return {
		levelEpsilon,
		jump: Math.abs(above.response - below.response),
		smoothResponse: below.smoothResponse,
	}
}


export function measureLodBlendContinuity() {
	const boundaries = []
	const refinedEpsilon = SB_GLINT_CERTIFICATION_LEVEL_EPSILON / SB_GLINT_CERTIFICATION_EPSILON_REFINEMENT
	let worstJump = 0
	let worstRelativeJump = 0
	let jumpsShrinkWithStep = true
	for (let level = 1; level < SB_GLINT_LOD_LEVEL_COUNT; level += 1) {
		const coarseStep = measureBoundaryJump(level, SB_GLINT_CERTIFICATION_LEVEL_EPSILON)
		const refinedStep = measureBoundaryJump(level, refinedEpsilon)
		const relativeJump = coarseStep.smoothResponse > 0 ? coarseStep.jump / coarseStep.smoothResponse : 0
		const shrinks = refinedStep.jump <= coarseStep.jump / 2
		if (!shrinks) jumpsShrinkWithStep = false
		worstJump = Math.max(worstJump, coarseStep.jump)
		worstRelativeJump = Math.max(worstRelativeJump, relativeJump)
		boundaries.push({ level, jump: coarseStep.jump, refinedJump: refinedStep.jump, relativeJump, shrinks })
	}
	return {
		boundaries,
		worstJump,
		worstRelativeJump,
		jumpsShrinkWithStep,
		refinedEpsilon,
		continuous: jumpsShrinkWithStep && worstRelativeJump <= SB_GLINT_CERTIFICATION_RELATIVE_JUMP_CEILING,
	}
}


export function certifyGlintModel(options) {
	const gates = options?.gates ?? {}
	const temporalVarianceGate = Number(gates.maxGlintTemporalVariance ?? DEFAULT_TEMPORAL_VARIANCE_GATE)
	const energyDeviationGate = Number(gates.maxEnergyDeviation ?? DEFAULT_ENERGY_DEVIATION_GATE)
	const zeroDensity = measureZeroDensityIdentity()
	const temporal = measureTemporalStability({ frameCount: options?.frameCount })
	const unbiasedness = measureCountUnbiasedness({ sampleCount: options?.sampleCount })
	const aliasing = measureLodAliasing({ gridSize: options?.gridSize })
	const continuity = measureLodBlendContinuity()
	const lut = { ...glintLutRoundTripError(), levelCount: buildGlintLutData().height }
	const problems = []
	if (!zeroDensity.identical) problems.push("densidade 0 nao devolveu o especular liso identico")
	if (!temporal.identicalAcrossFrames) {
		problems.push(`camera parada mudou a resposta em ${temporal.maximumAbsoluteDeviation}`)
	}
	if (!(temporal.variance <= temporalVarianceGate)) {
		problems.push(`variancia temporal ${temporal.variance} acima de ${temporalVarianceGate}`)
	}
	if (!(unbiasedness.worstDeviation <= energyDeviationGate)) {
		problems.push(`desvio de energia ${unbiasedness.worstDeviation.toFixed(4)} acima de ${energyDeviationGate}`)
	}
	if (!aliasing.standardDeviationDecreases) problems.push("o ruido nao cai monotonicamente nos 4 niveis de LOD")
	if (!aliasing.meansWithinThreeSigma) problems.push("a media por nivel saiu de tres sigmas")
	if (!aliasing.fadesToSmoothBeyondChain) problems.push("passada a cadeia de LOD a resposta nao virou o liso exato")
	if (!continuity.jumpsShrinkWithStep) problems.push("o salto na fronteira de LOD nao encolhe com o passo: e degrau")
	if (!(continuity.worstRelativeJump <= SB_GLINT_CERTIFICATION_RELATIVE_JUMP_CEILING)) {
		problems.push(`salto relativo de ${continuity.worstRelativeJump} em fronteira de LOD`)
	}
	if (!(lut.worstError <= 1 / 255)) problems.push(`erro de ida e volta da LUT ${lut.worstError} acima de um byte`)
	return {
		ok: problems.length === 0,
		problems,
		zeroDensity,
		temporal,
		unbiasedness,
		aliasing,
		continuity,
		lut,
		gates: { maxGlintTemporalVariance: temporalVarianceGate, maxEnergyDeviation: energyDeviationGate },
		levelCount: SB_GLINT_LOD_LEVEL_COUNT,
		baseCellSize: SB_GLINT_BASE_CELL_SIZE,
		litFraction: certificationLitFraction(),
	}
}
