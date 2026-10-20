import {
  MAXIMUM_NODE_VISITS_PER_RAY,
  MAXIMUM_TRIANGLES_PER_LEAF,
  SLAB_PARALLEL_EPSILON,
  TRAVERSAL_STACK_SIZE,
  TRIANGLE_DETERMINANT_EPSILON,
  TRIANGLE_EDGE_EPSILON,
} from "./mlBvhTraversalCore.js";
import {
  BVH_TEXTURE_WIDTH,
  TEXELS_PER_NODE,
  TEXELS_PER_TRIANGLE,
} from "./mlBvhTextureLayoutCore.js";
import { traceResultIndex } from "./mlRayTraceCore.js";
import { MGL_TRACE_RESULT } from "./mlPipelineContract.js";

export const BVH_TRAVERSAL_GLSL_VERSION = "300 es";


export const BVH_TRAVERSAL_GLSL_RESULT_CODES = Object.freeze({
  visible: traceResultIndex(MGL_TRACE_RESULT.visible),
  occluded: traceResultIndex(MGL_TRACE_RESULT.occluded),
  unknown: traceResultIndex(MGL_TRACE_RESULT.unknown),
});


export const FORBIDDEN_GLSL_TOKENS = Object.freeze(["dFdx", "dFdy", "fwidth", "floatBitsToUint"]);

export const BVH_TRAVERSAL_FUNCTION_NAMES = Object.freeze([
  "mglBvhReadTexel",
  "mglBvhSlabOverlaps",
  "mglBvhRayHitsBounds",
  "mglBvhRayHitsTriangle",
  "mglTraceBvhOcclusion",
]);


export function bvhTraversalBindingsForLightingShader() {
  return {
    bvhNodesSampler: "uMglBvhNodes",
    bvhNodeCount: "uMglBvhNodeCount",
    raysPerPixel: "uMglRaysPerPixel",
  };
}


export function bvhTraversalBindingsForPrivateProgram() {
  return {
    bvhNodesSampler: "uBvhNodes",
    bvhNodeCount: "uBvhNodeCount",
    raysPerPixel: "uRaysPerPixel",
  };
}

function resolveBindings(bindings) {
  return Object.assign(bvhTraversalBindingsForPrivateProgram(), bindings || {});
}

function glslFloat(value) {


  const asText = Number(value).toExponential();
  return asText.indexOf("e") < 0 ? asText + ".0" : asText;
}

export function buildBvhTraversalUniformDeclarations(bindings) {
  const names = resolveBindings(bindings);
  return [
    "// ML-F16 BVH traversal uniforms. Declared at file scope, never inside a",
    "// function: a declaration inside a chunk lands in whatever another phase",
    "// rewrote that chunk into.",
    "uniform sampler2D " + names.bvhNodesSampler + ";",
    "uniform int " + names.bvhNodeCount + ";",
  ].join("\n");
}








export function buildBvhTraversalGlslFunctions(bindings, options) {
  const names = resolveBindings(bindings);
  const textureWidth = Math.max(1, Math.floor((options && options.textureWidth) || BVH_TEXTURE_WIDTH));

  return [
    "const int MGL_BVH_VISIBLE = " + BVH_TRAVERSAL_GLSL_RESULT_CODES.visible + ";",
    "const int MGL_BVH_OCCLUDED = " + BVH_TRAVERSAL_GLSL_RESULT_CODES.occluded + ";",
    "const int MGL_BVH_UNKNOWN = " + BVH_TRAVERSAL_GLSL_RESULT_CODES.unknown + ";",
    "const int MGL_BVH_TEXTURE_WIDTH = " + textureWidth + ";",
    "const int MGL_BVH_TEXELS_PER_NODE = " + TEXELS_PER_NODE + ";",
    "const int MGL_BVH_TEXELS_PER_TRIANGLE = " + TEXELS_PER_TRIANGLE + ";",
    "const int MGL_BVH_STACK_SIZE = " + TRAVERSAL_STACK_SIZE + ";",
    "const int MGL_BVH_MAX_NODE_VISITS = " + MAXIMUM_NODE_VISITS_PER_RAY + ";",
    "const int MGL_BVH_MAX_TRIANGLES_PER_LEAF = " + MAXIMUM_TRIANGLES_PER_LEAF + ";",
    "const float MGL_BVH_TRIANGLE_DETERMINANT_EPSILON = " + glslFloat(TRIANGLE_DETERMINANT_EPSILON) + ";",
    "const float MGL_BVH_TRIANGLE_EDGE_EPSILON = " + glslFloat(TRIANGLE_EDGE_EPSILON) + ";",
    "const float MGL_BVH_SLAB_PARALLEL_EPSILON = " + glslFloat(SLAB_PARALLEL_EPSILON) + ";",
    "",
    "struct MglBvhOutcome {",
    "  int result;",
    "  int nodeVisitCount;",
    "  int triangleTestCount;",
    "};",
    "",
    "// The same column/row arithmetic as texelColumnAndRow on the CPU, written",
    "// with integer division because GLSL ES has no bitwise operators to spare.",
    "vec4 mglBvhReadTexel(int texelIndex) {",
    "  int row = texelIndex / MGL_BVH_TEXTURE_WIDTH;",
    "  int column = texelIndex - row * MGL_BVH_TEXTURE_WIDTH;",
    "  return texelFetch(" + names.bvhNodesSampler + ", ivec2(column, row), 0);",
    "}",
    "",
    "// Branchy per axis on purpose, exactly like the core: the 1/direction form",
    "// produces 0 * infinity when the origin sits on the face of a slab.",
    "bool mglBvhSlabOverlaps(float origin, float direction, float boundsMinimum, float boundsMaximum, inout float nearDistance, inout float farDistance) {",
    "  if (abs(direction) < MGL_BVH_SLAB_PARALLEL_EPSILON) {",
    "    return origin >= boundsMinimum && origin <= boundsMaximum;",
    "  }",
    "  float inverseDirection = 1.0 / direction;",
    "  float entryDistance = (boundsMinimum - origin) * inverseDirection;",
    "  float exitDistance = (boundsMaximum - origin) * inverseDirection;",
    "  if (entryDistance > exitDistance) {",
    "    float swap = entryDistance;",
    "    entryDistance = exitDistance;",
    "    exitDistance = swap;",
    "  }",
    "  if (entryDistance > nearDistance) nearDistance = entryDistance;",
    "  if (exitDistance < farDistance) farDistance = exitDistance;",
    "  return nearDistance <= farDistance;",
    "}",
    "",
    "bool mglBvhRayHitsBounds(vec3 origin, vec3 direction, vec3 boundsMinimum, vec3 boundsMaximum, float minimumDistance, float maximumDistance) {",
    "  float nearDistance = minimumDistance;",
    "  float farDistance = maximumDistance;",
    "  if (!mglBvhSlabOverlaps(origin.x, direction.x, boundsMinimum.x, boundsMaximum.x, nearDistance, farDistance)) return false;",
    "  if (!mglBvhSlabOverlaps(origin.y, direction.y, boundsMinimum.y, boundsMaximum.y, nearDistance, farDistance)) return false;",
    "  if (!mglBvhSlabOverlaps(origin.z, direction.z, boundsMinimum.z, boundsMaximum.z, nearDistance, farDistance)) return false;",
    "  return true;",
    "}",
    "",
    "// Moller-Trumbore WITHOUT culling: a shadow does not depend on winding, so",
    "// any face occludes. Same epsilons and same exclusive range as the core.",
    "bool mglBvhRayHitsTriangle(vec3 origin, vec3 direction, vec3 firstVertex, vec3 secondVertex, vec3 thirdVertex, float minimumDistance, float maximumDistance) {",
    "  vec3 firstEdge = secondVertex - firstVertex;",
    "  vec3 secondEdge = thirdVertex - firstVertex;",
    "  vec3 perpendicular = cross(direction, secondEdge);",
    "  float determinant = dot(firstEdge, perpendicular);",
    "  if (determinant > -MGL_BVH_TRIANGLE_DETERMINANT_EPSILON && determinant < MGL_BVH_TRIANGLE_DETERMINANT_EPSILON) return false;",
    "  float inverseDeterminant = 1.0 / determinant;",
    "  vec3 originToVertex = origin - firstVertex;",
    "  float barycentricU = dot(originToVertex, perpendicular) * inverseDeterminant;",
    "  if (barycentricU < -MGL_BVH_TRIANGLE_EDGE_EPSILON || barycentricU > 1.0 + MGL_BVH_TRIANGLE_EDGE_EPSILON) return false;",
    "  vec3 originCrossFirstEdge = cross(originToVertex, firstEdge);",
    "  float barycentricV = dot(direction, originCrossFirstEdge) * inverseDeterminant;",
    "  if (barycentricV < -MGL_BVH_TRIANGLE_EDGE_EPSILON || barycentricU + barycentricV > 1.0 + MGL_BVH_TRIANGLE_EDGE_EPSILON) return false;",
    "  float hitDistance = dot(secondEdge, originCrossFirstEdge) * inverseDeterminant;",
    "  return hitDistance > minimumDistance && hitDistance < maximumDistance;",
    "}",
    "",
    "// NOTHING PROVED IS NOT VISIBLE: no tree, an empty range, a visit ceiling,",
    "// a fat leaf or a stack overflow all answer UNKNOWN and go back to the",
    "// policy of ML-F17. Answering visible without proof is how an off screen",
    "// occluder turns into a light leak.",
    "MglBvhOutcome mglTraceBvhOcclusion(vec3 origin, vec3 direction, float minimumDistance, float maximumDistance) {",
    "  MglBvhOutcome outcome;",
    "  outcome.result = MGL_BVH_UNKNOWN;",
    "  outcome.nodeVisitCount = 0;",
    "  outcome.triangleTestCount = 0;",
    "  if (" + names.bvhNodeCount + " <= 0) return outcome;",
    "  if (maximumDistance <= minimumDistance) return outcome;",
    "",
    "  int triangleRegionBaseTexel = " + names.bvhNodeCount + " * MGL_BVH_TEXELS_PER_NODE;",
    "  int traversalStack[MGL_BVH_STACK_SIZE];",
    "  traversalStack[0] = 0;",
    "  int stackPointer = 1;",
    "",
    "  for (int visitIndex = 0; visitIndex != MGL_BVH_MAX_NODE_VISITS; visitIndex++) {",
    "    if (stackPointer <= 0) {",
    "      outcome.result = MGL_BVH_VISIBLE;",
    "      return outcome;",
    "    }",
    "    stackPointer = stackPointer - 1;",
    "    int nodeIndex = traversalStack[stackPointer];",
    "    outcome.nodeVisitCount = outcome.nodeVisitCount + 1;",
    "",
    "    int nodeTexelIndex = nodeIndex * MGL_BVH_TEXELS_PER_NODE;",
    "    vec4 minimumTexel = mglBvhReadTexel(nodeTexelIndex);",
    "    vec4 maximumTexel = mglBvhReadTexel(nodeTexelIndex + 1);",
    "    if (!mglBvhRayHitsBounds(origin, direction, minimumTexel.xyz, maximumTexel.xyz, minimumDistance, maximumDistance)) continue;",
    "",
    "    float firstOrRightChild = minimumTexel.w;",
    "    float leafTriangleCount = maximumTexel.w;",
    "    if (leafTriangleCount > 0.5) {",
    "      // A leaf fatter than the loop can test would be HALF tested, which",
    "      // reads as visible. Refuse the ray instead.",
    "      if (leafTriangleCount > float(MGL_BVH_MAX_TRIANGLES_PER_LEAF)) return outcome;",
    "      for (int localTriangle = 0; localTriangle != MGL_BVH_MAX_TRIANGLES_PER_LEAF; localTriangle++) {",
    "        if (float(localTriangle) >= leafTriangleCount) break;",
    "        int vertexBaseTexel = triangleRegionBaseTexel + (int(firstOrRightChild) + localTriangle) * MGL_BVH_TEXELS_PER_TRIANGLE;",
    "        vec3 firstVertex = mglBvhReadTexel(vertexBaseTexel).xyz;",
    "        vec3 secondVertex = mglBvhReadTexel(vertexBaseTexel + 1).xyz;",
    "        vec3 thirdVertex = mglBvhReadTexel(vertexBaseTexel + 2).xyz;",
    "        outcome.triangleTestCount = outcome.triangleTestCount + 1;",
    "        if (mglBvhRayHitsTriangle(origin, direction, firstVertex, secondVertex, thirdVertex, minimumDistance, maximumDistance)) {",
    "          outcome.result = MGL_BVH_OCCLUDED;",
    "          return outcome;",
    "        }",
    "      }",
    "      continue;",
    "    }",
    "",
    "    if (stackPointer + 2 > MGL_BVH_STACK_SIZE) return outcome;",
    "    traversalStack[stackPointer] = nodeIndex + 1;",
    "    traversalStack[stackPointer + 1] = int(firstOrRightChild);",
    "    stackPointer = stackPointer + 2;",
    "  }",
    "  return outcome;",
    "}",
  ].join("\n");
}










export function buildBvhTraversalProbeFragmentShader() {
  const bindings = bvhTraversalBindingsForPrivateProgram();
  return [
    "#version " + BVH_TRAVERSAL_GLSL_VERSION,
    "precision highp float;",
    "precision highp int;",
    "precision highp sampler2D;",
    "",
    buildBvhTraversalUniformDeclarations(bindings),
    "uniform sampler2D uProbeRays;",
    "uniform int uProbeRayCount;",
    "out vec4 mglProbeResult;",
    "",
    buildBvhTraversalGlslFunctions(bindings),
    "",
    "void main() {",
    "  int rayIndex = int(gl_FragCoord.x);",
    "  if (rayIndex >= uProbeRayCount) discard;",
    "  vec4 originTexel = texelFetch(uProbeRays, ivec2(rayIndex * 2, 0), 0);",
    "  vec4 directionTexel = texelFetch(uProbeRays, ivec2(rayIndex * 2 + 1, 0), 0);",
    "  MglBvhOutcome outcome = mglTraceBvhOcclusion(",
    "    originTexel.xyz, directionTexel.xyz, originTexel.w, directionTexel.w);",
    "  // Raw floats, not normalised: a readback must not undo a scale to learn",
    "  // which of the three states came back.",
    "  mglProbeResult = vec4(float(outcome.result), float(outcome.nodeVisitCount), float(outcome.triangleTestCount), 1.0);",
    "}",
  ].join("\n");
}





export function bvhTraversalLightingInjectionRefusal() {
  return Object.freeze({
    code: "rayTrace.noLightingChunkInGlslEs100",
    refuses: "injecting the BVH walk into the shared lighting chunk of the bench",
    because:
      "the traversal indexes a stack with a variable, which GLSL ES 1.00 forbids in a fragment shader, " +
      "and it has no bitwise operators for a bit trail; the walk belongs to an ES 3.00 offscreen program " +
      "that writes uMglSampleVisibility (ML-F17)",
    reservedPatchOrderStaysClaimed: true,
  });
}

export function describeBvhTraversalGlsl() {
  return {
    requiredGlslVersion: BVH_TRAVERSAL_GLSL_VERSION,
    functionNames: BVH_TRAVERSAL_FUNCTION_NAMES,
    resultCodes: BVH_TRAVERSAL_GLSL_RESULT_CODES,
    bakedTextureWidth: BVH_TEXTURE_WIDTH,
    usesScreenDerivatives: false,
    injectableIntoLightingChunk: false,
    lightingInjectionRefusal: bvhTraversalLightingInjectionRefusal(),
    uniformNames: [
      bvhTraversalBindingsForLightingShader().bvhNodesSampler,
      bvhTraversalBindingsForLightingShader().bvhNodeCount,
    ],
  };
}
