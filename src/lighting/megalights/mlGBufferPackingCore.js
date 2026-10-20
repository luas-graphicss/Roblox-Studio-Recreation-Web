import {
  encodeVelocityToUnitRange,
  decodeVelocityFromUnitRange,
} from "./mlVelocityEncodingCore.js";


export const GBUFFER_CHANNEL_LAYOUT = Object.freeze({
  sceneDepth: Object.freeze({
    r: "linearViewDepth",
    g: "normalizedViewDepth",
    b: "unused",
    a: "coverage",
  }),
  sceneNormal: Object.freeze({
    r: "worldNormalX",
    g: "worldNormalY",
    b: "worldNormalZ",
    a: "roughness",
  }),
  sceneAlbedo: Object.freeze({
    r: "albedoRed",
    g: "albedoGreen",
    b: "albedoBlue",
    a: "metalness",
  }),
  sceneVelocity: Object.freeze({
    r: "encodedVelocityU",
    g: "encodedVelocityV",
    b: "unused",
    a: "velocityValidity",
  }),
});


export const COVERED_PIXEL_THRESHOLD = 0.5;

export function clampToUnitRange(value) {
  if (!(typeof value === "number" && Number.isFinite(value))) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}


export function normalizeViewDepth(linearViewDepth, nearPlane, farPlane) {
  const span = Math.max(farPlane - nearPlane, 1e-6);
  return clampToUnitRange((linearViewDepth - nearPlane) / span);
}


export function restoreViewDepth(normalizedViewDepth, nearPlane, farPlane) {
  const span = Math.max(farPlane - nearPlane, 1e-6);
  return clampToUnitRange(normalizedViewDepth) * span + nearPlane;
}

export function normalizeVector3(vector) {
  const x = Number(vector && vector[0]) || 0;
  const y = Number(vector && vector[1]) || 0;
  const z = Number(vector && vector[2]) || 0;
  const length = Math.sqrt(x * x + y * y + z * z);
  if (length <= 1e-8) return [0, 0, 0];
  return [x / length, y / length, z / length];
}


export function encodeNormalToUnitRange(worldNormal) {
  const unitNormal = normalizeVector3(worldNormal);
  return [
    unitNormal[0] * 0.5 + 0.5,
    unitNormal[1] * 0.5 + 0.5,
    unitNormal[2] * 0.5 + 0.5,
  ];
}

export function decodeNormalFromUnitRange(encodedNormal) {
  return normalizeVector3([
    (Number(encodedNormal && encodedNormal[0]) || 0) * 2 - 1,
    (Number(encodedNormal && encodedNormal[1]) || 0) * 2 - 1,
    (Number(encodedNormal && encodedNormal[2]) || 0) * 2 - 1,
  ]);
}


export function decodeGBufferSample(texels) {
  const depthTexel = (texels && texels.sceneDepth) || [0, 0, 0, 0];
  const normalTexel = (texels && texels.sceneNormal) || [0, 0, 0, 0];
  const albedoTexel = (texels && texels.sceneAlbedo) || [0, 0, 0, 0];
  const velocityTexel = (texels && texels.sceneVelocity) || [0.5, 0.5, 0, 0];
  return {
    covered: depthTexel[3] >= COVERED_PIXEL_THRESHOLD,
    linearViewDepth: depthTexel[0],
    normalizedViewDepth: depthTexel[1],
    worldNormal: decodeNormalFromUnitRange(normalTexel),
    roughness: clampToUnitRange(normalTexel[3]),
    albedo: [albedoTexel[0], albedoTexel[1], albedoTexel[2]],
    metalness: clampToUnitRange(albedoTexel[3]),
    velocity: decodeVelocityFromUnitRange(velocityTexel[0], velocityTexel[1]),
    velocityIsValid: velocityTexel[3] >= COVERED_PIXEL_THRESHOLD,
  };
}


export function encodeGBufferSample(sample) {
  const encodedNormal = encodeNormalToUnitRange(sample.worldNormal);
  const encodedVelocity = encodeVelocityToUnitRange(
    sample.velocity ? sample.velocity[0] : 0,
    sample.velocity ? sample.velocity[1] : 0,
  );
  return {
    sceneDepth: [
      sample.linearViewDepth,
      normalizeViewDepth(sample.linearViewDepth, sample.nearPlane, sample.farPlane),
      0,
      sample.covered === false ? 0 : 1,
    ],
    sceneNormal: [encodedNormal[0], encodedNormal[1], encodedNormal[2], clampToUnitRange(sample.roughness)],
    sceneAlbedo: [
      sample.albedo ? sample.albedo[0] : 0,
      sample.albedo ? sample.albedo[1] : 0,
      sample.albedo ? sample.albedo[2] : 0,
      clampToUnitRange(sample.metalness),
    ],
    sceneVelocity: [encodedVelocity[0], encodedVelocity[1], 0, sample.velocityIsValid === false ? 0 : 1],
  };
}
