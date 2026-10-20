export const UPSAMPLE_REJECTION = Object.freeze({
  none: "none",
  outsideBuffer: "outsideBuffer",
  missingGeometry: "missingGeometry",
  depthDisagreement: "depthDisagreement",
  normalDisagreement: "normalDisagreement",
});

export const EDGE_STOPPING_DEFAULTS = Object.freeze({


  depthWeight: 12,


  normalWeight: 16,


  minimumSimilarity: 0.05,
});

const SIMILARITY_EPSILON = 1e-6;


function readFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function readVector3(value) {
  if (!value) return null;
  const components = Array.isArray(value) ? value : [value.x, value.y, value.z];
  if (!(components.length >= 3)) return null;
  const x = readFiniteNumber(components[0]);
  const y = readFiniteNumber(components[1]);
  const z = readFiniteNumber(components[2]);
  if (x === null || y === null || z === null) return null;
  return { x, y, z };
}

function normalizeVector3(vector) {
  if (!vector) return null;
  const length = Math.sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z);
  if (!(length > SIMILARITY_EPSILON)) return null;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function resolveWeight(value, fallbackValue) {
  const weight = readFiniteNumber(value);
  return weight === null ? fallbackValue : Math.max(0, weight);
}

export function relativeDepthDifference(centerDepth, neighborDepth) {
  const scale = Math.max(Math.abs(centerDepth), Math.abs(neighborDepth), SIMILARITY_EPSILON);
  return Math.abs(centerDepth - neighborDepth) / scale;
}

export function depthSimilarity(centerDepth, neighborDepth, depthWeight) {
  const weight = resolveWeight(depthWeight, EDGE_STOPPING_DEFAULTS.depthWeight);
  return Math.exp(-relativeDepthDifference(centerDepth, neighborDepth) * weight);
}

export function normalSimilarity(centerNormal, neighborNormal, normalWeight) {
  const center = normalizeVector3(readVector3(centerNormal));
  const neighbor = normalizeVector3(readVector3(neighborNormal));
  if (!center || !neighbor) return 0;
  const weight = resolveWeight(normalWeight, EDGE_STOPPING_DEFAULTS.normalWeight);
  const cosine = Math.max(0, center.x * neighbor.x + center.y * neighbor.y + center.z * neighbor.z);
  return Math.pow(cosine, weight);
}

function rejectedTap(rejection, depthSimilarityValue, normalSimilarityValue) {
  return {
    depthSimilarity: depthSimilarityValue || 0,
    normalSimilarity: normalSimilarityValue || 0,
    edgeWeight: 0,
    accepted: false,
    rejection,
  };
}


export function neighborEdgeWeight(request) {
  const settings = request || {};
  if (settings.isInsideBuffer === false) return rejectedTap(UPSAMPLE_REJECTION.outsideBuffer);

  const centerDepth = readFiniteNumber(settings.centerDepth);
  const neighborDepth = readFiniteNumber(settings.neighborDepth);
  const centerNormal = readVector3(settings.centerNormal);
  const neighborNormal = readVector3(settings.neighborNormal);
  const hasEvidence = centerDepth !== null && neighborDepth !== null && !!centerNormal && !!neighborNormal;
  if (!hasEvidence) return rejectedTap(UPSAMPLE_REJECTION.missingGeometry);

  const configuredMinimumSimilarity = readFiniteNumber(settings.minimumSimilarity);
  const minimumSimilarity =
    configuredMinimumSimilarity === null
      ? EDGE_STOPPING_DEFAULTS.minimumSimilarity
      : configuredMinimumSimilarity;
  const depthSimilarityValue = depthSimilarity(centerDepth, neighborDepth, settings.depthWeight);
  const normalSimilarityValue = normalSimilarity(centerNormal, neighborNormal, settings.normalWeight);

  if (minimumSimilarity > depthSimilarityValue) {
    return rejectedTap(UPSAMPLE_REJECTION.depthDisagreement, depthSimilarityValue, normalSimilarityValue);
  }
  if (minimumSimilarity > normalSimilarityValue) {
    return rejectedTap(UPSAMPLE_REJECTION.normalDisagreement, depthSimilarityValue, normalSimilarityValue);
  }
  return {
    depthSimilarity: depthSimilarityValue,
    normalSimilarity: normalSimilarityValue,
    edgeWeight: depthSimilarityValue * normalSimilarityValue,
    accepted: true,
    rejection: UPSAMPLE_REJECTION.none,
  };
}
