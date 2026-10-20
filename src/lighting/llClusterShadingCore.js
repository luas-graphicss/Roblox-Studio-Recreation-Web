import { CLUSTER_GRID } from "./llClusterShadingContract.js";

export const CLUSTER_LIGHT_TEXEL_COUNT = 4;
const FLOATS_PER_TEXEL = 4;
export const FLOATS_PER_CLUSTER_LIGHT = CLUSTER_LIGHT_TEXEL_COUNT * FLOATS_PER_TEXEL;


export const MAX_CLUSTER_SHADED_LIGHTS = Math.min(256, CLUSTER_GRID.maxLights);
export const CLUSTER_LIGHT_TEXTURE_WIDTH = MAX_CLUSTER_SHADED_LIGHTS * CLUSTER_LIGHT_TEXEL_COUNT;
export const CLUSTER_LIGHT_TEXTURE_HEIGHT = 1;

export const POINT_LIGHT_KIND = 0;
export const SPOT_LIGHT_KIND = 1;
export const NO_ATLAS_SLOT = -1;
export const DEFAULT_LIGHT_DECAY = 2;


export function createClusterLightRecord() {
  return {
    key: "",
    kind: POINT_LIGHT_KIND,

    x: 0,
    y: 0,
    z: 0,
    range: 0,
    intensity: 0,
    r: 0,
    g: 0,
    b: 0,

    viewX: 0,
    viewY: 0,
    viewZ: 0,
    colorR: 0,
    colorG: 0,
    colorB: 0,
    directionX: 0,
    directionY: 0,
    directionZ: -1,
    coneCosine: -1,
    penumbraCosine: -1,
    decay: DEFAULT_LIGHT_DECAY,
    atlasSlot: NO_ATLAS_SLOT,
    sourceRadius: 0,
  };
}


export function createClusterLightDataBuffer(maxLights) {
  return new Float32Array(clampCapacity(maxLights) * FLOATS_PER_CLUSTER_LIGHT);
}


export function isClusterShadableRecord(record) {
  if (!record) return false;
  const range = Number(record.range) || 0;
  const intensity = Number(record.intensity) || 0;
  return range > 0 && intensity > 0;
}


export function packClusterLightData(options) {
  const settings = options || {};
  const records = settings.records || [];
  const recordCount = Number.isFinite(settings.recordCount) ? settings.recordCount : records.length;
  const target = settings.target;
  const capacity = clampCapacity(settings.maxLights);
  if (!target) throw new Error("packClusterLightData: target buffer is required");

  let count = 0;
  let skipped = 0;
  for (let index = 0; index !== recordCount && count !== capacity; index++) {
    const record = records[index];
    if (!isClusterShadableRecord(record)) {
      skipped++;
      continue;
    }
    writeClusterLightRecord(target, count, record);
    count++;
  }


  return { count, skipped };
}


export function readClusterLightData(options) {
  const settings = options || {};
  const buffer = settings.buffer;
  const index = Number(settings.index) || 0;
  if (!buffer) throw new Error("readClusterLightData: buffer is required");
  const base = index * FLOATS_PER_CLUSTER_LIGHT;
  return {
    viewPosition: { x: buffer[base], y: buffer[base + 1], z: buffer[base + 2] },
    range: buffer[base + 3],
    color: { r: buffer[base + 4], g: buffer[base + 5], b: buffer[base + 6] },
    kind: buffer[base + 7],
    direction: { x: buffer[base + 8], y: buffer[base + 9], z: buffer[base + 10] },
    coneCosine: buffer[base + 11],
    penumbraCosine: buffer[base + 12],
    decay: buffer[base + 13],
    atlasSlot: buffer[base + 14],
    sourceRadius: buffer[base + 15],
  };
}

function writeClusterLightRecord(target, lightIndex, record) {
  const base = lightIndex * FLOATS_PER_CLUSTER_LIGHT;
  target[base] = record.viewX;
  target[base + 1] = record.viewY;
  target[base + 2] = record.viewZ;
  target[base + 3] = record.range;

  target[base + 4] = record.colorR;
  target[base + 5] = record.colorG;
  target[base + 6] = record.colorB;
  target[base + 7] = record.kind;

  target[base + 8] = record.directionX;
  target[base + 9] = record.directionY;
  target[base + 10] = record.directionZ;
  target[base + 11] = record.coneCosine;

  target[base + 12] = record.penumbraCosine;
  target[base + 13] = record.decay;
  target[base + 14] = record.atlasSlot;
  target[base + 15] = record.sourceRadius;
}

function clampCapacity(maxLights) {
  const requested = Number(maxLights);
  if (!Number.isFinite(requested) || requested <= 0) return MAX_CLUSTER_SHADED_LIGHTS;
  return Math.min(MAX_CLUSTER_SHADED_LIGHTS, Math.floor(requested));
}
