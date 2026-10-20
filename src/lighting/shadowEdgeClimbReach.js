export const SHADOW_EDGE_MAX_CLIMB_ACROSS_PER_ALONG = 1;


export function clampClimbToPossibleRange(climb) {
	const value = Number.isFinite(climb) ? climb : 0;
	if (value > SHADOW_EDGE_MAX_CLIMB_ACROSS_PER_ALONG) {
		return SHADOW_EDGE_MAX_CLIMB_ACROSS_PER_ALONG;
	}
	if (-SHADOW_EDGE_MAX_CLIMB_ACROSS_PER_ALONG > value) {
		return -SHADOW_EDGE_MAX_CLIMB_ACROSS_PER_ALONG;
	}
	return value;
}


export function buildShadowEdgeClimbRangeGlsl() {
	const maxClimb = SHADOW_EDGE_MAX_CLIMB_ACROSS_PER_ALONG.toFixed(4);
	return `
                                                                                
                                                                          
                                              
float rswShadowEdgeClampClimb(float climb) {
  return clamp(climb, -${maxClimb}, ${maxClimb});
}
`;
}
