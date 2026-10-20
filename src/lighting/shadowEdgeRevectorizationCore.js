import { cornerLightFromHalfPlanes } from "./shadowEdgeCornerCore.js";


import {
	TREAD_LENGTH_UNMEASURED_TEXELS,
	shadowEdgeTreadLengthTexels,
} from "./shadowEdgeRunLengthCore.js";


import {
	TREAD_CONTOUR_OVERHANG_TEXELS,
	contourPositionInTread,
	treadPeriodTexels,
} from "./shadowEdgeTreadPeriodCore.js";


import { perpendicularDistanceTexels } from "./shadowEdgePerpendicularDistanceCore.js";


import { AXIS_STEP_LENGTH_TEXELS } from "./shadowEdgeWalkFrameCore.js";


export const SHADOW_EDGE_RUN_SEARCH_TEXELS = 16;


export const REVECTORIZED_RAMP_MIN_TEXELS = 1;


export const REVECTORIZED_FLAT_RAMP_CEILING_TEXELS = 2;


export const REVECTORIZED_MIDPOINT_OFFSET_TEXELS = 0.5;


export const REVECTORIZED_MIN_RUN_TEXELS = 2;


export const REVECTORIZED_CORNER_MIN_RUN_TEXELS = 3;


export const REVECTORIZED_REFUSED = -1;


function toFiniteNumber(value, fallback) {
	if (value === null || value === "" || typeof value === "boolean") return fallback;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function clampToRange(value, minimum, maximum) {
	return Math.min(maximum, Math.max(minimum, value));
}

function readRunPattern(rawInput) {
	const input = rawInput && typeof rawInput === "object" ? rawInput : {};
	return {
		negativeRunTexels: clampToRange(
			toFiniteNumber(input.negativeRunTexels, 0),
			0,
			SHADOW_EDGE_RUN_SEARCH_TEXELS,
		),
		positiveRunTexels: clampToRange(
			toFiniteNumber(input.positiveRunTexels, 0),
			0,
			SHADOW_EDGE_RUN_SEARCH_TEXELS,
		),
		negativeEndBroke: input.negativeEndBroke === true,
		positiveEndBroke: input.positiveEndBroke === true,
		negativeEndBrokeOnPointSide: input.negativeEndBrokeOnPointSide === true,
		positiveEndBrokeOnPointSide: input.positiveEndBrokeOnPointSide === true,


		negativeEndIsSilhouetteEnd: input.negativeEndIsSilhouetteEnd === true,
		positiveEndIsSilhouetteEnd: input.positiveEndIsSilhouetteEnd === true,


		neighbourTreadTexels: Math.max(0, toFiniteNumber(input.neighbourTreadTexels, 0)),
		leadingNeighbourTreadTexels: Math.max(
			0,
			toFiniteNumber(input.leadingNeighbourTreadTexels, 0),
		),
		trailingNeighbourTreadTexels: Math.max(
			0,
			toFiniteNumber(input.trailingNeighbourTreadTexels, 0),
		),


		alongSubTexel: clampToRange(toFiniteNumber(input.alongSubTexel, 0.5), 0, 1),
		acrossSubTexel: clampToRange(toFiniteNumber(input.acrossSubTexel, 0), -0.5, 0.5),
		pointSideIsLit: input.pointSideIsLit !== false,


		atCorner: input.atCorner === true,
		rampTexels: Math.max(
			REVECTORIZED_RAMP_MIN_TEXELS,
			toFiniteNumber(input.rampTexels, REVECTORIZED_RAMP_MIN_TEXELS),
		),


		acrossStepLengthTexels: Math.max(
			AXIS_STEP_LENGTH_TEXELS,
			toFiniteNumber(input.acrossStepLengthTexels, AXIS_STEP_LENGTH_TEXELS),
		),
	};
}


export function revectorizedEdgeAxis(rawInput) {
	const input = rawInput && typeof rawInput === "object" ? rawInput : {};
	const pointSideIsLit = input.pointSideIsLit !== false;
	const nearXDiffers = (input.litNearX !== false) !== pointSideIsLit;
	const farXDiffers = (input.litFarX !== false) !== pointSideIsLit;
	const nearYDiffers = (input.litNearY !== false) !== pointSideIsLit;
	const farYDiffers = (input.litFarY !== false) !== pointSideIsLit;
	const xCarriesEdge = nearXDiffers !== farXDiffers;
	const yCarriesEdge = nearYDiffers !== farYDiffers;
	if (xCarriesEdge && yCarriesEdge) return "both";
	if (xCarriesEdge) return "x";
	if (yCarriesEdge) return "y";
	return "none";
}


export function revectorizedNeighbourhoodIsFlat(rawInput) {
	const input = rawInput && typeof rawInput === "object" ? rawInput : {};
	const pointSideIsLit = input.pointSideIsLit !== false;
	return (
		(input.litNearX !== false) === pointSideIsLit &&
		(input.litFarX !== false) === pointSideIsLit &&
		(input.litNearY !== false) === pointSideIsLit &&
		(input.litFarY !== false) === pointSideIsLit &&
		(input.litNearDiagonal !== false) === pointSideIsLit
	);
}


export function revectorizedRunLengthTexels(rawInput) {
	const pattern = readRunPattern(rawInput);
	return pattern.negativeRunTexels + pattern.positiveRunTexels + 1;
}


export function revectorizedEndIsJog(endBroke, endIsSilhouetteEnd) {
	return endBroke === true && endIsSilhouetteEnd !== true;
}


export function revectorizedPatternIsStraight(rawInput) {
	const pattern = readRunPattern(rawInput);
	const negativeEndIsJog = revectorizedEndIsJog(
		pattern.negativeEndBroke,
		pattern.negativeEndIsSilhouetteEnd,
	);
	const positiveEndIsJog = revectorizedEndIsJog(
		pattern.positiveEndBroke,
		pattern.positiveEndIsSilhouetteEnd,
	);
	if (!negativeEndIsJog || !positiveEndIsJog) return true;
	return pattern.negativeEndBrokeOnPointSide !== pattern.positiveEndBrokeOnPointSide;
}


export function revectorizedEdgeDriftsTowardNeighbour(rawInput) {
	const pattern = readRunPattern(rawInput);
	if (revectorizedEndIsJog(pattern.negativeEndBroke, pattern.negativeEndIsSilhouetteEnd)) {
		return pattern.negativeEndBrokeOnPointSide;
	}
	if (revectorizedEndIsJog(pattern.positiveEndBroke, pattern.positiveEndIsSilhouetteEnd)) {
		return !pattern.positiveEndBrokeOnPointSide;
	}
	return false;
}


function treadUnderPoint(pattern) {
	return shadowEdgeTreadLengthTexels({
		negativeTexels: pattern.negativeRunTexels,
		negativeEndIsJog: revectorizedEndIsJog(
			pattern.negativeEndBroke,
			pattern.negativeEndIsSilhouetteEnd,
		),
		negativeEndIsSilhouetteEnd: pattern.negativeEndIsSilhouetteEnd,
		positiveTexels: pattern.positiveRunTexels,
		positiveEndIsJog: revectorizedEndIsJog(
			pattern.positiveEndBroke,
			pattern.positiveEndIsSilhouetteEnd,
		),
		positiveEndIsSilhouetteEnd: pattern.positiveEndIsSilhouetteEnd,
		neighbourTreadTexels: pattern.neighbourTreadTexels,
		searchBudgetTexels: SHADOW_EDGE_RUN_SEARCH_TEXELS,
	});
}


function treadPeriodsAroundPoint(pattern, tread) {
	return {
		leadingPeriodTexels: treadPeriodTexels({
			treadTexels: tread.treadTexels,
			neighbourTreadTexels: pattern.leadingNeighbourTreadTexels,
		}),
		trailingPeriodTexels: treadPeriodTexels({
			treadTexels: tread.treadTexels,
			neighbourTreadTexels: pattern.trailingNeighbourTreadTexels,
		}),
	};
}


export function revectorizedTreadPeriodTexels(rawInput) {
	const pattern = readRunPattern(rawInput);
	const tread = treadUnderPoint(pattern);
	if (!tread.measured) return TREAD_LENGTH_UNMEASURED_TEXELS;
	const periods = treadPeriodsAroundPoint(pattern, tread);
	return (periods.leadingPeriodTexels + periods.trailingPeriodTexels) / 2;
}

export function revectorizedEdgeOffsetTexels(rawInput) {
	const pattern = readRunPattern(rawInput);
	const tread = treadUnderPoint(pattern);
	if (!tread.measured) return REVECTORIZED_MIDPOINT_OFFSET_TEXELS;


	const periods = treadPeriodsAroundPoint(pattern, tread);
	const positionInRun = contourPositionInTread({
		texelsFromTreadStart: tread.texelsFromTreadStart,
		alongSubTexel: pattern.alongSubTexel,
		treadTexels: tread.treadTexels,
		leadingPeriodTexels: periods.leadingPeriodTexels,
		trailingPeriodTexels: periods.trailingPeriodTexels,
	});


	return clampToRange(
		revectorizedEdgeDriftsTowardNeighbour(rawInput) ? positionInRun : 1 - positionInRun,
		-TREAD_CONTOUR_OVERHANG_TEXELS,
		1 + TREAD_CONTOUR_OVERHANG_TEXELS,
	);
}


export function revectorizedVisibility(rawInput) {
	if (!revectorizedPatternIsStraight(rawInput)) return REVECTORIZED_REFUSED;
	const pattern = readRunPattern(rawInput);


	const minimumRunTexels = pattern.atCorner
		? REVECTORIZED_CORNER_MIN_RUN_TEXELS
		: REVECTORIZED_MIN_RUN_TEXELS;
	if (minimumRunTexels > revectorizedRunLengthTexels(rawInput)) {
		return REVECTORIZED_REFUSED;
	}


	const offsetInAcrossSteps = revectorizedEdgeOffsetTexels(rawInput) - pattern.acrossSubTexel;
	const distanceIntoPointSide = perpendicularDistanceTexels({
		axisDistanceTexels: offsetInAcrossSteps * pattern.acrossStepLengthTexels,
		treadTexels: revectorizedTreadPeriodTexels(rawInput),
	});
	const distanceIntoLight = pattern.pointSideIsLit
		? distanceIntoPointSide
		: -distanceIntoPointSide;
	return clampToRange(0.5 + distanceIntoLight / pattern.rampTexels, 0, 1);
}


export function revectorizedCombinedAxisLight(rawInput) {
	const input = rawInput ?? {};
	const xAxisLight = toFiniteNumber(input.xAxisLight, REVECTORIZED_REFUSED);
	const yAxisLight = toFiniteNumber(input.yAxisLight, REVECTORIZED_REFUSED);
	const xCarriesEdge = input.axis === "x" || input.axis === "both";
	const yCarriesEdge = input.axis === "y" || input.axis === "both";
	const xIsReadable = xCarriesEdge && xAxisLight >= 0;
	const yIsReadable = yCarriesEdge && yAxisLight >= 0;
	if (xIsReadable && yIsReadable) {
		return cornerLightFromHalfPlanes({
			firstEdgeLight: xAxisLight,
			secondEdgeLight: yAxisLight,
			pointSideIsLit: Boolean(input.pointSideIsLit),
		});
	}


	if (xIsReadable) return xAxisLight;
	if (yIsReadable) return yAxisLight;
	return REVECTORIZED_REFUSED;
}


export function buildShadowEdgeRevectorizationGlsl() {
	const searchTexels = String(SHADOW_EDGE_RUN_SEARCH_TEXELS);
	const rampMin = REVECTORIZED_RAMP_MIN_TEXELS.toFixed(2);
	const flatRampCeiling = REVECTORIZED_FLAT_RAMP_CEILING_TEXELS.toFixed(2);
	const midpointOffset = REVECTORIZED_MIDPOINT_OFFSET_TEXELS.toFixed(2);
	const minRun = REVECTORIZED_MIN_RUN_TEXELS.toFixed(2);
	const cornerMinRun = REVECTORIZED_CORNER_MIN_RUN_TEXELS.toFixed(2);
	const refused = REVECTORIZED_REFUSED.toFixed(1);
	const unmeasuredTread = TREAD_LENGTH_UNMEASURED_TEXELS.toFixed(2);
	const axisStepLength = AXIS_STEP_LENGTH_TEXELS.toFixed(1);
	return `
                                                                              
                                                                              
                                                                        
bool rswShadowEdgeIsLit(sampler2D shadowMap, vec2 texelCenterUv, float receiverDepth) {
  return rswUnpackDepth(texture2D(shadowMap, texelCenterUv)) >= receiverDepth;
}
                                                                              
                                                                              
                                                                                
                                                                              
                                          
  
                                                                              
                                                                               
                                                                             
void rswShadowEdgeWalkRun(sampler2D shadowMap, vec2 texelCenterUv, vec2 acrossStep, vec2 alongStep, float receiverDepth, bool pointSideIsLit, out float runTexels, out bool endBroke, out bool endBrokeOnPointSide, out bool endIsSilhouetteEnd) {
  runTexels = float(${searchTexels});
  endBroke = false;
  endBrokeOnPointSide = false;
  endIsSilhouetteEnd = false;
  for (int step = 1; ${searchTexels} >= step; step++) {
    vec2 walkUv = texelCenterUv + alongStep * float(step);
                                                                              
                                                                               
                                                                                
                                                                                 
                                                                                 
                                                                    
      
                                                                               
                                                                                
                                                                                
      
                                                                              
                                                                              
                                                                             
                                        
    if (!rswShadowEdgeTapIsInsideMap(walkUv) || !rswShadowEdgeTapIsInsideMap(walkUv + acrossStep) || !rswShadowEdgeTapIsInsideMap(walkUv - acrossStep) || !rswShadowEdgeTapIsInsideMap(walkUv + 2.0 * acrossStep)) {
      runTexels = float(step - 1);
      break;
    }
    bool litOnPointSide = rswShadowEdgeIsLit(shadowMap, walkUv, receiverDepth);
    bool litOnNeighbourSide = rswShadowEdgeIsLit(shadowMap, walkUv + acrossStep, receiverDepth);
    if (litOnPointSide != pointSideIsLit) {
      runTexels = float(step - 1);
      endBroke = true;
      endBrokeOnPointSide = true;
                                                                            
                                                                             
                                                                                
                                                                   
      endIsSilhouetteEnd = rswShadowEdgeIsLit(shadowMap, walkUv - acrossStep, receiverDepth) != pointSideIsLit;
      break;
    }
    if (litOnNeighbourSide == pointSideIsLit) {
      runTexels = float(step - 1);
      endBroke = true;
      endBrokeOnPointSide = false;
                                                                           
                                                                       
                                                                               
      endIsSilhouetteEnd = rswShadowEdgeIsLit(shadowMap, walkUv + 2.0 * acrossStep, receiverDepth) == pointSideIsLit;
      break;
    }
  }
}
                                                                                 
                                                                                 
                                                                                 
                                                                          
                                                                          
float rswShadowEdgeNeighbourTreadTexels(sampler2D shadowMap, vec2 texelCenterUv, vec2 acrossStep, vec2 alongStep, float receiverDepth, bool pointSideIsLit, float jogTexels, bool jogWasOnPointSide) {
                                                                               
                                                                               
                                                                       
  vec2 jogCenterUv = texelCenterUv + alongStep * (jogTexels + 1.0) + acrossStep * (jogWasOnPointSide ? -1.0 : 1.0);
  float runTexels;
  bool endBroke;
  bool endBrokeOnPointSide;
  bool endIsSilhouetteEnd;
  rswShadowEdgeWalkRun(shadowMap, jogCenterUv, acrossStep, alongStep, receiverDepth, pointSideIsLit, runTexels, endBroke, endBrokeOnPointSide, endIsSilhouetteEnd);
                                                                            
                                                                         
                                                                               
                                                                          
                                                             
  return (endBroke && !endIsSilhouetteEnd) ? runTexels + 1.0 : 0.0;
}
                                                                                
                                                                ${(refused, "")}     
                                                                               
                                                                              
                                                                             
              
float rswShadowEdgeRevectorizedOnAxis(sampler2D shadowMap, vec2 texelCenterUv, vec2 acrossStep, vec2 alongStep, float receiverDepth, bool pointSideIsLit, bool atCorner, float acrossSubTexel, float alongSubTexel, float rampTexels, float acrossStepLengthTexels) {
  float positiveRunTexels;
  bool positiveEndBroke;
  bool positiveEndBrokeOnPointSide;
  bool positiveEndIsSilhouetteEnd;
  rswShadowEdgeWalkRun(shadowMap, texelCenterUv, acrossStep, alongStep, receiverDepth, pointSideIsLit, positiveRunTexels, positiveEndBroke, positiveEndBrokeOnPointSide, positiveEndIsSilhouetteEnd);
  float negativeRunTexels;
  bool negativeEndBroke;
  bool negativeEndBrokeOnPointSide;
  bool negativeEndIsSilhouetteEnd;
  rswShadowEdgeWalkRun(shadowMap, texelCenterUv, acrossStep, -alongStep, receiverDepth, pointSideIsLit, negativeRunTexels, negativeEndBroke, negativeEndBrokeOnPointSide, negativeEndIsSilhouetteEnd);
  float runLengthTexels = negativeRunTexels + positiveRunTexels + 1.0;
                                                                              
                                                                         
                                                                           
  bool negativeEndIsJog = negativeEndBroke && !negativeEndIsSilhouetteEnd;
  bool positiveEndIsJog = positiveEndBroke && !positiveEndIsSilhouetteEnd;
                                                                              
                                                                            
  if (negativeEndIsJog && positiveEndIsJog && negativeEndBrokeOnPointSide == positiveEndBrokeOnPointSide) return ${refused};
                                                                          
                                                                             
                                                                            
                                                                       
                                                                               
                                                                             
                                                                                
                                                                             
                              
  float minimumRunTexels = atCorner ? ${cornerMinRun} : ${minRun};
  if (minimumRunTexels > runLengthTexels) return ${refused};
                                                                                 
                                                                                 
                                                                            
                                                                                 
                                                                                 
                                                       
    
                                                                                  
                                                                                
                                                                                  
                                                                                 
                                                                             
                                                                             
                                                                                 
                                                              
  float neighbourTreadTexels = 0.0;
  bool openSideIsSilhouetteEnd = negativeEndIsJog ? positiveEndIsSilhouetteEnd : negativeEndIsSilhouetteEnd;
  bool oneSideStoppedAtSilhouetteEnd = negativeEndIsJog != positiveEndIsJog && openSideIsSilhouetteEnd;
  bool bothSidesClosedOnAJog = negativeEndIsJog && positiveEndIsJog;
                                                                                 
                                                                      
  if (oneSideStoppedAtSilhouetteEnd) {
    neighbourTreadTexels = rswShadowEdgeNeighbourTreadTexels(shadowMap, texelCenterUv, acrossStep, negativeEndIsJog ? -alongStep : alongStep, receiverDepth, pointSideIsLit, negativeEndIsJog ? negativeRunTexels : positiveRunTexels, negativeEndIsJog ? negativeEndBrokeOnPointSide : positiveEndBrokeOnPointSide);
  }
                                                                               
                                                                                
                                                             
  float leadingNeighbourTreadTexels = 0.0;
  float trailingNeighbourTreadTexels = 0.0;
  if (bothSidesClosedOnAJog && rswShadowEdgeShouldMeasureTreadPeriod(runLengthTexels)) {
    leadingNeighbourTreadTexels = rswShadowEdgeNeighbourTreadTexels(shadowMap, texelCenterUv, acrossStep, -alongStep, receiverDepth, pointSideIsLit, negativeRunTexels, negativeEndBrokeOnPointSide);
    trailingNeighbourTreadTexels = rswShadowEdgeNeighbourTreadTexels(shadowMap, texelCenterUv, acrossStep, alongStep, receiverDepth, pointSideIsLit, positiveRunTexels, positiveEndBrokeOnPointSide);
  }
                                                                               
  vec3 tread = rswShadowEdgeTread(negativeRunTexels, negativeEndIsJog, negativeEndIsSilhouetteEnd, positiveRunTexels, positiveEndIsJog, positiveEndIsSilhouetteEnd, neighbourTreadTexels, float(${searchTexels}));
  float offsetTexels = ${midpointOffset};
  float measuredTreadTexels = ${unmeasuredTread};
  if (tread.z > 0.5) {
    bool driftsTowardNeighbour = negativeEndIsJog ? negativeEndBrokeOnPointSide : !positiveEndBrokeOnPointSide;
    float leadingPeriodTexels = rswShadowEdgeTreadPeriod(tread.x, leadingNeighbourTreadTexels);
    float trailingPeriodTexels = rswShadowEdgeTreadPeriod(tread.x, trailingNeighbourTreadTexels);
    float positionInRun = rswShadowEdgeContourPositionInTread(tread.y, alongSubTexel, tread.x, leadingPeriodTexels, trailingPeriodTexels);
    offsetTexels = clamp(driftsTowardNeighbour ? positionInRun : 1.0 - positionInRun, -${TREAD_CONTOUR_OVERHANG_TEXELS.toFixed(2)}, 1.0 + ${TREAD_CONTOUR_OVERHANG_TEXELS.toFixed(2)});
    measuredTreadTexels = (leadingPeriodTexels + trailingPeriodTexels) * 0.5;
  }
                                                                            
                                                                          
    
                                                                                
                                                                         
                                                                                 
                                                                                
                                                                                
                                                                         
                                                                             
                                                                               
                                                               
  float distanceIntoPointSide = rswShadowEdgePerpendicularDistance((offsetTexels - acrossSubTexel) * acrossStepLengthTexels, measuredTreadTexels);
  float distanceIntoLight = pointSideIsLit ? distanceIntoPointSide : -distanceIntoPointSide;
  return clamp(0.5 + distanceIntoLight / max(rampTexels, ${rampMin}), 0.0, 1.0);
}
                                                             
                                 
  
                                                                                
                                                                                 
                                                                               
                                                                                 
                                                                                  
                                                  
float rswShadowEdgeCombinedAxisLight(bool pointSideIsLit, bool xCarriesEdge, bool yCarriesEdge, float xEdgeLight, float yEdgeLight) {
  bool xIsReadable = xCarriesEdge && xEdgeLight >= 0.0;
  bool yIsReadable = yCarriesEdge && yEdgeLight >= 0.0;
  if (xIsReadable && yIsReadable) return rswShadowEdgeCornerLight(pointSideIsLit, xEdgeLight, yEdgeLight);
                                                                               
                                                     
                                   
  if (xIsReadable) return xEdgeLight;
  if (yIsReadable) return yEdgeLight;
  return ${refused};
}
                                                                           
           ${(refused, "")}                                                            
                         
  
                                                                               
                                                                               
                                                                                 
                                                                                
                                                                                
                                                             
                                                                           
float rswShadowEdgeRevectorizedInDiagonalFrame(sampler2D shadowMap, vec2 texelCenterUv, vec2 texelSize, float receiverDepth, bool pointSideIsLit, vec2 offsetFromTexelCentre, float rampTexels, vec2 alongStepTexels, vec2 acrossStepTexels) {
  bool nearDiffers = rswShadowEdgeIsLit(shadowMap, texelCenterUv + acrossStepTexels * texelSize, receiverDepth) != pointSideIsLit;
  bool farDiffers = rswShadowEdgeIsLit(shadowMap, texelCenterUv - acrossStepTexels * texelSize, receiverDepth) != pointSideIsLit;
                                                                            
  if (nearDiffers == farDiffers) return ${refused};
  vec2 signedAcrossTexels = acrossStepTexels * (nearDiffers ? 1.0 : -1.0);
  vec2 subTexel = rswShadowEdgeWalkFrameSubTexel(offsetFromTexelCentre, alongStepTexels, signedAcrossTexels);
                                                                                 
                                                                              
                                                 
  return rswShadowEdgeRevectorizedOnAxis(shadowMap, texelCenterUv, signedAcrossTexels * texelSize, alongStepTexels * texelSize, receiverDepth, pointSideIsLit, false, subTexel.y, subTexel.x, rampTexels, rswShadowEdgeWalkFrameStepLength(signedAcrossTexels));
}
                                                   ${(refused, "")}                 
                                                                                
                                                                          
                                              
float rswShadowEdgeRevectorized(sampler2D shadowMap, vec2 shadowMapSize, vec2 shadowCoordXy, float receiverDepth, float rampTexels) {
  vec2 texelSize = 1.0 / max(shadowMapSize, vec2(1.0));
  vec2 gridPosition = shadowCoordXy * shadowMapSize;
  vec2 texelIndex = floor(gridPosition);
  vec2 inTexel = gridPosition - texelIndex;
  vec2 texelCenterUv = (texelIndex + 0.5) * texelSize;
                                                                                
                                                                                 
                                                                                
                                                                                  
                                                                                 
                                                                             
  if (!rswShadowEdgeTapIsInsideMap(texelCenterUv - texelSize) || !rswShadowEdgeTapIsInsideMap(texelCenterUv + texelSize)) return ${refused};
  bool pointSideIsLit = rswShadowEdgeIsLit(shadowMap, texelCenterUv, receiverDepth);
                                                                         
                                                                               
                       
  float leanX = inTexel.x >= 0.5 ? 1.0 : -1.0;
  float leanY = inTexel.y >= 0.5 ? 1.0 : -1.0;
  bool nearXDiffers = rswShadowEdgeIsLit(shadowMap, texelCenterUv + vec2(leanX * texelSize.x, 0.0), receiverDepth) != pointSideIsLit;
  bool farXDiffers = rswShadowEdgeIsLit(shadowMap, texelCenterUv - vec2(leanX * texelSize.x, 0.0), receiverDepth) != pointSideIsLit;
  bool nearYDiffers = rswShadowEdgeIsLit(shadowMap, texelCenterUv + vec2(0.0, leanY * texelSize.y), receiverDepth) != pointSideIsLit;
  bool farYDiffers = rswShadowEdgeIsLit(shadowMap, texelCenterUv - vec2(0.0, leanY * texelSize.y), receiverDepth) != pointSideIsLit;
                                                                             
                                                                                 
                                                                            
    
                                                                                
                                                                               
                                                                               
                                                                                 
                                                                              
                                                                                
  if (!nearXDiffers && !farXDiffers && !nearYDiffers && !farYDiffers) {
    bool nearDiagonalDiffers = rswShadowEdgeIsLit(shadowMap, texelCenterUv + vec2(leanX * texelSize.x, leanY * texelSize.y), receiverDepth) != pointSideIsLit;
    if (!nearDiagonalDiffers && ${flatRampCeiling} >= rampTexels) return pointSideIsLit ? 1.0 : 0.0;
    return ${refused};
  }
                                                                               
                                                                              
                                                                
    
                                                                              
                                                                          
                                                                                 
                                                                                
                                                                                
                                                                               
                                                                               
                                                                             
  bool xCarriesEdge = nearXDiffers != farXDiffers;
  bool yCarriesEdge = nearYDiffers != farYDiffers;
                                                                                
                                
  bool atCorner = xCarriesEdge && yCarriesEdge;
  float xEdgeLight = ${refused};
  if (xCarriesEdge) {
    float acrossSign = nearXDiffers ? leanX : -leanX;
    xEdgeLight = rswShadowEdgeRevectorizedOnAxis(shadowMap, texelCenterUv, vec2(acrossSign * texelSize.x, 0.0), vec2(0.0, texelSize.y), receiverDepth, pointSideIsLit, atCorner, acrossSign * (inTexel.x - 0.5), inTexel.y, rampTexels, ${axisStepLength});
  }
  float yEdgeLight = ${refused};
  if (yCarriesEdge) {
    float acrossSign = nearYDiffers ? leanY : -leanY;
    yEdgeLight = rswShadowEdgeRevectorizedOnAxis(shadowMap, texelCenterUv, vec2(0.0, acrossSign * texelSize.y), vec2(texelSize.x, 0.0), receiverDepth, pointSideIsLit, atCorner, acrossSign * (inTexel.y - 0.5), inTexel.x, rampTexels, ${axisStepLength});
  }
  float axisLight = rswShadowEdgeCombinedAxisLight(pointSideIsLit, xCarriesEdge, yCarriesEdge, xEdgeLight, yEdgeLight);
  if (axisLight >= 0.0) return axisLight;
                                                                              
                                                                              
                                                           ${(cornerMinRun, "")}    
                                                                             
                                                                           
                                                                              
                                                                                 
                                                                 
    
                                                                              
                                                                                 
                                                                           
  vec2 offsetFromTexelCentre = inTexel - 0.5;
  float risingDiagonalLight = rswShadowEdgeRevectorizedInDiagonalFrame(shadowMap, texelCenterUv, texelSize, receiverDepth, pointSideIsLit, offsetFromTexelCentre, rampTexels, vec2(1.0, 1.0), vec2(1.0, -1.0));
  float fallingDiagonalLight = rswShadowEdgeRevectorizedInDiagonalFrame(shadowMap, texelCenterUv, texelSize, receiverDepth, pointSideIsLit, offsetFromTexelCentre, rampTexels, vec2(1.0, -1.0), vec2(1.0, 1.0));
                                                                           
                                                                               
                                                                          
                                                                              
                                        
  if (risingDiagonalLight >= 0.0 && fallingDiagonalLight >= 0.0) return ${refused};
  if (risingDiagonalLight >= 0.0) return risingDiagonalLight;
  return fallingDiagonalLight;
}
`;
}
