const LEGACY_VIEW_POSITION_ASSIGNMENT = "  vec3 P = rswViewPos(vUv, dRaw);";
const REUSED_DEPTH_VIEW_POSITION_ASSIGNMENT = "  vec3 P = rswViewPosFromDepth(vUv, dRaw);";

export function buildViewPositionFromDepthHelperGlsl(options) {
  const reuseUnpackedDepth = !!(options && options.reuseUnpackedDepth);
  if (!reuseUnpackedDepth) return [];
  return [
    "vec3 rswViewPosFromDepth(const in vec2 uv, const in float depthRaw) {",
    "  vec2 ndc = uv*2.0-1.0;",
    "  vec4 t = uInvProj*vec4(ndc,-1.0,1.0);",
    "  vec3 ray = t.xyz/t.w;",
    "  float vz = (uNear*uFar)/((uFar-uNear)*depthRaw - uFar);",
    "  return ray*(vz/ray.z);",
    "}",
  ];
}

export function buildViewPositionAssignmentGlsl(options) {
  const reuseUnpackedDepth = !!(options && options.reuseUnpackedDepth);
  return [
    reuseUnpackedDepth
      ? REUSED_DEPTH_VIEW_POSITION_ASSIGNMENT
      : LEGACY_VIEW_POSITION_ASSIGNMENT,
  ];
}
