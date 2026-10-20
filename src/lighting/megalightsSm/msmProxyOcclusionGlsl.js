import {
  MSM_PROXY_BOX_CEILING,
  MSM_PROXY_INSIDE_BIAS_STUDS,
  MSM_PROXY_MINIMUM_DIRECTION_COMPONENT,
  MSM_PROXY_MINIMUM_SEGMENT_STUDS,
  MSM_PROXY_SURFACE_BIAS_STUDS,
} from "./msmProxyOcclusionCore.js";

export const MSM_PROXY_GLSL_OWNER = "MSM-F19";


export const MSM_PROXY_TEXTURE_UNIT_COST = 0;

export const MSM_PROXY_UNIFORM_NAMES = Object.freeze({
  BOX_CENTER: "uMsmProxyBoxCenter",
  BOX_HALF_EXTENT: "uMsmProxyBoxHalfExtent",
});

export const MSM_PROXY_FUNCTION_NAMES = Object.freeze({
  SAFE_RECIPROCAL: "msmProxySafeReciprocal",
  POINT_IS_OUTSIDE_BOX: "msmProxyPointIsOutsideBox",
  SLOT_OCCLUSION: "msmProxySlotOcclusion",
  VISIBILITY: "msmProxyVisibility",
});

export const MSM_PROXY_GLSL_CONSTANT_NAMES = Object.freeze({
  SURFACE_BIAS: "MSM_PROXY_SURFACE_BIAS",
  INSIDE_BIAS: "MSM_PROXY_INSIDE_BIAS",
  MINIMUM_SEGMENT: "MSM_PROXY_MINIMUM_SEGMENT",
  MINIMUM_DIRECTION: "MSM_PROXY_MINIMUM_DIRECTION",
});


function toGlslFloat(value) {
  if (!Number.isFinite(value)) {
    throw new Error(`msmProxyOcclusionGlsl: ${value} is not a finite float`);
  }
  if (Number.isInteger(value)) return `${value}.0`;
  const fixed = value.toFixed(10).replace(/0+$/, "");
  const text = fixed.endsWith(".") ? `${fixed}0` : fixed;
  if (Number(text) === 0) {
    throw new Error(`msmProxyOcclusionGlsl: ${value} does not survive 10 decimals`);
  }
  return text;
}


export function msmProxyUniformSpecs() {
  return [
    {
      name: MSM_PROXY_UNIFORM_NAMES.BOX_CENTER,
      glslType: "vec4",
      arrayLength: MSM_PROXY_BOX_CEILING,
      packing: "xyz = world centre in studs, w = occlusion strength 0..1 (0 = empty slot)",
    },
    {
      name: MSM_PROXY_UNIFORM_NAMES.BOX_HALF_EXTENT,
      glslType: "vec3",
      arrayLength: MSM_PROXY_BOX_CEILING,
      packing: "xyz = world half extents in studs",
    },
  ];
}

function buildUniformBlock() {
  return [
    "// MSM-F19 proxy occlusion: uniforms only, ZERO new texture units.",
    "// The array length is FIXED and literal: three breaks on an empty uniform",
    "// array (golden rule 7), and a literal length is also what lets the loop",
    "// below index the array with a constant index expression in GLSL ES 1.0.",
    "// The strength rides in the w of the centre to save one uniform register",
    "// per slot on the weak GPU, and 0 there means an empty slot.",
    `uniform vec4 ${MSM_PROXY_UNIFORM_NAMES.BOX_CENTER}[${MSM_PROXY_BOX_CEILING}];`,
    `uniform vec3 ${MSM_PROXY_UNIFORM_NAMES.BOX_HALF_EXTENT}[${MSM_PROXY_BOX_CEILING}];`,
  ].join("\n");
}

function buildConstantBlock() {
  return [
    `const float ${MSM_PROXY_GLSL_CONSTANT_NAMES.SURFACE_BIAS} = ${toGlslFloat(MSM_PROXY_SURFACE_BIAS_STUDS)};`,
    `const float ${MSM_PROXY_GLSL_CONSTANT_NAMES.INSIDE_BIAS} = ${toGlslFloat(MSM_PROXY_INSIDE_BIAS_STUDS)};`,
    `const float ${MSM_PROXY_GLSL_CONSTANT_NAMES.MINIMUM_SEGMENT} = ${toGlslFloat(MSM_PROXY_MINIMUM_SEGMENT_STUDS)};`,
    `const float ${MSM_PROXY_GLSL_CONSTANT_NAMES.MINIMUM_DIRECTION} = ${toGlslFloat(MSM_PROXY_MINIMUM_DIRECTION_COMPONENT)};`,
  ].join("\n");
}

function buildSafeReciprocalFunction() {
  return [
    "// Reciprocal that never divides by zero and never returns Inf, so no term",
    "// of the slab test can ever turn into a NaN. One NaN pixel poisons the",
    "// temporal history for many frames.",
    `float ${MSM_PROXY_FUNCTION_NAMES.SAFE_RECIPROCAL}(float directionComponent) {`,
    "  float directionSign = step(0.0, directionComponent) * 2.0 - 1.0;",
    `  float safeMagnitude = max(abs(directionComponent), ${MSM_PROXY_GLSL_CONSTANT_NAMES.MINIMUM_DIRECTION});`,
    "  return 1.0 / (directionSign * safeMagnitude);",
    "}",
  ].join("\n");
}

function buildPointIsOutsideBoxFunction() {
  return [
    "// 1.0 when the point is outside the inflated box, 0.0 when it is inside.",
    "// A shaded point standing on its own occluder must not shadow itself.",
    `float ${MSM_PROXY_FUNCTION_NAMES.POINT_IS_OUTSIDE_BOX}(vec3 point, vec3 boxCenter, vec3 boxHalfExtent) {`,
    `  vec3 insideAxis = step(abs(point - boxCenter), boxHalfExtent + vec3(${MSM_PROXY_GLSL_CONSTANT_NAMES.INSIDE_BIAS}));`,
    "  return 1.0 - insideAxis.x * insideAxis.y * insideAxis.z;",
    "}",
  ].join("\n");
}

function buildSlotOcclusionFunction() {
  return [
    "// Occlusion of ONE slot: 0.0 when it does not block, its strength when it",
    "// does. Branchless on purpose - every guard is a multiply by 0.0 or 1.0, so",
    "// the instruction count does not depend on the answer.",
    `float ${MSM_PROXY_FUNCTION_NAMES.SLOT_OCCLUSION}(vec3 boxCenter, vec3 boxHalfExtent, float boxStrength, vec3 segmentOrigin, vec3 segmentTarget, vec3 segmentDirection, float segmentLength) {`,
    "  vec3 reciprocalDirection = vec3(",
    `    ${MSM_PROXY_FUNCTION_NAMES.SAFE_RECIPROCAL}(segmentDirection.x),`,
    `    ${MSM_PROXY_FUNCTION_NAMES.SAFE_RECIPROCAL}(segmentDirection.y),`,
    `    ${MSM_PROXY_FUNCTION_NAMES.SAFE_RECIPROCAL}(segmentDirection.z)`,
    "  );",
    "  vec3 firstPlane = (boxCenter - boxHalfExtent - segmentOrigin) * reciprocalDirection;",
    "  vec3 secondPlane = (boxCenter + boxHalfExtent - segmentOrigin) * reciprocalDirection;",
    "  vec3 nearPlane = min(firstPlane, secondPlane);",
    "  vec3 farPlane = max(firstPlane, secondPlane);",
    "  float nearestHit = max(max(nearPlane.x, nearPlane.y), nearPlane.z);",
    "  float farthestHit = min(min(farPlane.x, farPlane.y), farPlane.z);",
    "  float intervalExists = step(nearestHit, farthestHit);",
    `  float endsAfterTheSurface = step(${MSM_PROXY_GLSL_CONSTANT_NAMES.SURFACE_BIAS}, farthestHit);`,
    `  float startsBeforeTheLight = step(nearestHit, segmentLength - ${MSM_PROXY_GLSL_CONSTANT_NAMES.SURFACE_BIAS});`,
    `  float surfaceIsOutside = ${MSM_PROXY_FUNCTION_NAMES.POINT_IS_OUTSIDE_BOX}(segmentOrigin, boxCenter, boxHalfExtent);`,
    `  float lightIsOutside = ${MSM_PROXY_FUNCTION_NAMES.POINT_IS_OUTSIDE_BOX}(segmentTarget, boxCenter, boxHalfExtent);`,
    "  return boxStrength * intervalExists * endsAfterTheSurface * startsBeforeTheLight * surfaceIsOutside * lightIsOutside;",
    "}",
  ].join("\n");
}

function buildVisibilityFunction() {
  return [
    "// Visibility of the light seen from the shaded point, both in WORLD space.",
    "// The bound of the loop is a LITERAL: constant cost per sample (gate G1) and",
    "// a constant index expression, which is what GLSL ES 1.0 demands to index a",
    "// uniform array. There is no break and no early return inside it on purpose:",
    "// an empty slot costs the same as a full one and carries strength 0.",
    `float ${MSM_PROXY_FUNCTION_NAMES.VISIBILITY}(vec3 surfaceWorldPosition, vec3 lightWorldPosition) {`,
    "  vec3 segment = lightWorldPosition - surfaceWorldPosition;",
    "  float segmentLength = length(segment);",
    `  float segmentIsReal = step(${MSM_PROXY_GLSL_CONSTANT_NAMES.MINIMUM_SEGMENT}, segmentLength);`,
    `  vec3 segmentDirection = segment / max(segmentLength, ${MSM_PROXY_GLSL_CONSTANT_NAMES.MINIMUM_SEGMENT});`,
    "  float transmittance = 1.0;",
    `  for (int boxIndex = 0; boxIndex < ${MSM_PROXY_BOX_CEILING}; boxIndex++) {`,
    `    vec4 centerAndStrength = ${MSM_PROXY_UNIFORM_NAMES.BOX_CENTER}[boxIndex];`,
    `    float slotOcclusion = ${MSM_PROXY_FUNCTION_NAMES.SLOT_OCCLUSION}(`,
    "      centerAndStrength.xyz,",
    `      ${MSM_PROXY_UNIFORM_NAMES.BOX_HALF_EXTENT}[boxIndex],`,
    "      centerAndStrength.w,",
    "      surfaceWorldPosition,",
    "      lightWorldPosition,",
    "      segmentDirection,",
    "      segmentLength",
    "    );",
    "    transmittance *= 1.0 - clamp(slotOcclusion * segmentIsReal, 0.0, 1.0);",
    "  }",
    "  return clamp(transmittance, 0.0, 1.0);",
    "}",
  ].join("\n");
}


export function buildMsmProxyOcclusionGlsl(options = {}) {
  return [
    options.declareUniforms === false ? '' : buildUniformBlock(),
    buildConstantBlock(),
    buildSafeReciprocalFunction(),
    buildPointIsOutsideBoxFunction(),
    buildSlotOcclusionFunction(),
    buildVisibilityFunction(),
  ].join("\n\n");
}
