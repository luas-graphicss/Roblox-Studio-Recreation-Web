import { VOL_FOG_ALBEDO, hgPhaseJs } from "./volumetricFogCore.js";
import { unrealFalloff } from "./llFalloffCore.js";
import { resolveSpotCone, spotConeAttenuation, spotConeGateHalfAngleDeg } from "./llSpotConeCore.js";
import { LOCAL_VOLUMETRIC_NO_ATLAS_ROW } from "./llVolumetricLocalContract.js";


export const LOCAL_VOLUMETRIC_MIN_SCATTERING_INTENSITY = 0;
export const LOCAL_VOLUMETRIC_MAX_SCATTERING_INTENSITY = 8;
export const LOCAL_VOLUMETRIC_DEFAULT_SCATTERING_INTENSITY = 1;


export const MINIMUM_DISTANCE_TO_LIGHT = 1e-4;
export const SPOT_LIGHT_TYPE = "SpotLight";

function isFiniteNumber(value) {
  return typeof value === "number" && isFinite(value);
}

function numberOr(value, fallback) {
  return isFiniteNumber(value) ? value : fallback;
}

function clampToRange(value, minimum, maximum) {
  if (value < minimum) return minimum;
  return value > maximum ? maximum : value;
}


function readVector3(raw, fallbackX, fallbackY, fallbackZ) {
  if (Array.isArray(raw)) {
    return { x: numberOr(raw[0], fallbackX), y: numberOr(raw[1], fallbackY), z: numberOr(raw[2], fallbackZ) };
  }
  if (raw && typeof raw === "object") {
    return { x: numberOr(raw.x, fallbackX), y: numberOr(raw.y, fallbackY), z: numberOr(raw.z, fallbackZ) };
  }
  return { x: fallbackX, y: fallbackY, z: fallbackZ };
}

export function dotProduct(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vectorLength(v) {
  return Math.sqrt(dotProduct(v, v));
}

function normalizeVector(v) {
  const length = vectorLength(v);
  if (!(length > 0)) return { x: 0, y: 0, z: -1 };
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

export function clampScatteringIntensity(raw) {
  return clampToRange(
    numberOr(raw, LOCAL_VOLUMETRIC_DEFAULT_SCATTERING_INTENSITY),
    LOCAL_VOLUMETRIC_MIN_SCATTERING_INTENSITY,
    LOCAL_VOLUMETRIC_MAX_SCATTERING_INTENSITY,
  );
}


export function isSpotLightType(type) {
  return type === SPOT_LIGHT_TYPE;
}

function resolveConeOf(authored, isSpot) {
  if (!isSpot) return null;
  if (authored.cone && isFiniteNumber(authored.cone.cosOuter)) return authored.cone;
  return resolveSpotCone({
    coneAngleDeg: authored.coneAngleDeg,
    innerConeAngleDeg: authored.innerConeAngleDeg,
    outerConeAngleDeg: authored.outerConeAngleDeg,
  });
}


export function resolveVolumetricLight(authored) {
  const input = authored || {};
  const isSpot = isSpotLightType(input.type);
  const cone = resolveConeOf(input, isSpot);
  const color = input.color || {};
  const scatteringIntensity = clampScatteringIntensity(input.scatteringIntensity);
  const intensity = Math.max(numberOr(input.intensity, 0), 0);
  const range = Math.max(numberOr(input.range, 0), 0);
  return Object.freeze({
    name: typeof input.name === "string" ? input.name : "",
    type: typeof input.type === "string" ? input.type : "",
    isSpot,
    worldPosition: Object.freeze(readVector3(input.worldPosition, 0, 0, 0)),
    coneAxis: Object.freeze(isSpot ? normalizeVector(readVector3(input.coneAxis, 0, -1, 0)) : { x: 0, y: -1, z: 0 }),
    range,
    cosOuter: cone ? cone.cosOuter : -1,
    cosInner: cone ? cone.cosInner : 1,
    coneGateHalfAngleDeg: cone ? spotConeGateHalfAngleDeg(cone) : 180,
    color: Object.freeze({
      red: Math.max(numberOr(color.red, 1), 0),
      green: Math.max(numberOr(color.green, 1), 0),
      blue: Math.max(numberOr(color.blue, 1), 0),
    }),
    intensity,
    scatteringIntensity,
    atlasMetaRow: isFiniteNumber(input.atlasMetaRow) ? input.atlasMetaRow : LOCAL_VOLUMETRIC_NO_ATLAS_ROW,


    emitsIntoMedium: intensity > 0 && scatteringIntensity > 0 && range > 0,
  });
}


export function localVolumetricPhase(mediumAnisotropy, cosViewToLight) {
  return hgPhaseJs(mediumAnisotropy, cosViewToLight);
}


export function volumetricDistanceAttenuation(distanceToLight, range) {
  return unrealFalloff(Math.max(distanceToLight, MINIMUM_DISTANCE_TO_LIGHT), range);
}


export function volumetricConeAttenuation(light, directionFromLightToSample) {
  if (!light.isSpot) return 1;
  return spotConeAttenuation(dotProduct(light.coneAxis, directionFromLightToSample), light.cosInner, light.cosOuter);
}


export function resolveAtlasShadowVisibility(rawVisibility) {
  if (!isFiniteNumber(rawVisibility)) return 1;
  if (rawVisibility < 0) return 1;
  return rawVisibility > 1 ? 1 : rawVisibility;
}


export function localVolumetricSampleInscatter(options) {
  const settings = options || {};
  const light = settings.light;
  const samplePosition = settings.samplePosition;
  const sampleToLight = {
    x: light.worldPosition.x - samplePosition.x,
    y: light.worldPosition.y - samplePosition.y,
    z: light.worldPosition.z - samplePosition.z,
  };
  const distanceToLight = Math.max(vectorLength(sampleToLight), MINIMUM_DISTANCE_TO_LIGHT);
  const directionToLight = {
    x: sampleToLight.x / distanceToLight,
    y: sampleToLight.y / distanceToLight,
    z: sampleToLight.z / distanceToLight,
  };
  const distanceAttenuation = volumetricDistanceAttenuation(distanceToLight, light.range);
  const coneAttenuation = volumetricConeAttenuation(light, {
    x: -directionToLight.x,
    y: -directionToLight.y,
    z: -directionToLight.z,
  });
  const shadowVisibility = resolveAtlasShadowVisibility(settings.shadowVisibility);


  const phase = localVolumetricPhase(numberOr(settings.mediumAnisotropy, 0), dotProduct(settings.viewRayDirection, directionToLight));
  const weight = light.intensity * light.scatteringIntensity * distanceAttenuation * coneAttenuation * shadowVisibility * phase;
  return Object.freeze({
    red: light.color.red * weight,
    green: light.color.green * weight,
    blue: light.color.blue * weight,
    distanceToLight,
    distanceAttenuation,
    coneAttenuation,
    shadowVisibility,
    phase,
  });
}


export function integrateLocalVolumetricRay(options) {
  const settings = options || {};
  const lights = Array.isArray(settings.lights) ? settings.lights : [];
  const stepCount = Math.max(1, Math.floor(numberOr(settings.stepCount, 1)));
  const rayLength = Math.max(numberOr(settings.rayLength, 0), 0);
  const stepLength = rayLength / stepCount;
  const density = Math.max(numberOr(settings.density, 0), 0);
  const heightFalloff = Math.max(numberOr(settings.heightFalloff, 0), 0);
  const heightReference = numberOr(settings.heightReference, 0);
  const mediumAnisotropy = numberOr(settings.mediumAnisotropy, 0);
  const rayOrigin = settings.rayOrigin;
  const rayDirection = settings.rayDirection;
  const shadowVisibilityAt = typeof settings.shadowVisibilityAt === "function" ? settings.shadowVisibilityAt : null;
  const inscatter = { red: 0, green: 0, blue: 0 };
  let transmittance = 1;
  let travelled = stepLength * clampToRange(numberOr(settings.jitter, 0), 0, 1);
  for (let stepIndex = 0; stepIndex < stepCount; stepIndex++) {
    const samplePosition = {
      x: rayOrigin.x + rayDirection.x * travelled,
      y: rayOrigin.y + rayDirection.y * travelled,
      z: rayOrigin.z + rayDirection.z * travelled,
    };
    const heightAttenuation = Math.exp(-Math.max(samplePosition.y - heightReference, 0) * heightFalloff);
    const extinction = density * heightAttenuation;
    const scatterWeight = transmittance * extinction * VOL_FOG_ALBEDO * stepLength;
    for (let lightIndex = 0; lightIndex < lights.length; lightIndex++) {
      const light = lights[lightIndex];
      const sample = localVolumetricSampleInscatter({
        light,
        samplePosition,
        viewRayDirection: rayDirection,
        mediumAnisotropy,
        shadowVisibility: shadowVisibilityAt ? shadowVisibilityAt(light, samplePosition, stepIndex) : 1,
      });
      inscatter.red += sample.red * scatterWeight;
      inscatter.green += sample.green * scatterWeight;
      inscatter.blue += sample.blue * scatterWeight;
    }
    transmittance *= Math.exp(-extinction * stepLength);
    travelled += stepLength;
  }
  return { inscatter, transmittance, stepCount, stepLength };
}
