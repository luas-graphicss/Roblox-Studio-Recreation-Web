import { createSubstrateSmBsdfResult, evaluateSubstrateSmBsdf } from './ssmBsdfCore.js';
import {
  SSM_SHEEN_MINIMUM_EXPONENT,
  SSM_SHEEN_MAXIMUM_EXPONENT,
} from './ssmSheenContract.js';

function dotProduct(first, second) {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

function clampUnit(value) {
  return Math.max(0, Math.min(1, value));
}

function requireUnitInterval(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`SSM sheen ${name} must be a finite number in [0, 1]`);
  }
  return value;
}

function requireTint(value) {
  if (!value || value.length !== 3) throw new TypeError('SSM sheen extensionTint must contain three channels');
  for (let channel = 0; channel < 3; channel += 1) requireUnitInterval(value[channel], `extensionTint[${channel}]`);
  return value;
}

export function resolveSubstrateSmSheenExponent(fuzzRoughness) {
  requireUnitInterval(fuzzRoughness, 'extensionRoughness');
  return SSM_SHEEN_MAXIMUM_EXPONENT - (SSM_SHEEN_MAXIMUM_EXPONENT - SSM_SHEEN_MINIMUM_EXPONENT) * fuzzRoughness;
}

export function resolveSubstrateSmSheenNormalization(exponent) {
  return (exponent + 1) * (exponent + 2) / (2 * Math.PI);
}

export function evaluateSubstrateSmSheenGrazing(cosine, exponent) {
  return Math.pow(Math.max(0, 1 - clampUnit(cosine)), exponent);
}

export function evaluateSubstrateSmSheenDirectionalAlbedo(surface, viewCosine) {
  const amount = requireUnitInterval(surface.extensionWeight, 'extensionWeight');
  const tint = requireTint(surface.extensionTint);
  const exponent = resolveSubstrateSmSheenExponent(surface.extensionRoughness);
  const grazing = evaluateSubstrateSmSheenGrazing(viewCosine, exponent);
  return tint.map(channel => amount * channel * grazing);
}

function resolveSheenTerms(surface, normal, viewDirection, lightDirection) {
  const amount = requireUnitInterval(surface.extensionWeight, 'extensionWeight');
  const tint = requireTint(surface.extensionTint);
  const exponent = resolveSubstrateSmSheenExponent(surface.extensionRoughness);
  const normalView = clampUnit(dotProduct(normal, viewDirection));
  const normalLight = clampUnit(dotProduct(normal, lightDirection));
  if (amount === 0 || normalView === 0 || normalLight === 0) return { remaining: 1, fiber: 0, tint };
  const grazingView = evaluateSubstrateSmSheenGrazing(normalView, exponent);
  const grazingLight = evaluateSubstrateSmSheenGrazing(normalLight, exponent);
  return {
    remaining: (1 - amount * grazingView) * (1 - amount * grazingLight),
    fiber: amount * grazingView * grazingLight * resolveSubstrateSmSheenNormalization(exponent),
    tint,
  };
}

export function evaluateSubstrateSmSheenFiberTerm({ surface, normal, viewDirection, lightDirection }, target = [0, 0, 0]) {
  const { fiber, tint } = resolveSheenTerms(surface, normal, viewDirection, lightDirection);
  for (let channel = 0; channel < 3; channel += 1) target[channel] = tint[channel] * fiber;
  return target;
}

export function evaluateSubstrateSmSheenBsdf(
  { surface, normal, viewDirection, lightDirection },
  target = createSubstrateSmBsdfResult(),
) {
  evaluateSubstrateSmBsdf({ surface, normal, viewDirection, lightDirection }, target);
  const { remaining, fiber, tint } = resolveSheenTerms(surface, normal, viewDirection, lightDirection);
  if (fiber === 0 && remaining === 1) return target;
  for (let channel = 0; channel < 3; channel += 1) {
    target.diffuse[channel] *= remaining;
    target.specular[channel] = target.specular[channel] * remaining + tint[channel] * fiber;
    target.total[channel] = target.diffuse[channel] + target.specular[channel];
  }
  return target;
}
