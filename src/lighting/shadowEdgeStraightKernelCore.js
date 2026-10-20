import {
	SHADOW_EDGE_AXIS_TAP_OFFSETS,
	cubicBSplineValue,
	shadowEdgeGradientWeights,
	shadowEdgeValueWeights,
} from "./shadowEdgeBasisCore.js";
import {
	SILHOUETTE_MID_COVERAGE,
	SILHOUETTE_MIN_GRADIENT,
	SILHOUETTE_MIN_WIDTH_TEXELS,
	silhouetteEdgeConfidence,
	silhouetteLightFromDistance,
} from "./shadowEdgeSilhouetteCore.js";
import {
	LINE_FIT_UNUSABLE_RESIDUAL_TEXELS,
	accumulateLineFitColumn,
	emptyLineFitSums,
	lineFitTrust,
	moveContourOntoLine,
	solveLineFit,
} from "./shadowEdgeLineFitCore.js";


import { blendedContourDistanceTexels } from "./shadowEdgeContourBlendCore.js";
import {
	alongAxisXShareFromClimbs,
	blendFrameDistanceTexels,
	frameSecondLookIsWorthTaking,
	frameShareIsWorthMeasuring,
} from "./shadowEdgeFrameBlendCore.js";


import { perpendicularScaleFromClimb } from "./shadowEdgePerpendicularDistanceCore.js";


import {
	buildShadowEdgeClimbRangeGlsl,
	clampClimbToPossibleRange,
} from "./shadowEdgeClimbReach.js";


export const STRAIGHT_KERNEL_ACROSS_TAP_OFFSETS = SHADOW_EDGE_AXIS_TAP_OFFSETS;


export const STRAIGHT_KERNEL_LAST_TAP_EDGE_TEXELS =
	STRAIGHT_KERNEL_ACROSS_TAP_OFFSETS[STRAIGHT_KERNEL_ACROSS_TAP_OFFSETS.length - 1] + 0.5;
export const STRAIGHT_KERNEL_FIRST_TAP_EDGE_TEXELS = STRAIGHT_KERNEL_ACROSS_TAP_OFFSETS[0] - 0.5;


export const STRAIGHT_KERNEL_NEAR_COLUMNS = Object.freeze({
	alongTexels: Object.freeze([-3, -2, -1, 0, 1, 2, 3, 4]),
	windowTexels: 4,
});


export const STRAIGHT_KERNEL_NEAR_COLUMN_SPAN_TEXELS =
	STRAIGHT_KERNEL_NEAR_COLUMNS.alongTexels.length - 1;


export const STRAIGHT_KERNEL_WIDE_COLUMNS = Object.freeze({
	alongTexels: Object.freeze([-12, -9, -6, -4, 0, 3, 7, 12]),
	windowTexels: 16,
});


export const STRAIGHT_KERNEL_CLIMB_DISAGREEMENT = 0.1;


export const STRAIGHT_KERNEL_MIN_RESOLVED_STEPS = 2.5;
export const STRAIGHT_KERNEL_RESOLVED_CLIMB =
	STRAIGHT_KERNEL_MIN_RESOLVED_STEPS / STRAIGHT_KERNEL_NEAR_COLUMN_SPAN_TEXELS;


export const STRAIGHT_KERNEL_MIN_PHASE_TURNS = 1.5;
export const STRAIGHT_KERNEL_RESOLVED_PHASE_DISTANCE =
	STRAIGHT_KERNEL_MIN_PHASE_TURNS / STRAIGHT_KERNEL_NEAR_COLUMN_SPAN_TEXELS;


export const STRAIGHT_KERNEL_UNRESOLVED_CLIMB = 0;

export const STRAIGHT_KERNEL_GRID_TAP_COUNT =
	SHADOW_EDGE_AXIS_TAP_OFFSETS.length * SHADOW_EDGE_AXIS_TAP_OFFSETS.length;
export const STRAIGHT_KERNEL_ORIENTED_TAP_COUNT =
	STRAIGHT_KERNEL_NEAR_COLUMNS.alongTexels.length * STRAIGHT_KERNEL_ACROSS_TAP_OFFSETS.length;


export const STRAIGHT_KERNEL_MAX_PASS_COUNT = 2;
export const STRAIGHT_KERNEL_MAX_TAP_COUNT =
	STRAIGHT_KERNEL_GRID_TAP_COUNT +
	STRAIGHT_KERNEL_MAX_PASS_COUNT * STRAIGHT_KERNEL_ORIENTED_TAP_COUNT;

function toFiniteNumber(value, fallback) {
	if (value === null || value === "" || typeof value === "boolean") return fallback;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function alwaysLit() {
	return 1;
}

function dotWeights(weights, taps) {
	let total = 0;
	for (let index = 0; index !== weights.length; index += 1) total += weights[index] * taps[index];
	return total;
}


export function blockFrameFromGradient(gradientX, gradientY) {
	const x = toFiniteNumber(gradientX, 0);
	const y = toFiniteNumber(gradientY, 0);
	const gradientLength = Math.hypot(x, y);
	const inverseGradient = 1 / Math.max(gradientLength, SILHOUETTE_MIN_GRADIENT);
	const normalX = x * inverseGradient;
	const normalY = y * inverseGradient;
	return Object.freeze({
		gradientLength,
		inverseGradient,
		normalX,
		normalY,
		edgeRunsAlongX: Math.abs(normalY) >= Math.abs(normalX),
		edgeConfidence: silhouetteEdgeConfidence(gradientLength),
	});
}


export function columnShearTexels(alongFromSampleTexels, acrossPerAlong, subAcrossTexels) {
	const centredAcrossTexels =
		toFiniteNumber(subAcrossTexels, 0) +
		toFiniteNumber(alongFromSampleTexels, 0) * toFiniteNumber(acrossPerAlong, 0);
	return Math.floor(centredAcrossTexels);
}


export function columnAlongWindow(alongTexels, windowTexels) {
	const halfSpanTexels = Math.max(
		1,
		toFiniteNumber(windowTexels, STRAIGHT_KERNEL_NEAR_COLUMNS.windowTexels),
	);
	return cubicBSplineValue((2 * toFiniteNumber(alongTexels, 0)) / halfSpanTexels);
}


export function climbDistanceFromWholeTexels(climb) {
	const magnitude = Math.abs(toFiniteNumber(climb, 0));
	return Math.abs(magnitude - Math.round(magnitude));
}


export function nearLookClimbIsUnresolved(measuredClimb) {
	const climb = toFiniteNumber(measuredClimb, 0);
	if (STRAIGHT_KERNEL_RESOLVED_CLIMB >= Math.abs(climb)) return true;
	return STRAIGHT_KERNEL_RESOLVED_PHASE_DISTANCE >= climbDistanceFromWholeTexels(climb);
}

export function columnsForSecondLook(measuredClimb, blockClimb) {
	const climb = toFiniteNumber(measuredClimb, 0);
	if (nearLookClimbIsUnresolved(climb)) return STRAIGHT_KERNEL_WIDE_COLUMNS;
	const disagreement = Math.abs(climb - toFiniteNumber(blockClimb, 0));
	return disagreement > STRAIGHT_KERNEL_CLIMB_DISAGREEMENT ? STRAIGHT_KERNEL_NEAR_COLUMNS : null;
}


export function climbToShearSecondLookBy(secondColumns, measuredClimb) {
	const climb = toFiniteNumber(measuredClimb, 0);
	if (secondColumns !== STRAIGHT_KERNEL_WIDE_COLUMNS) return climb;
	return STRAIGHT_KERNEL_RESOLVED_CLIMB >= Math.abs(climb)
		? STRAIGHT_KERNEL_UNRESOLVED_CLIMB
		: climb;
}


export function columnCrossingTexels(litTapCount, subAcrossTexels, litSideIsUp) {
	const litTaps = toFiniteNumber(litTapCount, 0);
	const boundaryTexels = litSideIsUp
		? STRAIGHT_KERNEL_LAST_TAP_EDGE_TEXELS - litTaps
		: STRAIGHT_KERNEL_FIRST_TAP_EDGE_TEXELS + litTaps;
	return boundaryTexels - toFiniteNumber(subAcrossTexels, 0);
}


export function columnCrossingWeight(litTapCount) {
	const count = toFiniteNumber(litTapCount, 0);
	const highestCrossingCount = STRAIGHT_KERNEL_ACROSS_TAP_OFFSETS.length - 1;
	return count >= 1 && highestCrossingCount >= count ? 1 : 0;
}


export function readShadowEdgeGridBlock(rawInput) {
	const input = rawInput && typeof rawInput === "object" ? rawInput : {};
	const readOcclusionTap =
		typeof input.readOcclusionTap === "function" ? input.readOcclusionTap : alwaysLit;
	const sampleX = toFiniteNumber(input.sampleX, 0);
	const sampleY = toFiniteNumber(input.sampleY, 0);
	const baseX = Math.floor(sampleX);
	const baseY = Math.floor(sampleY);
	const valueWeightX = shadowEdgeValueWeights(sampleX - baseX);
	const gradientWeightX = shadowEdgeGradientWeights(sampleX - baseX);
	const valueWeightY = shadowEdgeValueWeights(sampleY - baseY);
	const gradientWeightY = shadowEdgeGradientWeights(sampleY - baseY);
	const rowValue = [];
	const rowGradient = [];
	for (const rowOffset of SHADOW_EDGE_AXIS_TAP_OFFSETS) {
		const row = SHADOW_EDGE_AXIS_TAP_OFFSETS.map((columnOffset) =>
			readOcclusionTap(baseX + columnOffset, baseY + rowOffset),
		);
		rowValue.push(dotWeights(valueWeightX, row));
		rowGradient.push(dotWeights(gradientWeightX, row));
	}
	return Object.freeze({
		value: dotWeights(valueWeightY, rowValue),
		gradientX: dotWeights(valueWeightY, rowGradient),
		gradientY: dotWeights(gradientWeightY, rowValue),
	});
}


function readColumnLitTapCount(readOcclusionTap, edgeRunsAlongX, alongTexel, acrossTexel) {
	let litTapCount = 0;
	for (const acrossOffset of STRAIGHT_KERNEL_ACROSS_TAP_OFFSETS) {
		const tapAcross = acrossTexel + acrossOffset;
		litTapCount += edgeRunsAlongX
			? readOcclusionTap(alongTexel, tapAcross)
			: readOcclusionTap(tapAcross, alongTexel);
	}
	return litTapCount;
}


function fitEdgeLineFromColumns(placement, acrossPerAlong, columns) {
	const sums = emptyLineFitSums();
	let usableColumnCount = 0;
	for (const alongTexels of columns.alongTexels) {


		const alongFromSample = alongTexels - placement.subAlong;
		const shearTexels = columnShearTexels(alongFromSample, acrossPerAlong, placement.subAcross);
		const litTapCount = readColumnLitTapCount(
			placement.readOcclusionTap,
			placement.edgeRunsAlongX,
			placement.baseAlong + alongTexels,
			placement.baseAcross + shearTexels,
		);
		const crossingWeight = columnCrossingWeight(litTapCount);
		usableColumnCount += crossingWeight > 0 ? 1 : 0;
		accumulateLineFitColumn(sums, {
			alongTexels: alongFromSample,


			acrossTexels:
				shearTexels +
				columnCrossingTexels(litTapCount, placement.subAcross, placement.litSideIsUp),
			weight: crossingWeight * columnAlongWindow(alongFromSample, columns.windowTexels),
		});
	}
	return {
		line: solveLineFit(sums),
		usableColumnCount,
		offeredColumnCount: columns.alongTexels.length,
		reachTexels: columns.windowTexels,
	};
}


const STRAIGHT_KERNEL_GLIMPSED_COLUMN_SHARE = 0.5;
const STRAIGHT_KERNEL_MEASURED_COLUMN_SHARE = 0.8;


function columnShareConfidence(share) {
	const span = STRAIGHT_KERNEL_MEASURED_COLUMN_SHARE - STRAIGHT_KERNEL_GLIMPSED_COLUMN_SHARE;
	const normalized = Math.max(
		0,
		Math.min(1, (share - STRAIGHT_KERNEL_GLIMPSED_COLUMN_SHARE) / span),
	);
	return normalized * normalized * (3 - 2 * normalized);
}


export function lookColumnShare(look) {
	const offeredColumnCount = toFiniteNumber(look.offeredColumnCount, 0);
	if (offeredColumnCount <= 0) return 0;
	const share = toFiniteNumber(look.usableColumnCount, 0) / offeredColumnCount;
	return Math.max(0, Math.min(1, share));
}


export function lookBelievability(look) {
	return lineFitTrust(look.line) * columnShareConfidence(lookColumnShare(look));
}


function explainStraighteningInFrame(rawInput) {
	const input = rawInput && typeof rawInput === "object" ? rawInput : {};
	const readOcclusionTap =
		typeof input.readOcclusionTap === "function" ? input.readOcclusionTap : alwaysLit;
	const sampleX = toFiniteNumber(input.sampleX, 0);
	const sampleY = toFiniteNumber(input.sampleY, 0);
	const widthTexels = toFiniteNumber(input.widthTexels, SILHOUETTE_MIN_WIDTH_TEXELS);
	const block = readShadowEdgeGridBlock({ readOcclusionTap, sampleX, sampleY });
	const gradientFrame = blockFrameFromGradient(block.gradientX, block.gradientY);


	const frame =
		typeof input.measureEdgeRunsAlongX === "boolean"
			? { ...gradientFrame, edgeRunsAlongX: input.measureEdgeRunsAlongX }
			: gradientFrame;


	const plainDistanceTexels = (block.value - SILHOUETTE_MID_COVERAGE) * frame.inverseGradient;
	if (0 >= frame.edgeConfidence) {
		return {
			light: silhouetteLightFromDistance({
				signedDistanceTexels: plainDistanceTexels,
				widthTexels,
			}),
			plainValue: block.value,
			plainDistanceTexels,
			fittedDistanceTexels: plainDistanceTexels,
			drawnDistanceTexels: plainDistanceTexels,
			edgeRunsAlongX: frame.edgeRunsAlongX,
			normalX: frame.normalX,
			normalY: frame.normalY,
			acrossPerAlong: 0,
			measuredClimb: 0,
			reachTexels: 0,
			usableColumnCount: 0,
			weight: 0,
			spreadTexels: 0,
			crossingCentreOffsetTexels: 0,
			residualTexels: LINE_FIT_UNUSABLE_RESIDUAL_TEXELS,
			edgeConfidence: 0,
			trust: 0,
		};
	}
	const alongSample = frame.edgeRunsAlongX ? sampleX : sampleY;
	const acrossSample = frame.edgeRunsAlongX ? sampleY : sampleX;
	const alongNormal = frame.edgeRunsAlongX ? frame.normalX : frame.normalY;
	const acrossNormal = frame.edgeRunsAlongX ? frame.normalY : frame.normalX;


	const acrossPerAlong = -alongNormal / acrossNormal;


	const litSideIsUp = acrossNormal > 0;
	const baseAlong = Math.floor(alongSample);
	const baseAcross = Math.floor(acrossSample);
	const subAlong = alongSample - baseAlong;
	const subAcross = acrossSample - baseAcross;
	const placement = {
		readOcclusionTap,
		edgeRunsAlongX: frame.edgeRunsAlongX,
		litSideIsUp,
		baseAlong,
		baseAcross,
		subAlong,
		subAcross,
	};


	const nearLook = fitEdgeLineFromColumns(placement, acrossPerAlong, STRAIGHT_KERNEL_NEAR_COLUMNS);


	const measuredClimb = clampClimbToPossibleRange(nearLook.line.acrossPerAlong);
	const secondColumns = columnsForSecondLook(measuredClimb, acrossPerAlong);
	const secondLook = secondColumns
		? fitEdgeLineFromColumns(
				placement,
				climbToShearSecondLookBy(secondColumns, measuredClimb),
				secondColumns,
			)
		: nearLook;


	const look = lookBelievability(secondLook) >= lookBelievability(nearLook) ? secondLook : nearLook;
	const line = look.line;


	const litSideSign = litSideIsUp ? 1 : -1;
	const fittedDistanceTexels =
		-line.acrossAtSample * litSideSign * perpendicularScaleFromClimb(line.acrossPerAlong);


	const lineTrust = lineFitTrust(line);
	const cappedFittedDistanceTexels = moveContourOntoLine(
		plainDistanceTexels,
		fittedDistanceTexels,
	);
	const drawnDistanceTexels = blendedContourDistanceTexels({
		plainDistanceTexels,
		straightenedDistanceTexels: cappedFittedDistanceTexels,
		straightenerTrust: lineTrust,
	});
	const trust = frame.edgeConfidence * lineTrust;
	return {


		light: silhouetteLightFromDistance({
			signedDistanceTexels: drawnDistanceTexels,
			widthTexels,
		}),
		plainValue: block.value,
		plainDistanceTexels,
		fittedDistanceTexels,
		drawnDistanceTexels,
		edgeRunsAlongX: frame.edgeRunsAlongX,
		normalX: frame.normalX,
		normalY: frame.normalY,
		acrossPerAlong,
		measuredClimb,
		reachTexels: look.reachTexels,
		usableColumnCount: look.usableColumnCount,
		weight: line.weight,
		spreadTexels: line.spreadTexels,
		crossingCentreOffsetTexels: line.crossingCentreOffsetTexels,
		residualTexels: line.residualTexels,
		edgeConfidence: frame.edgeConfidence,
		trust,
	};
}


const FRAME_MAJORITY_SHARE = 0.5;


export function explainShadowEdgeStraightening(rawInput) {
	const input = rawInput && typeof rawInput === "object" ? rawInput : {};
	const alongXMeasurement = explainStraighteningInFrame({
		...input,
		measureEdgeRunsAlongX: true,
	});


	if (!frameSecondLookIsWorthTaking(alongXMeasurement.measuredClimb))
		return { ...alongXMeasurement, alongXShare: 1 };
	const alongYMeasurement = explainStraighteningInFrame({
		...input,
		measureEdgeRunsAlongX: false,
	});


	const alongXShare = alongAxisXShareFromClimbs({
		alongXClimb: alongXMeasurement.measuredClimb,
		alongYClimb: alongYMeasurement.measuredClimb,
	});
	if (!frameShareIsWorthMeasuring(1 - alongXShare)) return { ...alongXMeasurement, alongXShare };
	if (!frameShareIsWorthMeasuring(alongXShare)) return { ...alongYMeasurement, alongXShare };


	const drawnDistanceTexels = blendFrameDistanceTexels({
		alongXDistanceTexels: alongXMeasurement.drawnDistanceTexels,
		alongYDistanceTexels: alongYMeasurement.drawnDistanceTexels,
		alongXShare,
	});
	const dominantMeasurement =
		alongXShare >= FRAME_MAJORITY_SHARE ? alongXMeasurement : alongYMeasurement;
	const widthTexels = toFiniteNumber(input.widthTexels, SILHOUETTE_MIN_WIDTH_TEXELS);
	return {
		...dominantMeasurement,
		alongXShare,
		drawnDistanceTexels,
		light: silhouetteLightFromDistance({
			signedDistanceTexels: drawnDistanceTexels,
			widthTexels,
		}),
	};
}


export function straightenedShadowEdgeLight(rawInput) {
	return explainShadowEdgeStraightening(rawInput).light;
}


export function buildShadowEdgeStraightKernelGlsl() {
	const midCoverage = SILHOUETTE_MID_COVERAGE.toFixed(2);
	const minGradient = SILHOUETTE_MIN_GRADIENT.toFixed(6);
	const lastTapEdge = STRAIGHT_KERNEL_LAST_TAP_EDGE_TEXELS.toFixed(1);
	const firstTapEdge = STRAIGHT_KERNEL_FIRST_TAP_EDGE_TEXELS.toFixed(1);
	const highestCrossingCount = (STRAIGHT_KERNEL_ACROSS_TAP_OFFSETS.length - 0.5).toFixed(1);
	const climbDisagreement = STRAIGHT_KERNEL_CLIMB_DISAGREEMENT.toFixed(4);
	const resolvedClimb = STRAIGHT_KERNEL_RESOLVED_CLIMB.toFixed(6);
	const resolvedPhaseDistance = STRAIGHT_KERNEL_RESOLVED_PHASE_DISTANCE.toFixed(6);
	const unresolvedClimb = STRAIGHT_KERNEL_UNRESOLVED_CLIMB.toFixed(4);
	const climbRangeGlsl = buildShadowEdgeClimbRangeGlsl();


	const columnsPerLook = STRAIGHT_KERNEL_NEAR_COLUMNS.alongTexels.length.toFixed(1);
	const glimpsedShare = STRAIGHT_KERNEL_GLIMPSED_COLUMN_SHARE.toFixed(2);
	const measuredShare = STRAIGHT_KERNEL_MEASURED_COLUMN_SHARE.toFixed(2);
	const unrollColumns = (columns) =>
		columns.alongTexels
			.map(
				(alongTexels) =>
					`  rswShadowEdgeAddColumn(shadowMap, alongSums, acrossSums, usableColumns, baseUv, receiverDepth, alongStep, acrossStep, subAcross, ${alongTexels.toFixed(
						1,
					)}, acrossPerAlong, subAlong, litSideIsUp, ${columns.windowTexels.toFixed(1)});`,
			)
			.join("\n");
	const nearColumns = unrollColumns(STRAIGHT_KERNEL_NEAR_COLUMNS);
	const wideColumns = unrollColumns(STRAIGHT_KERNEL_WIDE_COLUMNS);
	return `
                                                                              
                                                                          
                                                                
float rswShadowEdgeTap(sampler2D shadowMap, vec2 tapUv, float receiverDepth) {
  return rswUnpackDepth(texture2D(shadowMap, tapUv)) >= receiverDepth ? 1.0 : 0.0;
}
                                                                 
vec2 rswShadowEdgeRow(sampler2D shadowMap, vec2 rowUv, float receiverDepth, vec2 stepX, vec4 valueWeightX, vec4 gradientWeightX) {
  vec4 occlusion = vec4(
    rswShadowEdgeTap(shadowMap, rowUv - stepX, receiverDepth),
    rswShadowEdgeTap(shadowMap, rowUv, receiverDepth),
    rswShadowEdgeTap(shadowMap, rowUv + stepX, receiverDepth),
    rswShadowEdgeTap(shadowMap, rowUv + 2.0 * stepX, receiverDepth)
  );
  return vec2(dot(valueWeightX, occlusion), dot(gradientWeightX, occlusion));
}
                                                                                
                                                                         
                                                                               
                                                                            
                                 
vec2 rswShadowEdgeColumnCrossing(sampler2D shadowMap, vec2 columnUv, float receiverDepth, vec2 acrossStep, float subAcross, float litSideIsUp) {
  vec4 occlusion = vec4(
    rswShadowEdgeTap(shadowMap, columnUv - acrossStep, receiverDepth),
    rswShadowEdgeTap(shadowMap, columnUv, receiverDepth),
    rswShadowEdgeTap(shadowMap, columnUv + acrossStep, receiverDepth),
    rswShadowEdgeTap(shadowMap, columnUv + 2.0 * acrossStep, receiverDepth)
  );
  float litTapCount = dot(occlusion, vec4(1.0));
                                                                          
                                                                         
  float boundaryTexels = mix(${firstTapEdge} + litTapCount, ${lastTapEdge} - litTapCount, litSideIsUp);
                                                                      
  float hasCrossing = step(0.5, litTapCount) * step(litTapCount, ${highestCrossingCount});
  return vec2(boundaryTexels - subAcross, hasCrossing);
}
                                                                             
                                                                          
                                                                               
                  
float rswShadowEdgeAlongWindow(float alongTexels, float windowTexels) {
  return rswShadowEdgeBasisValue(2.0 * alongTexels / max(1.0, windowTexels));
}
                                                                             
                                                                          
void rswShadowEdgeAddColumn(sampler2D shadowMap, inout vec3 alongSums, inout vec3 acrossSums, inout float usableColumns, vec2 baseUv, float receiverDepth, vec2 alongStep, vec2 acrossStep, float subAcross, float alongTexels, float acrossPerAlong, float subAlong, float litSideIsUp, float windowTexels) {
                                                                               
                                                                                 
                                                                                 
                                                                           
                                                                               
                                                         
  float alongFromSample = alongTexels - subAlong;
                                                                                
                                                                               
                                      
  float shearTexels = floor(subAcross + alongFromSample * acrossPerAlong);
  vec2 columnUv = baseUv + alongTexels * alongStep + shearTexels * acrossStep;
  vec2 crossing = rswShadowEdgeColumnCrossing(shadowMap, columnUv, receiverDepth, acrossStep, subAcross, litSideIsUp);
                                                                               
                                                                          
  rswShadowEdgeAccumulateColumn(alongSums, acrossSums, alongFromSample, shearTexels + crossing.x, crossing.y * rswShadowEdgeAlongWindow(alongFromSample, windowTexels));
                                                                            
                                                       
  usableColumns += crossing.y;
}
                                                                              
                  
${climbRangeGlsl}void rswShadowEdgeFitNearColumns(sampler2D shadowMap, vec2 baseUv, float receiverDepth, vec2 alongStep, vec2 acrossStep, float subAlong, float subAcross, float litSideIsUp, float acrossPerAlong, out vec3 alongSums, out vec3 acrossSums, out float usableColumns) {
  alongSums = vec3(0.0);
  acrossSums = vec3(0.0);
  usableColumns = 0.0;
${nearColumns}
}
                                                                              
                                                                                
                         
void rswShadowEdgeFitWideColumns(sampler2D shadowMap, vec2 baseUv, float receiverDepth, vec2 alongStep, vec2 acrossStep, float subAlong, float subAcross, float litSideIsUp, float acrossPerAlong, out vec3 alongSums, out vec3 acrossSums, out float usableColumns) {
  alongSums = vec3(0.0);
  acrossSums = vec3(0.0);
  usableColumns = 0.0;
${wideColumns}
}
                                                                             
                                                                    
float rswShadowEdgeLookBelievability(float trust, float usableColumns) {
  return trust * smoothstep(${glimpsedShare}, ${measuredShare}, usableColumns / ${columnsPerLook});
}
                                                                                 
                                                                             
                                        
float rswShadowEdgeClimbFromWholeTexels(float climb) {
  float magnitude = abs(climb);
  return abs(magnitude - floor(magnitude + 0.5));
}
                                                                           
                                                                          
                                                                             
                                                                         
                                                                              
                                                                                
                                                                          
                                     
bool rswShadowEdgeNearLookClimbIsUnresolved(float climb) {
  if (${resolvedClimb} >= abs(climb)) return true;
  return ${resolvedPhaseDistance} >= rswShadowEdgeClimbFromWholeTexels(climb);
}
                                                                               
                                                                            
                                       
  
                                                                                
                                                                            
                                                                               
                                     
vec2 rswShadowEdgeStraightenedInFrame(sampler2D shadowMap, vec2 shadowMapSize, vec3 rswCoord, bool rswEdgeRunsAlongX) {
  vec2 rswTexel = 1.0 / max(shadowMapSize, vec2(1.0));
                                                                               
                                                                                
                                                                          
  vec2 rswGrid = rswCoord.xy * shadowMapSize - 0.5;
  vec2 rswBaseTexel = floor(rswGrid);
  vec2 rswSubTexel = rswGrid - rswBaseTexel;
  vec2 rswBaseUv = (rswBaseTexel + 0.5) * rswTexel;
  vec2 rswStepX = vec2(rswTexel.x, 0.0);
  vec2 rswStepY = vec2(0.0, rswTexel.y);
                                                                              
                                               
  float rswDepth = rswCoord.z;
                                                                     
  vec4 rswValueWeightX = rswShadowEdgeValueWeights(rswSubTexel.x);
  vec4 rswGradientWeightX = rswShadowEdgeGradientWeights(rswSubTexel.x);
  vec4 rswValueWeightY = rswShadowEdgeValueWeights(rswSubTexel.y);
  vec4 rswGradientWeightY = rswShadowEdgeGradientWeights(rswSubTexel.y);
  vec2 rswRowBelow = rswShadowEdgeRow(shadowMap, rswBaseUv - rswStepY, rswDepth, rswStepX, rswValueWeightX, rswGradientWeightX);
  vec2 rswRowBase = rswShadowEdgeRow(shadowMap, rswBaseUv, rswDepth, rswStepX, rswValueWeightX, rswGradientWeightX);
  vec2 rswRowAbove = rswShadowEdgeRow(shadowMap, rswBaseUv + rswStepY, rswDepth, rswStepX, rswValueWeightX, rswGradientWeightX);
  vec2 rswRowFar = rswShadowEdgeRow(shadowMap, rswBaseUv + 2.0 * rswStepY, rswDepth, rswStepX, rswValueWeightX, rswGradientWeightX);
  vec4 rswRowValue = vec4(rswRowBelow.x, rswRowBase.x, rswRowAbove.x, rswRowFar.x);
  vec4 rswRowGradient = vec4(rswRowBelow.y, rswRowBase.y, rswRowAbove.y, rswRowFar.y);
  float rswValue = dot(rswValueWeightY, rswRowValue);
  vec2 rswGradient = vec2(dot(rswValueWeightY, rswRowGradient), dot(rswGradientWeightY, rswRowValue));
  float rswGradientLength = length(rswGradient);
  float rswInverseGradient = 1.0 / max(rswGradientLength, ${minGradient});
  float rswPlainDistance = (rswValue - ${midCoverage}) * rswInverseGradient;
  float rswEdgeConfidence = rswShadowEdgeConfidence(rswGradientLength);
                                                                                
                                                                             
                                                                               
                                                                
                                                                        
                                                                             
                                       
  if (0.0 >= rswEdgeConfidence) return vec2(rswPlainDistance, 0.0);
                                                                               
                                                                            
                                                                                
                  
    
                                                                         
                                                                               
                                                                                
                                                                             
                                                                                
                                                                               
                                                                              
                                                                                 
                                                                              
                                                                            
                                                                               
                                                                               
                                                           
  vec2 rswNormal = rswGradient * rswInverseGradient;
  vec2 rswAlongStep = rswEdgeRunsAlongX ? rswStepX : rswStepY;
  vec2 rswAcrossStep = rswEdgeRunsAlongX ? rswStepY : rswStepX;
  float rswSubAlong = rswEdgeRunsAlongX ? rswSubTexel.x : rswSubTexel.y;
  float rswSubAcross = rswEdgeRunsAlongX ? rswSubTexel.y : rswSubTexel.x;
  float rswAlongNormal = rswEdgeRunsAlongX ? rswNormal.x : rswNormal.y;
  float rswAcrossNormal = rswEdgeRunsAlongX ? rswNormal.y : rswNormal.x;
  float rswAcrossPerAlong = -rswAlongNormal / rswAcrossNormal;
                                                                               
                                        
  float rswLitSideIsUp = step(0.0, rswAcrossNormal);
                                                                           
                                                                              
  vec3 rswNearAlongSums;
  vec3 rswNearAcrossSums;
  float rswNearUsableColumns;
  rswShadowEdgeFitNearColumns(shadowMap, rswBaseUv, rswDepth, rswAlongStep, rswAcrossStep, rswSubAlong, rswSubAcross, rswLitSideIsUp, rswAcrossPerAlong, rswNearAlongSums, rswNearAcrossSums, rswNearUsableColumns);
  vec4 rswLine = rswShadowEdgeSolveLine(rswNearAlongSums, rswNearAcrossSums);
  float rswNearTrust = rswShadowEdgeLineTrust(rswLine.z, rswNearAlongSums.x, rswLine.w, rswShadowEdgeLineCentreOffset(rswNearAlongSums));
  float rswNearBelief = rswShadowEdgeLookBelievability(rswNearTrust, rswNearUsableColumns);
  float rswLineTrust = rswNearTrust;
                                                                          
                              
                                                                             
  float rswMeasuredClimb = rswShadowEdgeClampClimb(rswLine.y);
                                                                               
                                                                             
                                                                             
  vec3 rswSecondAlongSums = vec3(0.0);
  vec3 rswSecondAcrossSums = vec3(0.0);
  float rswSecondUsableColumns = 0.0;
  bool rswTookSecondLook = true;
  if (rswShadowEdgeNearLookClimbIsUnresolved(rswMeasuredClimb)) {
                                                                             
                                                                        
                                                    
    float rswWideShear = ${resolvedClimb} >= abs(rswMeasuredClimb) ? ${unresolvedClimb} : rswMeasuredClimb;
    rswShadowEdgeFitWideColumns(shadowMap, rswBaseUv, rswDepth, rswAlongStep, rswAcrossStep, rswSubAlong, rswSubAcross, rswLitSideIsUp, rswWideShear, rswSecondAlongSums, rswSecondAcrossSums, rswSecondUsableColumns);
  } else if (abs(rswMeasuredClimb - rswAcrossPerAlong) > ${climbDisagreement}) {
    rswShadowEdgeFitNearColumns(shadowMap, rswBaseUv, rswDepth, rswAlongStep, rswAcrossStep, rswSubAlong, rswSubAcross, rswLitSideIsUp, rswMeasuredClimb, rswSecondAlongSums, rswSecondAcrossSums, rswSecondUsableColumns);
  } else {
    rswTookSecondLook = false;
  }
  if (rswTookSecondLook) {
    vec4 rswSecondLine = rswShadowEdgeSolveLine(rswSecondAlongSums, rswSecondAcrossSums);
    float rswSecondTrust = rswShadowEdgeLineTrust(rswSecondLine.z, rswSecondAlongSums.x, rswSecondLine.w, rswShadowEdgeLineCentreOffset(rswSecondAlongSums));
    if (rswShadowEdgeLookBelievability(rswSecondTrust, rswSecondUsableColumns) >= rswNearBelief) {
      rswLine = rswSecondLine;
      rswLineTrust = rswSecondTrust;
    }
  }
                                                                            
                                                                               
                                                                              
                                                                              
                                                                               
  float rswFittedDistance = -rswLine.x * (2.0 * rswLitSideIsUp - 1.0) * rswShadowEdgePerpendicularScaleFromClimb(rswLine.y);
                                                                             
                                                                                 
                                                                                  
                                                              
                                                                                 
                                                                               
                                                                               
                                                
  float rswCappedDistance = rswShadowEdgeMoveContour(rswPlainDistance, rswFittedDistance);
  float rswStraightDistance = rswShadowEdgeBlendContour(rswPlainDistance, rswCappedDistance, rswLineTrust);
                                                                             
                                                                               
                                                                                 
                                                                                
                                                                                 
                                                                                 
                                                       
    
                                                                               
                                                                                
                                                                        
  return vec2(rswStraightDistance, rswMeasuredClimb);
}
                                                                                
                                                                              
                                                                          
float rswShadowEdgeStraightened(sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, vec4 shadowCoordIn, float widthTexels) {
  vec3 rswCoord = shadowCoordIn.xyz / shadowCoordIn.w;
  rswCoord.z += shadowBias;
  bvec4 rswInside = bvec4(rswCoord.x >= 0.0, 1.0 >= rswCoord.x, rswCoord.y >= 0.0, 1.0 >= rswCoord.y);
  if (!all(rswInside) || rswCoord.z > 1.0 || 0.0 > rswCoord.z) return 1.0;
                                                                              
                                                                             
                                                                             
                                                                          
                                                                         
                                                   
  vec2 rswAlongXFrame = rswShadowEdgeStraightenedInFrame(shadowMap, shadowMapSize, rswCoord, true);
  float rswDrawnDistance = rswAlongXFrame.x;
                                                                               
                                                                        
  if (rswShadowEdgeSecondLookIsWorthTaking(rswAlongXFrame.y)) {
    vec2 rswAlongYFrame = rswShadowEdgeStraightenedInFrame(shadowMap, shadowMapSize, rswCoord, false);
    float rswAlongXShare = rswShadowEdgeAlongAxisXShare(rswAlongXFrame.y, rswAlongYFrame.y);
                                                                            
                                                                       
                                                           
    if (rswShadowEdgeFrameWorthMeasuring(1.0 - rswAlongXShare)) {
      rswDrawnDistance = rswShadowEdgeFrameWorthMeasuring(rswAlongXShare)
        ? rswShadowEdgeBlendFrameDistance(rswAlongXFrame.x, rswAlongYFrame.x, rswAlongXShare)
        : rswAlongYFrame.x;
    }
  }
                                                                                
                                                            
  return rswShadowEdgeLightFromDistance(rswDrawnDistance, widthTexels);
}
`;
}
