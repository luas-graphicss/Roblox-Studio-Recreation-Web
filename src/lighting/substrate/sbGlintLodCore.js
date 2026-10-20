import { evaluateGlintResponse } from "./sbGlintCore.js"


export const SB_GLINT_LOD_LEVEL_COUNT = 4


export const SB_GLINT_BASE_CELL_SIZE = 0.01


export const SB_GLINT_COARSEST_LEVEL = SB_GLINT_LOD_LEVEL_COUNT - 1

function resolveBaseCellSize(baseCellSize) {
	const numericSize = Number(baseCellSize)
	return Number.isFinite(numericSize) && numericSize > 0 ? numericSize : SB_GLINT_BASE_CELL_SIZE
}

function clampToUnitRange(value) {
	return Math.min(Math.max(value, 0), 1)
}


function mixValues(fromValue, toValue, weight) {
	return fromValue + (toValue - fromValue) * weight
}

export function cellSizeForLevel(level, baseCellSize) {
	return resolveBaseCellSize(baseCellSize) * Math.pow(2, Math.max(Number(level) || 0, 0))
}

export function cellAreaForLevel(level, baseCellSize) {
	const cellSize = cellSizeForLevel(level, baseCellSize)
	return cellSize * cellSize
}


export function footprintAreaFromDerivatives(derivativeAlongScreenX, derivativeAlongScreenY) {
	const firstX = Number(derivativeAlongScreenX?.x) || 0
	const firstY = Number(derivativeAlongScreenX?.y) || 0
	const secondX = Number(derivativeAlongScreenY?.x) || 0
	const secondY = Number(derivativeAlongScreenY?.y) || 0
	return Math.abs(firstX * secondY - firstY * secondX)
}


export function continuousLodLevel(options) {
	const footprintArea = Number(options?.footprintArea) || 0
	if (footprintArea <= 0) return 0
	const baseCellSize = resolveBaseCellSize(options?.baseCellSize)
	const baseCellArea = baseCellSize * baseCellSize
	return Math.max(0.5 * Math.log2(footprintArea / baseCellArea), 0)
}


export function resolveGlintLod(options) {
	const levelCount = Math.max(Math.trunc(Number(options?.levelCount) || SB_GLINT_LOD_LEVEL_COUNT), 1)
	const coarsestLevel = levelCount - 1
	const baseCellSize = resolveBaseCellSize(options?.baseCellSize)
	const rawLevel = continuousLodLevel({ footprintArea: options?.footprintArea, baseCellSize })
	const clampedLevel = Math.min(rawLevel, coarsestLevel)
	const lowerLevel = Math.min(Math.floor(clampedLevel), coarsestLevel)
	const upperLevel = Math.min(lowerLevel + 1, coarsestLevel)
	return {
		rawLevel,
		continuousLevel: clampedLevel,
		lowerLevel,
		upperLevel,
		blendWeight: clampedLevel - lowerLevel,
		smoothFadeWeight: clampToUnitRange(rawLevel - coarsestLevel),
		lowerCellSize: cellSizeForLevel(lowerLevel, baseCellSize),
		upperCellSize: cellSizeForLevel(upperLevel, baseCellSize),
		levelCount,
		baseCellSize,
	}
}


export function cellCoordinatesForLevel(options) {
	const cellSize = cellSizeForLevel(options?.level, options?.baseCellSize)
	return {
		cellX: Math.floor((Number(options?.surfaceX) || 0) / cellSize),
		cellY: Math.floor((Number(options?.surfaceY) || 0) / cellSize),
		cellSize,
	}
}

function evaluateLevel(options, level, baseCellSize) {
	const cell = cellCoordinatesForLevel({
		surfaceX: options?.surfaceX,
		surfaceY: options?.surfaceY,
		level,
		baseCellSize,
	})
	return evaluateGlintResponse({
		glintDensity: options?.glintDensity,
		glintRoughness: options?.glintRoughness,
		baseRoughness: options?.baseRoughness,
		halfVectorCosine: options?.halfVectorCosine,
		cellArea: cell.cellSize * cell.cellSize,
		cellX: cell.cellX,
		cellY: cell.cellY,
		level,
		seed: options?.seed,
	})
}


export function evaluateGlintWithLod(options) {
	const baseCellSize = resolveBaseCellSize(options?.baseCellSize)
	const lod = resolveGlintLod({
		footprintArea: options?.footprintArea,
		baseCellSize,
		levelCount: options?.levelCount,
	})
	const lowerEvaluation = evaluateLevel(options, lod.lowerLevel, baseCellSize)
	const upperEvaluation =
		lod.upperLevel === lod.lowerLevel ? lowerEvaluation : evaluateLevel(options, lod.upperLevel, baseCellSize)
	const smoothResponse = lowerEvaluation.smoothResponse
	const blendedResponse = mixValues(lowerEvaluation.response, upperEvaluation.response, lod.blendWeight)
	const response = mixValues(blendedResponse, smoothResponse, lod.smoothFadeWeight)
	return {
		response,
		smoothResponse,
		ratio: smoothResponse > 0 ? response / smoothResponse : 1,
		lod,
		lowerEvaluation,
		upperEvaluation,
	}
}
