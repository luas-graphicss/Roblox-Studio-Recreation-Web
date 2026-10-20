function toFiniteNumber(value, fallback) {
	if (value === null || value === "" || typeof value === "boolean") return fallback;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function clampToUnitRange(value) {
	return Math.min(1, Math.max(0, value));
}


export function cornerLightFromHalfPlanes(rawInput) {
	const input = rawInput && typeof rawInput === "object" ? rawInput : {};
	const firstEdgeLight = clampToUnitRange(toFiniteNumber(input.firstEdgeLight, 0));
	const secondEdgeLight = clampToUnitRange(toFiniteNumber(input.secondEdgeLight, 0));
	const pointSideIsLit = input.pointSideIsLit !== false;
	return pointSideIsLit
		? Math.max(firstEdgeLight, secondEdgeLight)
		: Math.min(firstEdgeLight, secondEdgeLight);
}


export function buildShadowEdgeCornerGlsl() {
	return `
                                                                               
                                                                              
                                                                              
                                                                             
                                                                              
                                                                            
                                                                            
float rswShadowEdgeCornerLight(bool pointSideIsLit, float firstEdgeLight, float secondEdgeLight) {
  return pointSideIsLit ? max(firstEdgeLight, secondEdgeLight) : min(firstEdgeLight, secondEdgeLight);
}
`;
}
