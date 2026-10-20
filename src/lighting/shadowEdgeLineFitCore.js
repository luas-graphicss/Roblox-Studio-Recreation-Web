export const LINE_FIT_MIN_WEIGHT = 1e-3;


export const LINE_FIT_MIN_DETERMINANT = 1e-6;


export const LINE_FIT_UNUSABLE_RESIDUAL_TEXELS = 9;


export const LINE_FIT_MAX_MOVE_TEXELS = 0.5;


export const LINE_FIT_STRAIGHT_RESIDUAL_TEXELS = 0.45;


export const LINE_FIT_BENT_RESIDUAL_TEXELS = 1.2;


export const LINE_FIT_TRUSTED_WEIGHT = 1.6;
export const LINE_FIT_UNTRUSTED_WEIGHT = 1;


export const LINE_FIT_TRUSTED_SPREAD_TEXELS = 1;
export const LINE_FIT_UNTRUSTED_SPREAD_TEXELS = 0.5;


export const LINE_FIT_MIN_SPREAD_TEXELS = 1e-3;


export const LINE_FIT_CENTRED_OFFSET_SPREADS = 0.75;
export const LINE_FIT_EXTRAPOLATED_OFFSET_SPREADS = 1.75;

function toFiniteNumber(value, fallback) {
	if (value === null || value === "" || typeof value === "boolean") return fallback;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function clampToRange(value, lowest, highest) {
	if (value > highest) return highest;
	if (lowest > value) return lowest;
	return value;
}

function smoothstepBetween(edgeLow, edgeHigh, value) {
	const span = edgeHigh - edgeLow;
	if (Math.abs(span) === 0) return value > edgeLow ? 1 : 0;
	const normalized = clampToRange((value - edgeLow) / span, 0, 1);
	return normalized * normalized * (3 - 2 * normalized);
}


export function emptyLineFitSums() {
	return {
		weight: 0,
		along: 0,
		alongSquared: 0,
		across: 0,
		alongAcross: 0,
		acrossSquared: 0,
	};
}


export function accumulateLineFitColumn(sums, rawCrossing) {
	const crossing = rawCrossing && typeof rawCrossing === "object" ? rawCrossing : {};
	const weight = Math.max(0, toFiniteNumber(crossing.weight, 0));
	if (weight === 0) return sums;
	const alongTexels = toFiniteNumber(crossing.alongTexels, 0);
	const acrossTexels = toFiniteNumber(crossing.acrossTexels, 0);
	sums.weight += weight;
	sums.along += weight * alongTexels;
	sums.alongSquared += weight * alongTexels * alongTexels;
	sums.across += weight * acrossTexels;
	sums.alongAcross += weight * alongTexels * acrossTexels;
	sums.acrossSquared += weight * acrossTexels * acrossTexels;
	return sums;
}


export function solveLineFit(rawSums) {
	const sums = rawSums && typeof rawSums === "object" ? rawSums : emptyLineFitSums();
	const weight = toFiniteNumber(sums.weight, 0);
	const determinant =
		weight * toFiniteNumber(sums.alongSquared, 0) - toFiniteNumber(sums.along, 0) ** 2;
	const unusable = {
		acrossAtSample: 0,
		acrossPerAlong: 0,
		residualTexels: LINE_FIT_UNUSABLE_RESIDUAL_TEXELS,
		weight,
		spreadTexels: 0,
		crossingCentreOffsetTexels: 0,
	};
	if (LINE_FIT_MIN_WEIGHT > weight) return unusable;
	if (Math.abs(determinant) > LINE_FIT_MIN_DETERMINANT === false) return unusable;
	const along = toFiniteNumber(sums.along, 0);
	const alongSquared = toFiniteNumber(sums.alongSquared, 0);
	const across = toFiniteNumber(sums.across, 0);
	const alongAcross = toFiniteNumber(sums.alongAcross, 0);
	const acrossSquared = toFiniteNumber(sums.acrossSquared, 0);
	const acrossPerAlong = (weight * alongAcross - along * across) / determinant;
	const acrossAtSample = (alongSquared * across - along * alongAcross) / determinant;
	const residualSquared =
		(acrossSquared - acrossPerAlong * alongAcross - acrossAtSample * across) / weight;
	const meanAlong = along / weight;
	const spreadSquared = alongSquared / weight - meanAlong * meanAlong;
	return {
		acrossAtSample,
		acrossPerAlong,
		residualTexels: Math.sqrt(Math.max(0, residualSquared)),
		weight,
		spreadTexels: Math.sqrt(Math.max(0, spreadSquared)),
		crossingCentreOffsetTexels: Math.abs(meanAlong),
	};
}


export function lineFitStraightness(residualTexels) {
	const residual = toFiniteNumber(residualTexels, LINE_FIT_UNUSABLE_RESIDUAL_TEXELS);
	return (
		1 -
		smoothstepBetween(
			LINE_FIT_STRAIGHT_RESIDUAL_TEXELS,
			LINE_FIT_BENT_RESIDUAL_TEXELS,
			Math.abs(residual),
		)
	);
}


export function lineFitCertainty(weight, spreadTexels) {
	return (
		smoothstepBetween(
			LINE_FIT_UNTRUSTED_WEIGHT,
			LINE_FIT_TRUSTED_WEIGHT,
			toFiniteNumber(weight, 0),
		) *
		smoothstepBetween(
			LINE_FIT_UNTRUSTED_SPREAD_TEXELS,
			LINE_FIT_TRUSTED_SPREAD_TEXELS,
			toFiniteNumber(spreadTexels, 0),
		)
	);
}


export function lineFitExtrapolationSpreads(crossingCentreOffsetTexels, spreadTexels) {
	const spread = Math.max(toFiniteNumber(spreadTexels, 0), LINE_FIT_MIN_SPREAD_TEXELS);
	return Math.abs(toFiniteNumber(crossingCentreOffsetTexels, 0)) / spread;
}


export function lineFitBalance(crossingCentreOffsetTexels, spreadTexels) {
	return (
		1 -
		smoothstepBetween(
			LINE_FIT_CENTRED_OFFSET_SPREADS,
			LINE_FIT_EXTRAPOLATED_OFFSET_SPREADS,
			lineFitExtrapolationSpreads(crossingCentreOffsetTexels, spreadTexels),
		)
	);
}


export function lineFitTrust(rawLine) {
	const line = rawLine && typeof rawLine === "object" ? rawLine : {};
	return (
		lineFitStraightness(line.residualTexels) *
		lineFitCertainty(line.weight, line.spreadTexels) *
		lineFitBalance(line.crossingCentreOffsetTexels, line.spreadTexels)
	);
}


export function moveContourOntoLine(plainTexels, fittedTexels) {
	const plain = toFiniteNumber(plainTexels, 0);
	const fitted = toFiniteNumber(fittedTexels, plain);
	return clampToRange(fitted, plain - LINE_FIT_MAX_MOVE_TEXELS, plain + LINE_FIT_MAX_MOVE_TEXELS);
}


export function buildShadowEdgeLineFitGlsl() {
	const minWeight = LINE_FIT_MIN_WEIGHT.toFixed(6);
	const minDeterminant = LINE_FIT_MIN_DETERMINANT.toFixed(8);
	const unusableResidual = LINE_FIT_UNUSABLE_RESIDUAL_TEXELS.toFixed(1);
	const maxMove = LINE_FIT_MAX_MOVE_TEXELS.toFixed(4);
	const straightResidual = LINE_FIT_STRAIGHT_RESIDUAL_TEXELS.toFixed(4);
	const bentResidual = LINE_FIT_BENT_RESIDUAL_TEXELS.toFixed(4);
	const trustedWeight = LINE_FIT_TRUSTED_WEIGHT.toFixed(4);
	const untrustedWeight = LINE_FIT_UNTRUSTED_WEIGHT.toFixed(4);
	const trustedSpread = LINE_FIT_TRUSTED_SPREAD_TEXELS.toFixed(4);
	const untrustedSpread = LINE_FIT_UNTRUSTED_SPREAD_TEXELS.toFixed(4);
	const minSpread = LINE_FIT_MIN_SPREAD_TEXELS.toFixed(6);
	const centredOffset = LINE_FIT_CENTRED_OFFSET_SPREADS.toFixed(4);
	const extrapolatedOffset = LINE_FIT_EXTRAPOLATED_OFFSET_SPREADS.toFixed(4);
	return `
                                                                               
                                                                                
                                                                              
                            
void rswShadowEdgeAccumulateColumn(inout vec3 alongSums, inout vec3 acrossSums, float alongTexels, float acrossTexels, float weight) {
  alongSums += weight * vec3(1.0, alongTexels, alongTexels * alongTexels);
  acrossSums += weight * vec3(acrossTexels, alongTexels * acrossTexels, acrossTexels * acrossTexels);
}
                                                                           
                 
vec4 rswShadowEdgeSolveLine(vec3 alongSums, vec3 acrossSums) {
  float weight = alongSums.x;
  float determinant = weight * alongSums.z - alongSums.y * alongSums.y;
                                                                                
                                                                     
  if (weight > ${minWeight} == false || abs(determinant) > ${minDeterminant} == false) return vec4(0.0, 0.0, ${unusableResidual}, 0.0);
  float acrossPerAlong = (weight * acrossSums.y - alongSums.y * acrossSums.x) / determinant;
  float acrossAtSample = (alongSums.z * acrossSums.x - alongSums.y * acrossSums.y) / determinant;
  float residualSquared = (acrossSums.z - acrossPerAlong * acrossSums.y - acrossAtSample * acrossSums.x) / weight;
  float meanAlong = alongSums.y / weight;
  float spreadSquared = alongSums.z / weight - meanAlong * meanAlong;
  return vec4(acrossAtSample, acrossPerAlong, sqrt(max(0.0, residualSquared)), sqrt(max(0.0, spreadSquared)));
}
                                          
float rswShadowEdgeLineStraightness(float residualTexels) {
  return 1.0 - smoothstep(${straightResidual}, ${bentResidual}, abs(residualTexels));
}
                                                                             
                                                                             
                                                                                
                                     
float rswShadowEdgeLineCertainty(float weight, float spreadTexels) {
  return smoothstep(${untrustedWeight}, ${trustedWeight}, weight) * smoothstep(${untrustedSpread}, ${trustedSpread}, spreadTexels);
}
                                                                              
                                                                               
                                                                    
float rswShadowEdgeLineCentreOffset(vec3 alongSums) {
  return abs(alongSums.y / max(alongSums.x, ${minWeight}));
}
                                                                           
                                                                              
                                                                                
                                                                               
                                                                              
float rswShadowEdgeLineBalance(float centreOffsetTexels, float spreadTexels) {
  return 1.0 - smoothstep(${centredOffset}, ${extrapolatedOffset}, centreOffsetTexels / max(spreadTexels, ${minSpread}));
}
                                                                             
                                               
float rswShadowEdgeLineTrust(float residualTexels, float weight, float spreadTexels, float centreOffsetTexels) {
  return rswShadowEdgeLineStraightness(residualTexels) * rswShadowEdgeLineCertainty(weight, spreadTexels) * rswShadowEdgeLineBalance(centreOffsetTexels, spreadTexels);
}
                                                                                
                                                   
float rswShadowEdgeMoveContour(float plainTexels, float fittedTexels) {
  return clamp(fittedTexels, plainTexels - ${maxMove}, plainTexels + ${maxMove});
}
`;
}
