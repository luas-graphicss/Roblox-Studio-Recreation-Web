import {
  MSM_COARSE_MIP_LEVEL,
  MSM_FALLBACK_MINIMUM_LUMINANCE,
  MSM_FIREFLY_FRAME_LUMINANCE_RATIO,
  MSM_LUMINANCE_WEIGHTS,
} from "./msmHistoryFallbackCore.js";

export const MSM_HISTORY_FALLBACK_GLSL_OWNER = "MSM-F29";


export const MSM_HISTORY_FALLBACK_TEXTURE_UNIT_COST = 0;


export const MSM_HISTORY_FALLBACK_NEW_VRAM_BYTES = 0;


export const MSM_COARSE_MIP_BIAS = MSM_COARSE_MIP_LEVEL;

export const MSM_HISTORY_FALLBACK_FUNCTION_NAMES = Object.freeze({
  LUMINANCE: "msmFallbackLuminance",
  CEILING_LUMINANCE: "msmFireflyCeilingLuminance",
  TARGET_LUMINANCE: "msmFallbackTargetLuminance",
  SCALE: "msmFallbackScale",
  SCALE_COLOR: "msmScaleColorToLuminance",
  COARSE_PRIOR: "msmHistoryCoarsePrior",
  PRIOR_COLOR: "msmFallbackPriorColor",
  CLAMPED_SAMPLE: "msmFireflyClampedSample",
  SUBSTITUTE: "msmHistorySubstitute",
  RESOLVED_HISTORY: "msmResolvedHistory",
});

export const MSM_HISTORY_FALLBACK_GLSL_CONSTANT_NAMES = Object.freeze({
  LUMINANCE_WEIGHTS: "MSM_FALLBACK_LUMINANCE_WEIGHTS",
  FIREFLY_FRAME_RATIO: "MSM_FIREFLY_FRAME_LUMINANCE_RATIO",
  MINIMUM_LUMINANCE: "MSM_FALLBACK_MINIMUM_LUMINANCE",
  COARSE_MIP_BIAS: "MSM_COARSE_MIP_BIAS",
});


export const MSM_HISTORY_FALLBACK_GLSL_ONLY_FUNCTIONS = Object.freeze([
  MSM_HISTORY_FALLBACK_FUNCTION_NAMES.COARSE_PRIOR,
]);


export const MSM_HISTORY_MIP_CONTRACT = Object.freeze({
  ownerPhase: "MSM-F26",
  bufferId: "msmIrradianceHistory",
  mipLevel: MSM_COARSE_MIP_LEVEL,
  requirements: Object.freeze([
    "draw the reduced resolution target 1 to 1, so the computed level of detail is 0 and the bias selects the level exactly",
    "refresh mip 1 of the history AFTER the temporal write, and only on frames that actually wrote - an idle frame writes nothing and gate G8 keeps costing 0 ms",
    "bind the history with a mipmap minification filter; without it the driver clamps the fetch back to level 0 and the prior stops being spatial",
    "read the prior from the history of the PREVIOUS frame, never from the target being written in this pass",
  ]),
  degradedFallback:
    "if the driver refuses linear filtering on the float format, the RGBA8 with scale path of section 5.1 provides the filterable mip; the prior becomes blockier and stays plausible",
});


export const MSM_REFUSED_MIP_FETCH_MODES = Object.freeze([
  Object.freeze({
    id: "texture2DLodEXT",
    whyRefused:
      "it needs the extension EXT_shader_texture_lod, which a weak WebGL1 driver is not guaranteed to expose; a chunk that fails to compile is worse than a coarse prior",
  }),
  Object.freeze({
    id: "separate-half-resolution-buffer",
    whyRefused:
      "a dedicated prior buffer would cost one more texture unit and new VRAM; mip 1 of the history is already declared and already paid for in section 5.1",
  }),
  Object.freeze({
    id: "gather-8-neighbours-here",
    whyRefused:
      "the temporal clamp of MSM-F26 already reads the 3x3 envelope; gathering it again would spend 8 taps to learn what one argument can carry",
  }),
]);


function toGlslFloat(value) {
  if (!Number.isFinite(value)) {
    throw new Error(`msmHistoryFallbackGlsl: ${value} is not a finite float`);
  }
  if (Number.isInteger(value)) return `${value}.0`;
  const fixed = value.toFixed(10).replace(/0+$/, "");
  const text = fixed.endsWith(".") ? `${fixed}0` : fixed;
  if (Number(text) === 0) {
    throw new Error(`msmHistoryFallbackGlsl: ${value} does not survive 10 decimals`);
  }
  return text;
}


export function msmHistoryFallbackUniformSpecs() {
  return [];
}

function buildConstantBlock() {
  const names = MSM_HISTORY_FALLBACK_GLSL_CONSTANT_NAMES;
  const weights = MSM_LUMINANCE_WEIGHTS.map(toGlslFloat).join(", ");
  return [
    "// MSM-F29 history fallback: constants only, ZERO globals and ZERO new",
    "// texture units. Every number here is imported from",
    "// msmHistoryFallbackCore.js, so the mirror cannot drift by a literal.",
    `const vec3 ${names.LUMINANCE_WEIGHTS} = vec3(${weights});`,
    `const float ${names.FIREFLY_FRAME_RATIO} = ${toGlslFloat(MSM_FIREFLY_FRAME_LUMINANCE_RATIO)};`,
    `const float ${names.MINIMUM_LUMINANCE} = ${toGlslFloat(MSM_FALLBACK_MINIMUM_LUMINANCE)};`,
    `const float ${names.COARSE_MIP_BIAS} = ${toGlslFloat(MSM_COARSE_MIP_BIAS)};`,
  ].join("\n");
}

function buildLuminanceFunction() {
  const names = MSM_HISTORY_FALLBACK_FUNCTION_NAMES;
  return [
    "// Rec.709 luminance. The max() is not decoration: a negative channel would",
    "// make the scale below negative and paint an inverted pixel.",
    `float ${names.LUMINANCE}(vec3 color) {`,
    `  return dot(max(color, vec3(0.0)), ${MSM_HISTORY_FALLBACK_GLSL_CONSTANT_NAMES.LUMINANCE_WEIGHTS});`,
    "}",
  ].join("\n");
}

function buildCeilingLuminanceFunction() {
  const names = MSM_HISTORY_FALLBACK_FUNCTION_NAMES;
  return [
    "// Ceiling of gate G7: the envelope of the neighbours plus the tolerance of",
    "// the frame. With frameLuminance 0 the ceiling IS the envelope, which is the",
    "// strictest reading - a missing input never opens a hole.",
    `float ${names.CEILING_LUMINANCE}(float neighborhoodMaxLuminance, float frameLuminance) {`,
    `  return neighborhoodMaxLuminance + ${MSM_HISTORY_FALLBACK_GLSL_CONSTANT_NAMES.FIREFLY_FRAME_RATIO} * max(frameLuminance, 0.0);`,
    "}",
  ].join("\n");
}

function buildTargetLuminanceFunction() {
  const names = MSM_HISTORY_FALLBACK_FUNCTION_NAMES;
  return [
    "// The luminance the colour is allowed to keep. min(max()) instead of clamp()",
    "// because clamp() with a minimum above the maximum is undefined in GLSL, and",
    "// a dark neighbourhood with a bright firefly can produce exactly that.",
    `float ${names.TARGET_LUMINANCE}(float luminance, float minimumLuminance, float maximumLuminance) {`,
    "  return min(max(luminance, minimumLuminance), maximumLuminance);",
    "}",
  ].join("\n");
}

function buildScaleFunction() {
  const names = MSM_HISTORY_FALLBACK_FUNCTION_NAMES;
  return [
    "// Scale that never divides by zero and never returns Inf, so no clamped",
    "// pixel can turn into a NaN that would poison the history for many frames.",
    `float ${names.SCALE}(float luminance, float targetLuminance) {`,
    `  return targetLuminance / max(luminance, ${MSM_HISTORY_FALLBACK_GLSL_CONSTANT_NAMES.MINIMUM_LUMINANCE});`,
    "}",
  ].join("\n");
}

function buildScaleColorFunction() {
  const names = MSM_HISTORY_FALLBACK_FUNCTION_NAMES;
  return [
    "// ONE factor for the three channels: the chromaticity of the pixel survives",
    "// and only the energy it carries changes. Clipping each channel on its own",
    "// would drag the hue towards the colour of the envelope.",
    `vec3 ${names.SCALE_COLOR}(vec3 color, float minimumLuminance, float maximumLuminance) {`,
    "  vec3 positiveColor = max(color, vec3(0.0));",
    `  float luminance = ${names.LUMINANCE}(positiveColor);`,
    `  float targetLuminance = ${names.TARGET_LUMINANCE}(luminance, minimumLuminance, maximumLuminance);`,
    `  return positiveColor * ${names.SCALE}(luminance, targetLuminance);`,
    "}",
  ].join("\n");
}

function buildCoarsePriorFunction() {
  const names = MSM_HISTORY_FALLBACK_FUNCTION_NAMES;
  return [
    "// The ONLY fetch of this phase: mip 1 of the history that the temporal pass",
    "// already has bound. The sampler is a PARAMETER, so this chunk names nothing",
    "// global and MSM-F26 keeps the freedom to name its own texture.",
    "// The third argument of texture2D is the BIAS and it is legal in a fragment",
    "// shader in GLSL ES 1.00 - texture2DLod is not, without an extension.",
    `vec3 ${names.COARSE_PRIOR}(sampler2D historyTexture, vec2 historyUv) {`,
    `  return texture2D(historyTexture, historyUv, ${MSM_HISTORY_FALLBACK_GLSL_CONSTANT_NAMES.COARSE_MIP_BIAS}).rgb;`,
    "}",
  ].join("\n");
}

function buildPriorColorFunction() {
  const names = MSM_HISTORY_FALLBACK_FUNCTION_NAMES;
  return [
    "// The prior: the coarse mip when it can be trusted, the midpoint of the 3x3",
    "// envelope of THIS frame when it cannot. At boot there is no history at all",
    "// and the midpoint is the only measured energy that exists, which is why the",
    "// fallback still has an answer on the very first frame.",
    `vec3 ${names.PRIOR_COLOR}(vec3 coarsePrior, float coarsePriorConfidence, vec3 neighborhoodMin, vec3 neighborhoodMax) {`,
    "  vec3 neighborhoodMid = (max(neighborhoodMin, vec3(0.0)) + max(neighborhoodMax, vec3(0.0))) * 0.5;",
    "  return mix(neighborhoodMid, max(coarsePrior, vec3(0.0)), clamp(coarsePriorConfidence, 0.0, 1.0));",
    "}",
  ].join("\n");
}

function buildClampedSampleFunction() {
  const names = MSM_HISTORY_FALLBACK_FUNCTION_NAMES;
  return [
    "// Anti-firefly clamp of the raw sample of the frame. The floor is 0.0 on",
    "// purpose: a dark sample is legitimate information, only the explosion is not.",
    `vec3 ${names.CLAMPED_SAMPLE}(vec3 currentSample, vec3 neighborhoodMax, float frameLuminance) {`,
    `  float ceilingLuminance = ${names.CEILING_LUMINANCE}(${names.LUMINANCE}(neighborhoodMax), frameLuminance);`,
    `  return ${names.SCALE_COLOR}(currentSample, 0.0, ceilingLuminance);`,
    "}",
  ].join("\n");
}

function buildSubstituteFunction() {
  const names = MSM_HISTORY_FALLBACK_FUNCTION_NAMES;
  return [
    "// The colour that STANDS IN for the missing history: the prior brought into",
    "// the window of the neighbours. Never above the ceiling of gate G7 and never",
    "// below the darkest neighbour - the two halves of neither black nor blown out.",
    `vec3 ${names.SUBSTITUTE}(vec3 coarsePrior, float coarsePriorConfidence, vec3 neighborhoodMin, vec3 neighborhoodMax, float frameLuminance) {`,
    `  vec3 priorColor = ${names.PRIOR_COLOR}(coarsePrior, coarsePriorConfidence, neighborhoodMin, neighborhoodMax);`,
    `  float floorLuminance = ${names.LUMINANCE}(neighborhoodMin);`,
    `  float ceilingLuminance = ${names.CEILING_LUMINANCE}(${names.LUMINANCE}(neighborhoodMax), frameLuminance);`,
    `  return ${names.SCALE_COLOR}(priorColor, floorLuminance, ceilingLuminance);`,
    "}",
  ].join("\n");
}

function buildResolvedHistoryFunction() {
  const names = MSM_HISTORY_FALLBACK_FUNCTION_NAMES;
  return [
    "// The history the temporal pass should blend with this frame: the real one",
    "// where it can be trusted, the substitute where it cannot, and a continuous",
    "// mix in between - a partially rejected pixel must not pop. Straight line",
    "// code with no branch: the cost of a disoccluded pixel equals the cost of a",
    "// pixel that kept its past (gate G1).",
    `vec3 ${names.RESOLVED_HISTORY}(vec3 historyColor, float historyConfidence, vec3 coarsePrior, float coarsePriorConfidence, vec3 neighborhoodMin, vec3 neighborhoodMax, float frameLuminance) {`,
    `  vec3 substituteColor = ${names.SUBSTITUTE}(coarsePrior, coarsePriorConfidence, neighborhoodMin, neighborhoodMax, frameLuminance);`,
    "  return mix(substituteColor, max(historyColor, vec3(0.0)), clamp(historyConfidence, 0.0, 1.0));",
    "}",
  ].join("\n");
}


export function buildMsmHistoryFallbackGlsl() {
  return [
    buildConstantBlock(),
    buildLuminanceFunction(),
    buildCeilingLuminanceFunction(),
    buildTargetLuminanceFunction(),
    buildScaleFunction(),
    buildScaleColorFunction(),
    buildCoarsePriorFunction(),
    buildPriorColorFunction(),
    buildClampedSampleFunction(),
    buildSubstituteFunction(),
    buildResolvedHistoryFunction(),
  ].join("\n\n");
}
