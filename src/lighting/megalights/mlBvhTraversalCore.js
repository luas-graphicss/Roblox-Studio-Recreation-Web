import { MGL_TRACE_RESULT } from "./mlPipelineContract.js";
import {
  nodeMaximumTexelIndex,
  nodeMinimumTexelIndex,
  readTexel,
  triangleVertexTexelIndex,
} from "./mlBvhTextureLayoutCore.js";


export const TRIANGLE_DETERMINANT_EPSILON = 1e-7;
export const TRIANGLE_EDGE_EPSILON = 1e-7;
export const SLAB_PARALLEL_EPSILON = 1e-12;
export const TRAVERSAL_STACK_SIZE = 64;


export const MAXIMUM_NODE_VISITS_PER_RAY = 256;


export const MAXIMUM_TRIANGLES_PER_LEAF = 16;

export const ENGINE_TRAVERSAL_REFERENCE = Object.freeze({
  project: "engine web",
  file: "src/lighting/bvhCore.js",
  functions: Object.freeze(["anyHit", "rayAabb", "rayTri", "packBvhForGpu"]),
  packedLayout: "rsw-bvh-gpu-1",
  reusedBy: "ML-F16 must not build a BVH: PONTE-ENGINE.md forbids a second one",
});


const slabRange = { near: 0, far: 0 };
const traversalStack = new Int32Array(TRAVERSAL_STACK_SIZE);
const minimumTexel = [0, 0, 0, 0];
const maximumTexel = [0, 0, 0, 0];
const firstVertexTexel = [0, 0, 0, 0];
const secondVertexTexel = [0, 0, 0, 0];
const thirdVertexTexel = [0, 0, 0, 0];

function slabOverlaps(origin, direction, boundsMinimum, boundsMaximum) {


  if (Math.abs(direction) < SLAB_PARALLEL_EPSILON) {
    return origin >= boundsMinimum && origin <= boundsMaximum;
  }
  const inverseDirection = 1 / direction;
  let entryDistance = (boundsMinimum - origin) * inverseDirection;
  let exitDistance = (boundsMaximum - origin) * inverseDirection;
  if (entryDistance > exitDistance) {
    const swap = entryDistance;
    entryDistance = exitDistance;
    exitDistance = swap;
  }
  if (entryDistance > slabRange.near) slabRange.near = entryDistance;
  if (exitDistance < slabRange.far) slabRange.far = exitDistance;
  return slabRange.near <= slabRange.far;
}

export function rayHitsBounds(
  rayOrigin,
  rayDirection,
  boundsMinimum,
  boundsMaximum,
  minimumDistance,
  maximumDistance,
) {
  slabRange.near = minimumDistance;
  slabRange.far = maximumDistance;
  if (!slabOverlaps(rayOrigin[0], rayDirection[0], boundsMinimum[0], boundsMaximum[0])) return false;
  if (!slabOverlaps(rayOrigin[1], rayDirection[1], boundsMinimum[1], boundsMaximum[1])) return false;
  if (!slabOverlaps(rayOrigin[2], rayDirection[2], boundsMinimum[2], boundsMaximum[2])) return false;
  return true;
}





export function rayHitsTriangle(
  rayOrigin,
  rayDirection,
  firstVertex,
  secondVertex,
  thirdVertex,
  minimumDistance,
  maximumDistance,
) {
  const firstEdgeX = secondVertex[0] - firstVertex[0];
  const firstEdgeY = secondVertex[1] - firstVertex[1];
  const firstEdgeZ = secondVertex[2] - firstVertex[2];
  const secondEdgeX = thirdVertex[0] - firstVertex[0];
  const secondEdgeY = thirdVertex[1] - firstVertex[1];
  const secondEdgeZ = thirdVertex[2] - firstVertex[2];

  const perpendicularX = rayDirection[1] * secondEdgeZ - rayDirection[2] * secondEdgeY;
  const perpendicularY = rayDirection[2] * secondEdgeX - rayDirection[0] * secondEdgeZ;
  const perpendicularZ = rayDirection[0] * secondEdgeY - rayDirection[1] * secondEdgeX;
  const determinant = firstEdgeX * perpendicularX + firstEdgeY * perpendicularY + firstEdgeZ * perpendicularZ;
  if (determinant > -TRIANGLE_DETERMINANT_EPSILON && determinant < TRIANGLE_DETERMINANT_EPSILON) return false;

  const inverseDeterminant = 1 / determinant;
  const originToVertexX = rayOrigin[0] - firstVertex[0];
  const originToVertexY = rayOrigin[1] - firstVertex[1];
  const originToVertexZ = rayOrigin[2] - firstVertex[2];
  const barycentricU =
    (originToVertexX * perpendicularX + originToVertexY * perpendicularY + originToVertexZ * perpendicularZ) *
    inverseDeterminant;
  if (barycentricU < -TRIANGLE_EDGE_EPSILON || barycentricU > 1 + TRIANGLE_EDGE_EPSILON) return false;

  const crossX = originToVertexY * firstEdgeZ - originToVertexZ * firstEdgeY;
  const crossY = originToVertexZ * firstEdgeX - originToVertexX * firstEdgeZ;
  const crossZ = originToVertexX * firstEdgeY - originToVertexY * firstEdgeX;
  const barycentricV =
    (rayDirection[0] * crossX + rayDirection[1] * crossY + rayDirection[2] * crossZ) * inverseDeterminant;
  if (barycentricV < -TRIANGLE_EDGE_EPSILON || barycentricU + barycentricV > 1 + TRIANGLE_EDGE_EPSILON) return false;

  const hitDistance =
    (secondEdgeX * crossX + secondEdgeY * crossY + secondEdgeZ * crossZ) * inverseDeterminant;
  return hitDistance > minimumDistance && hitDistance < maximumDistance;
}

function traceOutcome(result, reason, statistics) {
  return Object.freeze({
    result,
    occluded: result === MGL_TRACE_RESULT.occluded,
    resolved: result !== MGL_TRACE_RESULT.unknown,
    reason,
    nodeVisitCount: statistics.nodeVisitCount,
    triangleTestCount: statistics.triangleTestCount,
    stackHighWaterMark: statistics.stackHighWaterMark,
  });
}

function isFiniteTriple(candidate) {
  return (
    !!candidate &&
    Number.isFinite(candidate[0]) &&
    Number.isFinite(candidate[1]) &&
    Number.isFinite(candidate[2])
  );
}


export function traceOcclusion(request) {
  const settings = request || {};
  const statistics = { nodeVisitCount: 0, triangleTestCount: 0, stackHighWaterMark: 0 };
  const payload = settings.payload || null;
  const layout = payload ? payload.layout : null;

  if (!payload || !payload.ok || !layout || layout.nodeCount <= 0) {
    return traceOutcome(MGL_TRACE_RESULT.unknown, "no packed BVH available", statistics);
  }
  if (!isFiniteTriple(settings.origin) || !isFiniteTriple(settings.direction)) {
    return traceOutcome(MGL_TRACE_RESULT.unknown, "ray origin or direction is not finite", statistics);
  }

  const origin = settings.origin;
  const direction = settings.direction;
  const minimumDistance = Number(settings.minimumDistance);
  const maximumDistance = Number(settings.maximumDistance);
  if (!Number.isFinite(minimumDistance) || !Number.isFinite(maximumDistance)) {
    return traceOutcome(MGL_TRACE_RESULT.unknown, "ray range is not finite", statistics);
  }
  if (!(maximumDistance > minimumDistance)) {


    return traceOutcome(MGL_TRACE_RESULT.unknown, "ray range is empty", statistics);
  }

  const maximumNodeVisits = Math.max(1, Math.floor(Number(settings.maximumNodeVisits) || MAXIMUM_NODE_VISITS_PER_RAY));
  let stackPointer = 0;
  traversalStack[stackPointer++] = 0;

  while (stackPointer > 0) {
    if (statistics.nodeVisitCount >= maximumNodeVisits) {
      return traceOutcome(MGL_TRACE_RESULT.unknown, "node visit ceiling reached", statistics);
    }
    const nodeIndex = traversalStack[--stackPointer];
    statistics.nodeVisitCount++;

    readTexel(payload, nodeMinimumTexelIndex(nodeIndex), minimumTexel);
    readTexel(payload, nodeMaximumTexelIndex(nodeIndex), maximumTexel);
    if (!rayHitsBounds(origin, direction, minimumTexel, maximumTexel, minimumDistance, maximumDistance)) continue;

    const firstOrRightChild = minimumTexel[3];
    const leafTriangleCount = maximumTexel[3];

    if (leafTriangleCount > 0.5) {
      if (leafTriangleCount > MAXIMUM_TRIANGLES_PER_LEAF) {
        return traceOutcome(
          MGL_TRACE_RESULT.unknown,
          "leaf holds " + leafTriangleCount + " triangles and the shader loop stops at " + MAXIMUM_TRIANGLES_PER_LEAF,
          statistics,
        );
      }
      for (let localTriangle = 0; localTriangle < leafTriangleCount; localTriangle++) {
        const packedTriangleIndex = firstOrRightChild + localTriangle;
        readTexel(payload, triangleVertexTexelIndex(layout, packedTriangleIndex, 0), firstVertexTexel);
        readTexel(payload, triangleVertexTexelIndex(layout, packedTriangleIndex, 1), secondVertexTexel);
        readTexel(payload, triangleVertexTexelIndex(layout, packedTriangleIndex, 2), thirdVertexTexel);
        statistics.triangleTestCount++;
        if (
          rayHitsTriangle(
            origin,
            direction,
            firstVertexTexel,
            secondVertexTexel,
            thirdVertexTexel,
            minimumDistance,
            maximumDistance,
          )
        ) {
          return traceOutcome(MGL_TRACE_RESULT.occluded, "triangle hit inside the ray range", statistics);
        }
      }
      continue;
    }

    if (stackPointer + 2 > TRAVERSAL_STACK_SIZE) {
      return traceOutcome(MGL_TRACE_RESULT.unknown, "traversal stack overflow", statistics);
    }
    traversalStack[stackPointer++] = nodeIndex + 1;
    traversalStack[stackPointer++] = firstOrRightChild;
    if (stackPointer > statistics.stackHighWaterMark) statistics.stackHighWaterMark = stackPointer;
  }

  return traceOutcome(MGL_TRACE_RESULT.visible, "no triangle inside the ray range", statistics);
}

export function describeTraversal() {
  return {
    triangleDeterminantEpsilon: TRIANGLE_DETERMINANT_EPSILON,
    triangleEdgeEpsilon: TRIANGLE_EDGE_EPSILON,
    slabParallelEpsilon: SLAB_PARALLEL_EPSILON,
    traversalStackSize: TRAVERSAL_STACK_SIZE,
    maximumNodeVisitsPerRay: MAXIMUM_NODE_VISITS_PER_RAY,
    maximumTrianglesPerLeaf: MAXIMUM_TRIANGLES_PER_LEAF,
    engineReference: ENGINE_TRAVERSAL_REFERENCE,
  };
}
