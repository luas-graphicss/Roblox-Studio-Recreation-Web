import { SSM_BSDF_MINIMUM_ROUGHNESS } from './ssmBsdfNumerics.js';

export const SSM_INDIRECT_RESPONSE_MODEL = 'three-r161-dfg-approximation';
export const SSM_INDIRECT_MINIMUM_DENOMINATOR = 1e-6;

function clampUnit(value) {
  return Math.max(0, Math.min(1, value));
}

function requireRange(value, name, maximum = Infinity) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > maximum
  ) {
    throw new RangeError(
      `SSM indirect ${name} must be finite and within [0, ${maximum}]`,
    );
  }
}

function requireColor(value, name, maximum = Infinity) {
  if (!value || value.length !== 3)
    throw new TypeError(`SSM indirect ${name} requires three channels`);
  for (let channel = 0; channel < 3; channel += 1)
    requireRange(value[channel], `${name}[${channel}]`, maximum);
}

export function createSubstrateSmIndirectResult() {
  return {
    diffuse: [0, 0, 0],
    specular: [0, 0, 0],
    total: [0, 0, 0],
    singleScattering: [0, 0, 0],
    multipleScattering: [0, 0, 0],
    diffuseReflectance: [0, 0, 0],
  };
}

export function evaluateSubstrateSmIndirectLighting(
  {
    surface,
    normalView,
    diffuseIrradiance,
    environmentIrradiance,
    reflectedRadiance,
    specularOcclusion = 1,
  },
  target = createSubstrateSmIndirectResult(),
) {
  if (!surface || typeof surface !== 'object')
    throw new TypeError('SSM indirect requires a resolved surface');
  requireColor(surface.diffuseReflectance, 'diffuseReflectance', 1);
  requireColor(surface.specularF0, 'specularF0', 1);
  requireRange(surface.specularF90, 'specularF90', 1);
  requireRange(surface.reflectionRoughness, 'reflectionRoughness', 1);
  requireRange(normalView, 'normalView', 1);
  requireRange(specularOcclusion, 'specularOcclusion', 1);
  requireColor(diffuseIrradiance, 'diffuseIrradiance');
  requireColor(environmentIrradiance, 'environmentIrradiance');
  requireColor(reflectedRadiance, 'reflectedRadiance');

  const roughness = Math.max(
    SSM_BSDF_MINIMUM_ROUGHNESS,
    surface.reflectionRoughness,
  );
  const coefficientX = 1 - roughness;
  const coefficientY = 0.0425 - 0.0275 * roughness;
  const coefficientZ = 1.04 - 0.572 * roughness;
  const coefficientW = -0.04 + 0.022 * roughness;
  const fittedAmplitude =
    Math.min(coefficientX * coefficientX, 2 ** (-9.28 * normalView)) *
      coefficientX +
    coefficientY;
  const fittedScale = -1.04 * fittedAmplitude + coefficientZ;
  const fittedBias = 1.04 * fittedAmplitude + coefficientW;
  const missingEnergy = 1 - clampUnit(fittedScale + fittedBias);
  const viewFresnelWeight = (1 - normalView) ** 5;

  for (let channel = 0; channel < 3; channel += 1) {
    const specularF0 = surface.specularF0[channel];
    const fresnelRange = surface.specularF90 - specularF0;
    const averageFresnel = specularF0 + fresnelRange / 21;
    const viewTransmission = 1 - specularF0 - fresnelRange * viewFresnelWeight;
    const singleScattering = clampUnit(
      specularF0 * fittedScale + surface.specularF90 * fittedBias,
    );
    const multipleScattering = Math.min(
      1 - singleScattering,
      (singleScattering * averageFresnel * missingEnergy) /
        Math.max(
          1 - missingEnergy * averageFresnel,
          SSM_INDIRECT_MINIMUM_DENOMINATOR,
        ),
    );
    const diffuseReflectance = Math.max(
      0,
      Math.min(
        surface.diffuseReflectance[channel] *
          viewTransmission *
          (1 - averageFresnel),
        1 - singleScattering - multipleScattering,
      ),
    );
    target.singleScattering[channel] = singleScattering;
    target.multipleScattering[channel] = multipleScattering;
    target.diffuseReflectance[channel] = diffuseReflectance;
    target.diffuse[channel] =
      ((diffuseIrradiance[channel] + environmentIrradiance[channel]) *
        diffuseReflectance) /
      Math.PI;
    target.specular[channel] =
      (reflectedRadiance[channel] * singleScattering +
        (environmentIrradiance[channel] * multipleScattering) / Math.PI) *
      specularOcclusion;
    target.total[channel] = target.diffuse[channel] + target.specular[channel];
  }
  return target;
}
