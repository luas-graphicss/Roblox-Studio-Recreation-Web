export const FRAME_TIE_BAND_CLIMB = 0.15;


export const FRAME_SECOND_LOOK_CLIMB_FLOOR = 0.7;


export const FRAME_MIN_SHARE = 1e-3;

function toFiniteNumber(value, fallback) {
	if (value === null || value === "" || typeof value === "boolean") return fallback;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}


function smoothstepBetween(edgeLow, edgeHigh, value) {
	const span = edgeHigh - edgeLow;
	if (!(Math.abs(span) > 0)) return value >= edgeHigh ? 1 : 0;
	const normalized = Math.max(0, Math.min(1, (value - edgeLow) / span));
	return normalized * normalized * (3 - 2 * normalized);
}


export function frameSecondLookIsWorthTaking(alongXClimb) {
	return Math.abs(toFiniteNumber(alongXClimb, 0)) >= FRAME_SECOND_LOOK_CLIMB_FLOOR;
}


export function alongAxisXShareFromClimbs(rawInput) {
	const input = rawInput && typeof rawInput === "object" ? rawInput : {};
	const alongXClimb = Math.abs(toFiniteNumber(input.alongXClimb, 0));
	const alongYClimb = Math.abs(toFiniteNumber(input.alongYClimb, 0));

	return smoothstepBetween(-FRAME_TIE_BAND_CLIMB, FRAME_TIE_BAND_CLIMB, alongYClimb - alongXClimb);
}


export function frameShareIsWorthMeasuring(share) {
	return toFiniteNumber(share, 0) > FRAME_MIN_SHARE;
}


export function blendFrameDistanceTexels(rawInput) {
	const input = rawInput && typeof rawInput === "object" ? rawInput : {};
	const alongXShare = Math.max(0, Math.min(1, toFiniteNumber(input.alongXShare, 1)));
	const alongXDistanceTexels = toFiniteNumber(input.alongXDistanceTexels, 0);
	const alongYDistanceTexels = toFiniteNumber(input.alongYDistanceTexels, 0);
	return alongYDistanceTexels + (alongXDistanceTexels - alongYDistanceTexels) * alongXShare;
}


export function buildShadowEdgeFrameBlendGlsl() {
	const tieBand = FRAME_TIE_BAND_CLIMB.toFixed(4);
	const secondLookFloor = FRAME_SECOND_LOOK_CLIMB_FLOOR.toFixed(4);
	const minShare = FRAME_MIN_SHARE.toFixed(6);
	return `
                                                                             
                                                                          
bool rswShadowEdgeSecondLookIsWorthTaking(float alongXClimb) {
  return abs(alongXClimb) >= ${secondLookFloor};
}
                                                                              
                                                                               
                                                                             
                                                                                
                                                                                
                                                                            
                                                                           
                                
float rswShadowEdgeAlongAxisXShare(float alongXClimb, float alongYClimb) {
  return smoothstep(-${tieBand}, ${tieBand}, abs(alongYClimb) - abs(alongXClimb));
}
                                                                                
                                                                             
                                    
bool rswShadowEdgeFrameWorthMeasuring(float share) {
  return share > ${minShare};
}
                                                                               
                                                                            
                                       
float rswShadowEdgeBlendFrameDistance(float alongXDistanceTexels, float alongYDistanceTexels, float alongXShare) {
  return mix(alongYDistanceTexels, alongXDistanceTexels, alongXShare);
}
`;
}
