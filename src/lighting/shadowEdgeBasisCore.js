export const SHADOW_EDGE_AXIS_TAP_OFFSETS = Object.freeze([-1, 0, 1, 2]);
export const SHADOW_EDGE_AXIS_TAP_SPAN = SHADOW_EDGE_AXIS_TAP_OFFSETS.length;

function positivePart(value) {
	return Math.max(0, value);
}

function square(value) {
	return value * value;
}

function cube(value) {
	return value * value * value;
}


function toFiniteNumber(value, fallback) {
	if (value === null || value === "" || typeof value === "boolean") return fallback;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function clampToRange(value, minimum, maximum) {
	return Math.min(maximum, Math.max(minimum, value));
}


export function cubicBSplineValue(distanceInTexels) {
	const distance = Math.abs(distanceInTexels);
	return (cube(positivePart(2 - distance)) - 4 * cube(positivePart(1 - distance))) / 6;
}


export function cubicBSplineSlope(distanceInTexels) {
	const distance = Math.abs(distanceInTexels);
	const magnitude =
		(4 * square(positivePart(1 - distance)) - square(positivePart(2 - distance))) / 2;
	return distanceInTexels >= 0 ? magnitude : -magnitude;
}

function axisWeights(subTexelOffset, weightOfDistance) {
	const offset = clampToRange(toFiniteNumber(subTexelOffset, 0), 0, 1);
	return SHADOW_EDGE_AXIS_TAP_OFFSETS.map((tapOffset) => weightOfDistance(tapOffset - offset));
}


export function shadowEdgeValueWeights(subTexelOffset) {
	return axisWeights(subTexelOffset, cubicBSplineValue);
}


export function shadowEdgeGradientWeights(subTexelOffset) {
	return axisWeights(subTexelOffset, (distance) => -cubicBSplineSlope(distance));
}


export function buildShadowEdgeBasisGlsl() {
	return `
                                                                         
                                             
float rswShadowEdgeBasisValue(float distanceInTexels) {
  float d = abs(distanceInTexels);
  float outer = max(0.0, 2.0 - d);
  float inner = max(0.0, 1.0 - d);
  return (outer * outer * outer - 4.0 * inner * inner * inner) / 6.0;
}
float rswShadowEdgeBasisSlope(float distanceInTexels) {
  float d = abs(distanceInTexels);
  float outer = max(0.0, 2.0 - d);
  float inner = max(0.0, 1.0 - d);
  return sign(distanceInTexels) * (4.0 * inner * inner - outer * outer) / 2.0;
}
                                                                             
                                                   
vec4 rswShadowEdgeValueWeights(float subTexelOffset) {
  return vec4(
    rswShadowEdgeBasisValue(-1.0 - subTexelOffset),
    rswShadowEdgeBasisValue(0.0 - subTexelOffset),
    rswShadowEdgeBasisValue(1.0 - subTexelOffset),
    rswShadowEdgeBasisValue(2.0 - subTexelOffset)
  );
}
                                                 
vec4 rswShadowEdgeGradientWeights(float subTexelOffset) {
  return -vec4(
    rswShadowEdgeBasisSlope(-1.0 - subTexelOffset),
    rswShadowEdgeBasisSlope(0.0 - subTexelOffset),
    rswShadowEdgeBasisSlope(1.0 - subTexelOffset),
    rswShadowEdgeBasisSlope(2.0 - subTexelOffset)
  );
}
`;
}
