export const CONTOUR_BLEND_PLAIN_TRUST = 0;
export const CONTOUR_BLEND_STRAIGHTENED_TRUST = 1;


function toFiniteNumber(value, fallback) {
	if (value === null || value === "" || typeof value === "boolean") return fallback;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function clampToTrustRange(value) {
	return Math.min(
		CONTOUR_BLEND_STRAIGHTENED_TRUST,
		Math.max(CONTOUR_BLEND_PLAIN_TRUST, value),
	);
}


export function blendedContourDistanceTexels(rawInput) {
	const input = rawInput && typeof rawInput === "object" ? rawInput : {};
	const plainDistanceTexels = toFiniteNumber(input.plainDistanceTexels, 0);
	const straightenedDistanceTexels = toFiniteNumber(
		input.straightenedDistanceTexels,
		plainDistanceTexels,
	);
	const straightenerTrust = clampToTrustRange(toFiniteNumber(input.straightenerTrust, 0));
	return (
		plainDistanceTexels + (straightenedDistanceTexels - plainDistanceTexels) * straightenerTrust
	);
}


export function buildShadowEdgeContourBlendGlsl() {
	const plainTrust = CONTOUR_BLEND_PLAIN_TRUST.toFixed(1);
	const straightenedTrust = CONTOUR_BLEND_STRAIGHTENED_TRUST.toFixed(1);
	return `
                                                                            
                                                                             
                                        
  
                                                                              
                                                                                
                                                                              
                                                                             
                                                                          
float rswShadowEdgeBlendContour(float plainDistanceTexels, float straightenedDistanceTexels, float straightenerTrust) {
  return mix(plainDistanceTexels, straightenedDistanceTexels, clamp(straightenerTrust, ${plainTrust}, ${straightenedTrust}));
}
`;
}
