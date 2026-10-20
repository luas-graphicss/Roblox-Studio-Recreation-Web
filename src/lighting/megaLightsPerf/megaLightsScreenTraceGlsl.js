const LEGACY_SCREEN_TRACE_LOOP = [
  "  for (int s = 0; s < 16; s++) {",
  "    if (float(s) >= uSteps) break;",
  "    float ft = pow((float(s)+rnd0)/uSteps,1.35)*maxT;",
  "    vec3 sp = P+dir*max(ft,0.02);",
  "    vec4 q = uProj*vec4(sp,1.0);",
  "    vec2 suv = q.xy/q.w*0.5+0.5;",
  "    if (suv.x<=0.0||suv.x>=1.0||suv.y<=0.0||suv.y>=1.0) break;",
  "    float dz = -rswTraceViewZ(suv, depthGradient);",
  "    float dd = -sp.z-dz;",
  "    if (dd>uThickness*0.08&&dd<uThickness*4.0){blocked=1.0;break;}",
  "  }",
];

const HOISTED_SCREEN_TRACE_LOOP = [
  "  vec4 clipOrigin = uProj*vec4(P,1.0);",
  "  vec4 clipStep = uProj*vec4(dir,0.0);",
  "  for (int s = 0; s < 16; s++) {",
  "    if (float(s) >= uSteps) break;",
  "    float ft = pow((float(s)+rnd0)/uSteps,1.35)*maxT;",
  "    float traceT = max(ft,0.02);",
  "    vec4 q = clipOrigin + clipStep*traceT;",
  "    vec2 suv = q.xy/q.w*0.5+0.5;",
  "    if (suv.x<=0.0||suv.x>=1.0||suv.y<=0.0||suv.y>=1.0) break;",
  "    float dz = -rswTraceViewZ(suv, depthGradient);",
  "    float dd = -(P.z+dir.z*traceT)-dz;",
  "    if (dd>uThickness*0.08&&dd<uThickness*4.0){blocked=1.0;break;}",
  "  }",
];

export function buildScreenTraceLoopGlsl(options) {
  const hoistProjection = !!(options && options.hoistProjection);
  return (hoistProjection ? HOISTED_SCREEN_TRACE_LOOP : LEGACY_SCREEN_TRACE_LOOP).slice();
}
