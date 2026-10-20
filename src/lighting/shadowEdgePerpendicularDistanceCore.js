import { TREAD_LENGTH_UNMEASURED_TEXELS } from "./shadowEdgeRunLengthCore.js";


export const PERPENDICULAR_SCALE_AXIS_ALIGNED = 1;


export function edgeClimbAcrossPerAlong(treadTexels) {
	const tread = Number.isFinite(treadTexels) ? treadTexels : TREAD_LENGTH_UNMEASURED_TEXELS;
	if (TREAD_LENGTH_UNMEASURED_TEXELS >= tread) return 0;
	return 1 / tread;
}


export function perpendicularScaleFromClimb(climbAcrossPerAlong) {
	const climb = Number.isFinite(climbAcrossPerAlong) ? climbAcrossPerAlong : 0;
	return PERPENDICULAR_SCALE_AXIS_ALIGNED / Math.sqrt(1 + climb * climb);
}


export function perpendicularScaleFromTreadTexels(treadTexels) {
	return perpendicularScaleFromClimb(edgeClimbAcrossPerAlong(treadTexels));
}


export function perpendicularDistanceTexels(rawInput) {
	const input = rawInput ?? {};
	const axisDistanceTexels = Number.isFinite(input.axisDistanceTexels)
		? input.axisDistanceTexels
		: 0;
	return axisDistanceTexels * perpendicularScaleFromTreadTexels(input.treadTexels);
}


export function buildShadowEdgePerpendicularDistanceGlsl() {
	const unmeasuredTread = TREAD_LENGTH_UNMEASURED_TEXELS.toFixed(2);
	const axisAlignedScale = PERPENDICULAR_SCALE_AXIS_ALIGNED.toFixed(1);
	return `
                                                                           
                           
float rswShadowEdgeClimb(float treadTexels) {
  return treadTexels > ${unmeasuredTread} ? ${axisAlignedScale} / treadTexels : 0.0;
}
                                                                            
                                                                                
                                                                                
                                                             
float rswShadowEdgePerpendicularScaleFromClimb(float climb) {
  return inversesqrt(1.0 + climb * climb);
}
                                                         
                                     
float rswShadowEdgePerpendicularScale(float treadTexels) {
  return rswShadowEdgePerpendicularScaleFromClimb(rswShadowEdgeClimb(treadTexels));
}
                                                       
float rswShadowEdgePerpendicularDistance(float axisDistanceTexels, float treadTexels) {
  return axisDistanceTexels * rswShadowEdgePerpendicularScale(treadTexels);
}
`;
}
