import { createSubstrateSmBsdfResult, evaluateSubstrateSmBsdf } from './ssmBsdfCore.js';

export const SSM_LIGHT_INPUT_CONTRACT = Object.freeze({
  version: 1,
  directionSpace: 'view',
  directionLength: 'unit',
  radiance: 'host-after-attenuation-cookie-and-visibility',
  cosine: 'not-applied',
  bsdf: 'not-applied',
  shadowOwner: 'host',
  extraShadowEvaluations: 0,
  lightLoopVisits: 1,
});

function requireVisibleRadiance(visibleRadiance) {
  if (!visibleRadiance || visibleRadiance.length !== 3) {
    throw new TypeError('Host-visible radiance requires three channels');
  }
  for (const channel of visibleRadiance) {
    if (!Number.isFinite(channel) || channel < 0) {
      throw new RangeError('Host-visible radiance must be finite and nonnegative');
    }
  }
}

export function evaluateSubstrateSmLightContribution(
  { surface, normal, viewDirection, lightDirection, visibleRadiance },
  target = createSubstrateSmBsdfResult(),
) {
  requireVisibleRadiance(visibleRadiance);
  evaluateSubstrateSmBsdf({ surface, normal, viewDirection, lightDirection }, target);
  const normalLight = Math.max(0, Math.min(1,
    normal[0] * lightDirection[0] + normal[1] * lightDirection[1] + normal[2] * lightDirection[2],
  ));
  for (let channel = 0; channel < 3; channel += 1) {
    const irradiance = visibleRadiance[channel] * normalLight;
    target.diffuse[channel] *= irradiance;
    target.specular[channel] *= irradiance;
    target.total[channel] = target.diffuse[channel] + target.specular[channel];
  }
  return target;
}
