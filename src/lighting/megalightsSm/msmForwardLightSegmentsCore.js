export const MSM_NATIVE_LIGHT_SEGMENTS = Object.freeze({ pointSampler: 1, pointDirect: 2, spotSampler: 4, spotDirect: 8 });
export const MSM_ALL_NATIVE_LIGHT_SEGMENTS = 15;

export function msmForwardLightSegmentMask(segments = {}) {
  return (segments?.pointSampler === false ? 0 : MSM_NATIVE_LIGHT_SEGMENTS.pointSampler) |
    (segments?.pointDirect === false ? 0 : MSM_NATIVE_LIGHT_SEGMENTS.pointDirect) |
    (segments?.spotSampler === false ? 0 : MSM_NATIVE_LIGHT_SEGMENTS.spotSampler) |
    (segments?.spotDirect === false ? 0 : MSM_NATIVE_LIGHT_SEGMENTS.spotDirect);
}

export function resolveMsmForwardLightSegments(lights) {
  const segments = { pointSampler: false, pointDirect: false, spotSampler: false, spotDirect: false };
  for (const light of lights) {
    if (!light || light.visible === false || light.intensity === 0) continue;
    const color = light.color;
    if (Number.isFinite(light.intensity) && color && color.r === 0 && color.g === 0 && color.b === 0) continue;
    if (light.isPointLight) {
      if (light.castShadow) segments.pointSampler = true;
      else segments.pointDirect = true;
    } else if (light.isSpotLight) {
      if (light.castShadow || light.map) segments.spotSampler = true;
      else segments.spotDirect = true;
    }
    if (segments.pointSampler && segments.pointDirect && segments.spotSampler && segments.spotDirect) break;
  }
  return segments;
}
