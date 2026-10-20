import {
  DEFAULT_SCREEN_TRACE_SETTINGS,
  SCREEN_TRACE_STEP_BUDGET_BY_TIER,
  SCREEN_TRACE_UNIFORM_NAMES,
} from "./mlScreenTraceContract.js";


export const SCREEN_TRACE_GLSL_RESULT_CODES = Object.freeze({
  visible: 0,
  occluded: 1,
  unknown: 2,
});

export const FORBIDDEN_GLSL_TOKENS = Object.freeze(["dFdx", "dFdy", "fwidth"]);


export function screenTraceBindingsForLightingShader() {
  return {
    hierarchicalDepthSampler: SCREEN_TRACE_UNIFORM_NAMES.hierarchicalDepth,
    renderResolution: SCREEN_TRACE_UNIFORM_NAMES.renderResolution,
    stepCount: SCREEN_TRACE_UNIFORM_NAMES.stepCount,
    thickness: SCREEN_TRACE_UNIFORM_NAMES.thickness,
  };
}


export function screenTraceBindingsForPrivateProgram() {
  return {
    hierarchicalDepthSampler: "uHierarchicalDepth",
    renderResolution: "uRenderResolution",
    stepCount: "uStepCount",
    thickness: "uThickness",
  };
}

function resolveBindings(bindings) {
  return Object.assign(screenTraceBindingsForPrivateProgram(), bindings || {});
}

export function buildScreenTraceUniformDeclarations(bindings) {
  const names = resolveBindings(bindings);
  return [
    "// ML-F14 screen trace uniforms. Declared at file scope, never inside a",
    "// function: a declaration inside a chunk lands in whatever another phase",
    "// rewrote that chunk into.",
    "uniform sampler2D " + names.hierarchicalDepthSampler + ";",
    "uniform vec2 " + names.renderResolution + ";",
    "uniform int " + names.stepCount + ";",
    "uniform float " + names.thickness + ";",
  ].join("\n");
}





export function buildScreenTraceGlslFunctions(bindings, options) {
  const names = resolveBindings(bindings);
  const settings = DEFAULT_SCREEN_TRACE_SETTINGS;
  const stepCeiling = Math.max(
    1,
    Math.floor((options && options.stepCeiling) || SCREEN_TRACE_STEP_BUDGET_BY_TIER.forte),
  );

  return [
    "const int MGL_SCREEN_TRACE_VISIBLE = " + SCREEN_TRACE_GLSL_RESULT_CODES.visible + ";",
    "const int MGL_SCREEN_TRACE_OCCLUDED = " + SCREEN_TRACE_GLSL_RESULT_CODES.occluded + ";",
    "const int MGL_SCREEN_TRACE_UNKNOWN = " + SCREEN_TRACE_GLSL_RESULT_CODES.unknown + ";",
    "const int MGL_SCREEN_TRACE_STEP_CEILING = " + stepCeiling + ";",
    "const int MGL_SCREEN_TRACE_START_LEVEL = " + settings.startLevel + ";",
    "const int MGL_SCREEN_TRACE_MAXIMUM_LEVEL = " + settings.maximumLevel + ";",
    "const float MGL_SCREEN_TRACE_DEPTH_BIAS = " + settings.depthBiasInViewDepth.toFixed(6) + ";",
    "const float MGL_SCREEN_TRACE_START_OFFSET_TEXELS = " + settings.startOffsetInTexels.toFixed(6) + ";",
    "const float MGL_SCREEN_TRACE_BOUNDARY_EPSILON = 0.00001;",
    "const float MGL_SCREEN_TRACE_MINIMUM_SEGMENT = 0.001;",
    "",
    "struct MglScreenTraceOutcome {",
    "  int result;",
    "  int stepCount;",
    "};",
    "",
    "// Perspective correct: the RECIPROCAL of the view depth is what varies",
    "// linearly across the screen. Interpolating the depth itself makes the ray",
    "// sag behind the geometry in the middle of the segment.",
    "float mglViewDepthAtFraction(float startDepth, float endDepth, float fraction) {",
    "  float reciprocal = mix(1.0 / max(startDepth, 1e-6), 1.0 / max(endDepth, 1e-6), fraction);",
    "  return 1.0 / max(reciprocal, 1e-6);",
    "}",
    "",
    "float mglFractionToNextCellBoundary(vec2 position, vec2 delta, float cellSize) {",
    "  vec2 cellMinimum = floor(position / cellSize) * cellSize;",
    "  vec2 target = mix(cellMinimum, cellMinimum + cellSize, step(0.0, delta));",
    "  vec2 fraction = (target - position) / delta;",
    "  float fractionX = abs(delta.x) > 0.0 ? fraction.x : 1e20;",
    "  float fractionY = abs(delta.y) > 0.0 ? fraction.y : 1e20;",
    "  return min(fractionX, fractionY);",
    "}",
    "",
    "// rayStart and rayEnd are (texel x, texel y, view depth) at level 0.",
    "// rayLeavesScreen says the segment was CUT by the screen edge, so reaching",
    "// its end is not the same as reaching the light.",
    "MglScreenTraceOutcome mglTraceScreenSpaceRay(vec3 rayStart, vec3 rayEnd, bool rayLeavesScreen) {",
    "  MglScreenTraceOutcome outcome;",
    "  outcome.result = MGL_SCREEN_TRACE_UNKNOWN;",
    "  outcome.stepCount = 0;",
    "",
    "  vec2 delta = rayEnd.xy - rayStart.xy;",
    "  float segmentLength = length(delta);",
    "  if (segmentLength < MGL_SCREEN_TRACE_MINIMUM_SEGMENT) return outcome;",
    "",
    "  float travelled = min(0.5, MGL_SCREEN_TRACE_START_OFFSET_TEXELS / segmentLength);",
    "  int level = MGL_SCREEN_TRACE_START_LEVEL;",
    "  int budget = min(" + names.stepCount + ", MGL_SCREEN_TRACE_STEP_CEILING);",
    "",
    "  for (int stepIndex = 0; stepIndex != MGL_SCREEN_TRACE_STEP_CEILING; stepIndex++) {",
    "    if (stepIndex >= budget) break;",
    "    float cellSize = exp2(float(level));",
    "    vec2 position = rayStart.xy + delta * travelled;",
    "    vec2 cellIndex = floor(position / cellSize);",
    "    vec2 uv = (cellIndex + 0.5) * cellSize / " + names.renderResolution + ";",
    "    outcome.stepCount = stepIndex + 1;",
    "    // Outside the pyramid is outside the screen: unknown, never a miss.",
    "    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return outcome;",
    "    vec2 cell = textureLod(" + names.hierarchicalDepthSampler + ", uv, float(level)).rg;",
    "",
    "    float cellExit = min(1.0, travelled + mglFractionToNextCellBoundary(position, delta, cellSize));",
    "    float depthAtEntry = mglViewDepthAtFraction(rayStart.z, rayEnd.z, travelled);",
    "    float depthAtExit = mglViewDepthAtFraction(rayStart.z, rayEnd.z, cellExit);",
    "    float nearestRayDepth = min(depthAtEntry, depthAtExit) - MGL_SCREEN_TRACE_DEPTH_BIAS;",
    "    float deepestRayDepth = max(depthAtEntry, depthAtExit) - MGL_SCREEN_TRACE_DEPTH_BIAS;",
    "",
    "    if (deepestRayDepth <= cell.r) {",
    "      // Proven empty for the whole crossing: skip it and climb one level.",
    "      travelled = cellExit + MGL_SCREEN_TRACE_BOUNDARY_EPSILON;",
    "      if (travelled >= 1.0) {",
    "        outcome.result = rayLeavesScreen ? MGL_SCREEN_TRACE_UNKNOWN : MGL_SCREEN_TRACE_VISIBLE;",
    "        return outcome;",
    "      }",
    "      level = min(level + 1, MGL_SCREEN_TRACE_MAXIMUM_LEVEL);",
    "      continue;",
    "    }",
    "    if (level > 0) {",
    "      // A coarse cell cannot say WHERE: descend without advancing.",
    "      level = level - 1;",
    "      continue;",
    "    }",
    "    // Beyond the assumed thickness the depth buffer cannot tell a thin",
    "    // sheet from a wall, so the answer stays unknown.",
    "    if (nearestRayDepth >= cell.g + " + names.thickness + ") return outcome;",
    "    outcome.result = MGL_SCREEN_TRACE_OCCLUDED;",
    "    return outcome;",
    "  }",
    "  // Budget exhausted: the march stopped early, the light is not visible.",
    "  return outcome;",
    "}",
  ].join("\n");
}






export function buildScreenTraceLightingChunk() {
  const bindings = screenTraceBindingsForLightingShader();
  return [
    buildScreenTraceUniformDeclarations(bindings),
    "",
    buildScreenTraceGlslFunctions(bindings),
  ].join("\n");
}









export function buildScreenTraceProbeFragmentShader() {
  const bindings = screenTraceBindingsForPrivateProgram();
  return [
    "precision highp float;",
    "precision highp sampler2D;",
    "",
    buildScreenTraceUniformDeclarations(bindings),
    "uniform sampler2D uProbeRays;",
    "uniform int uProbeRayCount;",
    "",
    buildScreenTraceGlslFunctions(bindings),
    "",
    "void main() {",
    "  int rayIndex = int(gl_FragCoord.x);",
    "  if (rayIndex >= uProbeRayCount) discard;",
    "  vec4 startTexel = texelFetch(uProbeRays, ivec2(rayIndex * 2, 0), 0);",
    "  vec4 endTexel = texelFetch(uProbeRays, ivec2(rayIndex * 2 + 1, 0), 0);",
    "  MglScreenTraceOutcome outcome = mglTraceScreenSpaceRay(",
    "    startTexel.xyz, endTexel.xyz, startTexel.w > 0.5);",
    "  // Written as raw floats, not normalised: a readback must not have to",
    "  // undo a scale to learn which of the three states came back.",
    "  gl_FragColor = vec4(float(outcome.result), float(outcome.stepCount), 0.0, 1.0);",
    "}",
  ].join("\n");
}
