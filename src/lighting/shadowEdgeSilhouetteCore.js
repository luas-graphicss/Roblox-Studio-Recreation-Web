export const SILHOUETTE_MID_COVERAGE = 0.5;


export const SILHOUETTE_MIN_GRADIENT = 1e-4;


export const SILHOUETTE_EDGE_GRADIENT_FLOOR = 0.02;
export const SILHOUETTE_EDGE_GRADIENT_CEILING = 0.12;


export const SILHOUETTE_MIN_WIDTH_TEXELS = 1;


export const SILHOUETTE_SATURATION_EPSILON = 1e-6;

function toFiniteNumber(value, fallback) {
	if (value === null || value === "" || typeof value === "boolean") return fallback;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function clampToRange(value, minimum, maximum) {
	return Math.min(maximum, Math.max(minimum, value));
}

function smoothstepBetween(edgeLow, edgeHigh, value) {
	const normalized = clampToRange((value - edgeLow) / (edgeHigh - edgeLow), 0, 1);
	return normalized * normalized * (3 - 2 * normalized);
}

function snapToSaturation(coverage) {
	if (coverage > 1 - SILHOUETTE_SATURATION_EPSILON) return 1;
	if (SILHOUETTE_SATURATION_EPSILON > coverage) return 0;
	return coverage;
}


export function silhouetteEdgeConfidence(gradientLength) {
	return smoothstepBetween(
		SILHOUETTE_EDGE_GRADIENT_FLOOR,
		SILHOUETTE_EDGE_GRADIENT_CEILING,
		toFiniteNumber(gradientLength, 0),
	);
}


export function silhouetteLightFromDistance(rawInput) {
	const input = rawInput && typeof rawInput === "object" ? rawInput : {};
	const signedDistanceTexels = toFiniteNumber(input.signedDistanceTexels, 0);
	const widthTexels = Math.max(
		SILHOUETTE_MIN_WIDTH_TEXELS,
		toFiniteNumber(input.widthTexels, SILHOUETTE_MIN_WIDTH_TEXELS),
	);
	return snapToSaturation(
		clampToRange(SILHOUETTE_MID_COVERAGE + signedDistanceTexels / widthTexels, 0, 1),
	);
}


export function silhouetteCoverage(rawInput) {
	const input = rawInput && typeof rawInput === "object" ? rawInput : {};
	const plainValue = clampToRange(toFiniteNumber(input.plainValue, 1), 0, 1);
	const straightValue = clampToRange(toFiniteNumber(input.straightValue, plainValue), 0, 1);
	const acrossGradient = Math.abs(toFiniteNumber(input.acrossGradient, 0));
	return silhouetteLightFromDistance({
		signedDistanceTexels:
			(straightValue - SILHOUETTE_MID_COVERAGE) /
			Math.max(acrossGradient, SILHOUETTE_MIN_GRADIENT),
		widthTexels: input.widthTexels,
	});
}


export function buildShadowEdgeSilhouetteGlsl() {
	const midCoverage = SILHOUETTE_MID_COVERAGE.toFixed(2);
	const minGradient = SILHOUETTE_MIN_GRADIENT.toFixed(6);
	const gradientFloor = SILHOUETTE_EDGE_GRADIENT_FLOOR.toFixed(4);
	const gradientCeiling = SILHOUETTE_EDGE_GRADIENT_CEILING.toFixed(4);
	const minWidth = SILHOUETTE_MIN_WIDTH_TEXELS.toFixed(2);
	const saturationEpsilon = SILHOUETTE_SATURATION_EPSILON.toFixed(6);
	return `
                                                                          
                                                                             
                                                                         
                                                                              
                                       
float rswShadowEdgeConfidence(float gradientLength) {
  return smoothstep(${gradientFloor}, ${gradientCeiling}, gradientLength);
}
                                                                                
                                                                            
                          
float rswShadowEdgeLightFromDistance(float signedDistanceTexels, float widthTexels) {
  float rampTexels = max(widthTexels, ${minWidth});
                                                                                 
                                                                             
                                                                               
                                                                             
  float coverage = clamp(${midCoverage} + signedDistanceTexels / rampTexels, 0.0, 1.0);
                                                                               
                                                                           
  if (coverage > 1.0 - ${saturationEpsilon}) return 1.0;
  if (${saturationEpsilon} > coverage) return 0.0;
  return coverage;
}
                                                                              
            
float rswShadowEdgeCoverage(float straightValue, float acrossGradient, float widthTexels) {
  float signedDistanceTexels = (straightValue - ${midCoverage}) / max(abs(acrossGradient), ${minGradient});
  return rswShadowEdgeLightFromDistance(signedDistanceTexels, widthTexels);
}
`;
}
