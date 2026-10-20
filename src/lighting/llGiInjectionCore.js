import { blendFalloff } from "./llFalloffCore.js";
import { spotConeAttenuation, legacySpotConeAttenuation } from "./llSpotConeCore.js";
import { LEGACY_DECAY_EXPONENT } from "./llGiLocalContract.js";
import { clamp01, dotProduct, scaleVector, subtractVectors } from "./llGiVectorCore.js";

export const MIN_SQUARED_DISTANCE = 1e-8;


export function coneAttenuationOf(light, directionLightToSample, coneBlend) {
  const cone = light && light.cone;
  if (!cone) return 1;
  const axis = light.direction;
  if (!axis) return 1;
  const cosTheta = dotProduct(axis, directionLightToSample);
  const cosOuter = Number(cone.cosOuter);
  const cosInner = Number(cone.cosInner);
  if (!Number.isFinite(cosOuter) || !Number.isFinite(cosInner)) return 1;
  if (cosTheta <= cosOuter) return 0;
  const legacy = legacySpotConeAttenuation(cosTheta, cosOuter, cosInner);
  const mix = clamp01(Number(coneBlend) || 0);
  if (mix <= 0) return legacy;
  const unreal = spotConeAttenuation(cosTheta, cosInner, cosOuter);
  if (mix >= 1) return unreal;
  return legacy + (unreal - legacy) * mix;
}













export function directIrradianceAt(options) {
  const input = options || {};
  const light = input.light;
  if (!light || light.enabled === false) return [0, 0, 0];
  const indirectScale = Number.isFinite(Number(input.indirectScale)) ? Math.max(Number(input.indirectScale), 0) : 1;
  if (!(indirectScale > 0)) return [0, 0, 0];
  const candela = Math.max(Number(light.candela) || 0, 0);
  if (!(candela > 0)) return [0, 0, 0];

  const lightToSample = subtractVectors(input.position, light.position);
  const squaredDistance = dotProduct(lightToSample, lightToSample);
  if (!(squaredDistance > MIN_SQUARED_DISTANCE)) return [0, 0, 0];
  const distance = Math.sqrt(squaredDistance);
  const directionLightToSample = scaleVector(lightToSample, 1 / distance);


  const incidenceCosine = Math.max(-dotProduct(input.normal, directionLightToSample), 0);
  if (!(incidenceCosine > 0)) return [0, 0, 0];

  const cone = coneAttenuationOf(light, directionLightToSample, input.coneBlend);
  if (!(cone > 0)) return [0, 0, 0];

  const falloff = blendFalloff(distance, Math.max(Number(light.range) || 0, 0), Number(input.falloffBlend) || 0, LEGACY_DECAY_EXPONENT);
  if (!(falloff > 0)) return [0, 0, 0];

  const scale = candela * falloff * cone * incidenceCosine * indirectScale;
  const color = light.color || [1, 1, 1];
  return [color[0] * scale, color[1] * scale, color[2] * scale];
}


export function accumulateDirectIrradiance(options) {
  const input = options || {};
  const injectedLights = Array.isArray(input.injectedLights) ? input.injectedLights : [];
  const total = [0, 0, 0];
  for (let index = 0; index !== injectedLights.length; index += 1) {
    const entry = injectedLights[index];
    const irradiance = directIrradianceAt({
      light: entry.light || entry,
      indirectScale: entry.indirectScale,
      position: input.position,
      normal: input.normal,
      falloffBlend: input.falloffBlend,
      coneBlend: input.coneBlend,
    });
    total[0] += irradiance[0];
    total[1] += irradiance[1];
    total[2] += irradiance[2];
  }
  return total;
}
