import { nitsToRadiance, REFERENCE_WHITE_NITS } from '../emissiveNitsCore.js';

export const SSM_PHOTOMETRY_CONTRACT = Object.freeze({
  colorSpace: 'linear-srgb',
  referenceWhiteNits: REFERENCE_WHITE_NITS,
  exposureOwner: 'host',
  toneMappingOwner: 'host',
  emissiveShaderOwner: 'host',
});

export function writeSubstrateSmEmission(
  { value, units },
  target = new Float32Array(3),
) {
  if (units !== 'nits' && units !== 'scene-radiance')
    throw new RangeError('SSM emission units must be explicit');
  if (!value || value.length !== 3 || !target || target.length !== 3) {
    throw new TypeError('SSM emission requires three linear color channels');
  }
  for (let channel = 0; channel < 3; channel += 1) {
    const component = value[channel];
    const converted = units === 'nits' ? nitsToRadiance(component) : component;
    if (
      typeof component !== 'number' ||
      !Number.isFinite(component) ||
      component < 0 ||
      !Number.isFinite(Math.fround(converted))
    ) {
      throw new RangeError(
        'SSM emission requires nonnegative finite float32 radiance',
      );
    }
  }
  for (let channel = 0; channel < 3; channel += 1) {
    target[channel] =
      units === 'nits' ? nitsToRadiance(value[channel]) : value[channel];
  }
  return target;
}
