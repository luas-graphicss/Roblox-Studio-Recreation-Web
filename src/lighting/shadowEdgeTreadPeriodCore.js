import { TREAD_LENGTH_UNMEASURED_TEXELS } from "./shadowEdgeRunLengthCore.js";


const TREAD_MIDPOINT_POSITION = 0.5;


const TEXEL_CENTRE_ALONG_TEXELS = 0.5;


export const TREAD_PERIOD_MAX_DEVIATION_TEXELS = 0.5;


export const TREAD_PERIOD_WALK_MAX_TREAD_TEXELS = 8;


export const TREAD_CONTOUR_OVERHANG_TEXELS = 0.5;


function toFiniteNumber(value, fallback) {
	const parsed = typeof value === "number" ? value : Number.NaN;
	return Number.isFinite(parsed) ? parsed : fallback;
}

function texelsFrom(value, fallback) {
	return Math.max(0, toFiniteNumber(value, fallback));
}

function clampToRange(value, minimum, maximum) {
	return Math.min(Math.max(value, minimum), maximum);
}


export function shouldMeasureTreadPeriod(countedTexels) {
	const treadTexels = texelsFrom(countedTexels, TREAD_LENGTH_UNMEASURED_TEXELS);
	return (
		treadTexels > TREAD_LENGTH_UNMEASURED_TEXELS &&
		TREAD_PERIOD_WALK_MAX_TREAD_TEXELS >= treadTexels
	);
}


export function treadPeriodTexels(rawInput) {
	const input = rawInput ?? {};
	const treadTexels = texelsFrom(input.treadTexels, TREAD_LENGTH_UNMEASURED_TEXELS);
	const neighbourTreadTexels = texelsFrom(
		input.neighbourTreadTexels,
		TREAD_LENGTH_UNMEASURED_TEXELS,
	);
	if (TREAD_LENGTH_UNMEASURED_TEXELS >= neighbourTreadTexels) return treadTexels;
	const averagedTexels = (treadTexels + neighbourTreadTexels) / 2;
	return clampToRange(
		averagedTexels,
		treadTexels - TREAD_PERIOD_MAX_DEVIATION_TEXELS,
		treadTexels + TREAD_PERIOD_MAX_DEVIATION_TEXELS,
	);
}


export function contourPositionInTread(rawInput) {
	const input = rawInput ?? {};
	const treadTexels = Math.max(texelsFrom(input.treadTexels, 1), 1);
	const texelsFromTreadStart = texelsFrom(input.texelsFromTreadStart, 0);
	const alongSubTexel = toFiniteNumber(input.alongSubTexel, TEXEL_CENTRE_ALONG_TEXELS);


	const positionInTread = (texelsFromTreadStart + alongSubTexel) / treadTexels;
	const runsIntoLeadingJog = TREAD_MIDPOINT_POSITION >= positionInTread;
	const measuredPeriodTexels = texelsFrom(
		runsIntoLeadingJog ? input.leadingPeriodTexels : input.trailingPeriodTexels,
		TREAD_LENGTH_UNMEASURED_TEXELS,
	);
	const periodTexels =
		measuredPeriodTexels > TREAD_LENGTH_UNMEASURED_TEXELS ? measuredPeriodTexels : treadTexels;
	const texelsFromMidpoint = (positionInTread - TREAD_MIDPOINT_POSITION) * treadTexels;
	return clampToRange(
		TREAD_MIDPOINT_POSITION + texelsFromMidpoint / Math.max(periodTexels, 1),
		-TREAD_CONTOUR_OVERHANG_TEXELS,
		1 + TREAD_CONTOUR_OVERHANG_TEXELS,
	);
}


export function buildShadowEdgeTreadPeriodGlsl() {
	const unmeasuredTexels = TREAD_LENGTH_UNMEASURED_TEXELS.toFixed(1);
	const maxTreadTexels = TREAD_PERIOD_WALK_MAX_TREAD_TEXELS.toFixed(1);
	const maxDeviationTexels = TREAD_PERIOD_MAX_DEVIATION_TEXELS.toFixed(2);
	const midpoint = TREAD_MIDPOINT_POSITION.toFixed(2);
	const overhangTexels = TREAD_CONTOUR_OVERHANG_TEXELS.toFixed(2);
	return `
                                                                              
                                                                              
                                                                         
                                    
bool rswShadowEdgeShouldMeasureTreadPeriod(float countedTexels) {
  return countedTexels > ${unmeasuredTexels} && ${maxTreadTexels} >= countedTexels;
}

float rswShadowEdgeTreadPeriod(float treadTexels, float neighbourTreadTexels) {
  if (${unmeasuredTexels} >= neighbourTreadTexels) return treadTexels;
  float averagedTexels = (treadTexels + neighbourTreadTexels) * 0.5;
  return clamp(averagedTexels, treadTexels - ${maxDeviationTexels}, treadTexels + ${maxDeviationTexels});
}

float rswShadowEdgeContourPositionInTread(float texelsFromTreadStart, float alongSubTexel, float countedTreadTexels, float leadingPeriodTexels, float trailingPeriodTexels) {
  float treadTexels = max(countedTreadTexels, 1.0);
  float positionInTread = (texelsFromTreadStart + alongSubTexel) / treadTexels;
  float measuredPeriodTexels = ${midpoint} >= positionInTread ? leadingPeriodTexels : trailingPeriodTexels;
  float periodTexels = measuredPeriodTexels > ${unmeasuredTexels} ? measuredPeriodTexels : treadTexels;
  float texelsFromMidpoint = (positionInTread - ${midpoint}) * treadTexels;
  return clamp(${midpoint} + texelsFromMidpoint / max(periodTexels, 1.0), -${overhangTexels}, 1.0 + ${overhangTexels});
}
`;
}
