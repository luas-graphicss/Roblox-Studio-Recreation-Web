export function evaluateSubstrateSmMsmDiffuse({ irradiance, diffuseReflectance }, target = [0, 0, 0]) {
  if (!irradiance || irradiance.length !== 3 || !diffuseReflectance || diffuseReflectance.length !== 3) {
    throw new TypeError('MSM diffuse requires three irradiance and reflectance channels');
  }
  for (let channel = 0; channel < 3; channel += 1) {
    const energy = irradiance[channel];
    const reflectance = diffuseReflectance[channel];
    if (!Number.isFinite(energy) || energy < 0 || !Number.isFinite(reflectance) || reflectance < 0 || reflectance > 1) {
      throw new RangeError('MSM diffuse inputs are outside their physical ranges');
    }
  }
  for (let channel = 0; channel < 3; channel += 1) {
    target[channel] = irradiance[channel] * diffuseReflectance[channel] / Math.PI;
  }
  return target;
}
