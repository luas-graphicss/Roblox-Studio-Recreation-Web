import {
  SSM_BSDF_MINIMUM_ROUGHNESS,
  SSM_BSDF_MINIMUM_DENOMINATOR,
  SSM_BSDF_MINIMUM_HALF_LENGTH_SQUARED,
  SSM_BSDF_UNIT_VECTOR_TOLERANCE,
} from './ssmBsdfNumerics.js';

function clampCosine(value) {
  return Math.max(0, Math.min(1, value));
}

function dotProduct(left, right) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function requireUnitInterval(value, name) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`SSM BSDF ${name} must be a finite number in [0, 1]`);
  }
}

function requireReflectance(value, name) {
  if (!value || value.length !== 3) {
    throw new TypeError(`SSM BSDF ${name} must contain three numeric channels`);
  }
  for (let channel = 0; channel < 3; channel += 1) {
    requireUnitInterval(value[channel], `${name}[${channel}]`);
  }
}

function requireUnitDirection(value, name) {
  if (!value || value.length !== 3 || !Number.isFinite(value[0]) ||
      !Number.isFinite(value[1]) || !Number.isFinite(value[2]) ||
      Math.abs(dotProduct(value, value) - 1) > SSM_BSDF_UNIT_VECTOR_TOLERANCE) {
    throw new RangeError(`SSM BSDF ${name} must be a finite unit vector`);
  }
}

function requireBsdfInput(surface, normal, viewDirection, lightDirection) {
  if (!surface || typeof surface !== 'object') {
    throw new TypeError('SSM BSDF requires resolved surface parameters');
  }
  requireReflectance(surface.diffuseReflectance, 'diffuseReflectance');
  requireReflectance(surface.specularF0, 'specularF0');
  requireUnitInterval(surface.specularF90, 'specularF90');
  requireUnitInterval(surface.perceptualRoughness, 'perceptualRoughness');
  requireUnitDirection(normal, 'normal');
  requireUnitDirection(viewDirection, 'viewDirection');
  requireUnitDirection(lightDirection, 'lightDirection');
}

function fifthPower(value) {
  const squared = value * value;
  return squared * squared * value;
}

function clearBsdfResult(target) {
  target.diffuse.fill(0);
  target.specular.fill(0);
  target.total.fill(0);
  return target;
}

export function createSubstrateSmBsdfResult() {
  return { diffuse: [0, 0, 0], specular: [0, 0, 0], total: [0, 0, 0] };
}

export function evaluateSubstrateSmBsdf(
  { surface, normal, viewDirection, lightDirection },
  target = createSubstrateSmBsdfResult(),
) {
  requireBsdfInput(surface, normal, viewDirection, lightDirection);
  const normalView = clampCosine(dotProduct(normal, viewDirection));
  const normalLight = clampCosine(dotProduct(normal, lightDirection));
  if (normalView === 0 || normalLight === 0) return clearBsdfResult(target);

  const halfX = viewDirection[0] + lightDirection[0];
  const halfY = viewDirection[1] + lightDirection[1];
  const halfZ = viewDirection[2] + lightDirection[2];
  const halfLengthSquared = halfX * halfX + halfY * halfY + halfZ * halfZ;
  if (halfLengthSquared <= SSM_BSDF_MINIMUM_HALF_LENGTH_SQUARED) {
    return clearBsdfResult(target);
  }
  const inverseHalfLength = 1 / Math.sqrt(halfLengthSquared);
  const normalizedHalfX = halfX * inverseHalfLength;
  const normalizedHalfY = halfY * inverseHalfLength;
  const normalizedHalfZ = halfZ * inverseHalfLength;
  const normalHalf = clampCosine(normal[0] * normalizedHalfX +
    normal[1] * normalizedHalfY + normal[2] * normalizedHalfZ);
  const viewHalf = clampCosine(viewDirection[0] * normalizedHalfX +
    viewDirection[1] * normalizedHalfY + viewDirection[2] * normalizedHalfZ);

  const crossX = normal[1] * normalizedHalfZ - normal[2] * normalizedHalfY;
  const crossY = normal[2] * normalizedHalfX - normal[0] * normalizedHalfZ;
  const crossZ = normal[0] * normalizedHalfY - normal[1] * normalizedHalfX;
  const halfSineSquared = crossX * crossX + crossY * crossY + crossZ * crossZ;
  const roughness = Math.max(SSM_BSDF_MINIMUM_ROUGHNESS, surface.perceptualRoughness);
  const alpha = roughness * roughness;
  const alphaSquared = alpha * alpha;
  const distributionDenominator = halfSineSquared + alphaSquared * normalHalf * normalHalf;
  const distribution = alphaSquared / (Math.PI * distributionDenominator * distributionDenominator);
  const maskingView = normalLight * Math.sqrt(alphaSquared + (1 - alphaSquared) * normalView * normalView);
  const maskingLight = normalView * Math.sqrt(alphaSquared + (1 - alphaSquared) * normalLight * normalLight);
  const visibility = 0.5 / Math.max(maskingView + maskingLight, SSM_BSDF_MINIMUM_DENOMINATOR);
  const specularScale = distribution * visibility;
  const halfFresnelWeight = fifthPower(1 - viewHalf);
  const viewFresnelWeight = fifthPower(1 - normalView);
  const lightFresnelWeight = fifthPower(1 - normalLight);

  for (let channel = 0; channel < 3; channel += 1) {
    const specularF0 = surface.specularF0[channel];
    const fresnelRange = surface.specularF90 - specularF0;
    const halfFresnel = specularF0 + fresnelRange * halfFresnelWeight;
    const viewTransmission = 1 - (specularF0 + fresnelRange * viewFresnelWeight);
    const lightTransmission = 1 - (specularF0 + fresnelRange * lightFresnelWeight);
    target.diffuse[channel] = surface.diffuseReflectance[channel] *
      viewTransmission * lightTransmission / Math.PI;
    target.specular[channel] = halfFresnel * specularScale;
    target.total[channel] = target.diffuse[channel] + target.specular[channel];
  }
  return target;
}
