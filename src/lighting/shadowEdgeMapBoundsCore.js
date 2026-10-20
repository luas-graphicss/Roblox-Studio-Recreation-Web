export function shadowMapTapIsInside(tapU, tapV) {
	return tapU > 0 && 1 > tapU && tapV > 0 && 1 > tapV;
}


export function buildShadowEdgeMapBoundsGlsl() {
	return `
                                                                               
                                                                             
                                                                 
bool rswShadowEdgeTapIsInsideMap(vec2 tapUv) {
  return tapUv.x > 0.0 && 1.0 > tapUv.x && tapUv.y > 0.0 && 1.0 > tapUv.y;
}
`;
}
