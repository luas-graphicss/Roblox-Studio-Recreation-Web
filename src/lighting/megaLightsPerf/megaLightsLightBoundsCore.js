const PACKED_FLOATS_PER_LIGHT = 8;
const PACKED_RANGE_OFFSET = 3;

export function createViewSpaceLightBounds() {
  return {
    lightCount: 0,
    valid: false,
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    radius: 0,
    radiusSquared: 0,
  };
}

function resetBounds(bounds) {
  bounds.lightCount = 0;
  bounds.valid = false;
  bounds.centerX = 0;
  bounds.centerY = 0;
  bounds.centerZ = 0;
  bounds.radius = 0;
  bounds.radiusSquared = 0;
  return bounds;
}


export function computeViewSpaceLightBounds(packedLightData, lightCount, boundsOut) {
  const bounds = resetBounds(boundsOut || createViewSpaceLightBounds());
  const requested = Math.floor(Number(lightCount) || 0);
  if (!packedLightData || requested <= 0) return bounds;

  const available = Math.floor(packedLightData.length / PACKED_FLOATS_PER_LIGHT);
  const usableLights = Math.min(requested, available);
  if (usableLights <= 0) return bounds;

  let litLights = 0;
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  for (let index = 0; index < usableLights; index++) {
    const base = index * PACKED_FLOATS_PER_LIGHT;
    if (!(packedLightData[base + PACKED_RANGE_OFFSET] > 0)) continue;
    sumX += packedLightData[base];
    sumY += packedLightData[base + 1];
    sumZ += packedLightData[base + 2];
    litLights++;
  }
  if (litLights <= 0) return bounds;

  const centerX = sumX / litLights;
  const centerY = sumY / litLights;
  const centerZ = sumZ / litLights;

  let radius = 0;
  for (let index = 0; index < usableLights; index++) {
    const base = index * PACKED_FLOATS_PER_LIGHT;
    const range = packedLightData[base + PACKED_RANGE_OFFSET];
    if (!(range > 0)) continue;
    const deltaX = packedLightData[base] - centerX;
    const deltaY = packedLightData[base + 1] - centerY;
    const deltaZ = packedLightData[base + 2] - centerZ;
    const reach = Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ) + range;
    if (reach > radius) radius = reach;
  }

  bounds.lightCount = litLights;
  bounds.centerX = centerX;
  bounds.centerY = centerY;
  bounds.centerZ = centerZ;
  bounds.radius = radius;
  bounds.radiusSquared = radius * radius;


  bounds.valid = Number.isFinite(radius) && radius > 0 &&
    Number.isFinite(centerX) && Number.isFinite(centerY) && Number.isFinite(centerZ);
  return bounds;
}


export function isPointOutsideLightBounds(bounds, pointX, pointY, pointZ) {
  if (!bounds || !bounds.valid) return false;
  const deltaX = pointX - bounds.centerX;
  const deltaY = pointY - bounds.centerY;
  const deltaZ = pointZ - bounds.centerZ;
  return deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ > bounds.radiusSquared;
}
