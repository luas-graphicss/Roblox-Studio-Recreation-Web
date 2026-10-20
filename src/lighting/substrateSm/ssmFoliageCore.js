import { createSubstrateSmBsdfResult, evaluateSubstrateSmBsdf } from './ssmBsdfCore.js';
import {
  SSM_FOLIAGE_MAXIMUM_PHASE,
  SSM_FOLIAGE_TRANSMISSION_SOURCES,
} from './ssmFoliageContract.js';

function dotProduct(first, second) {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

function clampUnit(value) {
  return Math.max(0, Math.min(1, value));
}

function fifthPower(value) {
  const squared = value * value;
  return squared * squared * value;
}

function requireUnitInterval(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`SSM foliage ${name} must be a finite number in [0, 1]`);
  }
  return value;
}

function requireTint(value) {
  if (!value || value.length !== 3) throw new TypeError('SSM foliage extensionTint must contain three channels');
  for (let channel = 0; channel < 3; channel += 1) requireUnitInterval(value[channel], `extensionTint[${channel}]`);
  return value;
}

function requireRadiance(value, name) {
  if (!value || value.length !== 3) throw new TypeError(`SSM foliage ${name} requires three channels`);
  for (const channel of value) {
    if (!Number.isFinite(channel) || channel < 0) throw new RangeError(`SSM foliage ${name} must be finite and nonnegative`);
  }
  return value;
}

export function createSubstrateSmFoliageResult() {
  return {
    diffuse: [0, 0, 0],
    specular: [0, 0, 0],
    transmission: [0, 0, 0],
    total: [0, 0, 0],
    transmissionSource: SSM_FOLIAGE_TRANSMISSION_SOURCES.fallback,
  };
}

export function createSubstrateSmFoliageWorkspace() {
  return { base: createSubstrateSmBsdfResult() };
}

export function resolveSubstrateSmFoliageForwardPhase(extensionRoughness) {
  requireUnitInterval(extensionRoughness, 'extensionRoughness');
  return Math.min(SSM_FOLIAGE_MAXIMUM_PHASE, Math.max(0, 1 - extensionRoughness));
}

export function evaluateSubstrateSmFoliageWrappedCosine(normalLight, wrap) {
  return clampUnit((normalLight + wrap) / (1 + wrap));
}

export function evaluateSubstrateSmFoliagePhase(cosine, phase) {
  const denominator = 1 + phase * phase - 2 * phase * cosine;
  return (1 - phase * phase) / (4 * Math.PI * denominator * Math.sqrt(denominator));
}

export function evaluateSubstrateSmFoliageTransmissionShape(cosine, phase) {
  return (1 - phase) / Math.PI + phase * evaluateSubstrateSmFoliagePhase(cosine, phase);
}

export function evaluateSubstrateSmFoliageLightContribution(
  { surface, normal, viewDirection, lightDirection, visibleRadiance, transmissionRadiance = null },
  target = createSubstrateSmFoliageResult(),
  workspace = createSubstrateSmFoliageWorkspace(),
) {
  requireRadiance(visibleRadiance, 'visibleRadiance');
  const wrap = requireUnitInterval(surface.diffuseWrap, 'diffuseWrap');
  const transmissionWeight = requireUnitInterval(surface.thinTransmissionWeight, 'thinTransmissionWeight');
  const transmissionTint = requireTint(surface.extensionTint);
  const phase = resolveSubstrateSmFoliageForwardPhase(surface.extensionRoughness);
  const backRadiance = transmissionRadiance === null ? visibleRadiance : requireRadiance(transmissionRadiance, 'transmissionRadiance');
  target.transmissionSource = transmissionRadiance === null
    ? SSM_FOLIAGE_TRANSMISSION_SOURCES.fallback
    : SSM_FOLIAGE_TRANSMISSION_SOURCES.host;
  evaluateSubstrateSmBsdf({ surface, normal, viewDirection, lightDirection }, workspace.base);
  const normalView = clampUnit(dotProduct(normal, viewDirection));
  const normalLight = dotProduct(normal, lightDirection);
  const frontCosine = clampUnit(normalLight);
  const backCosine = clampUnit(-normalLight);
  const wrappedCosine = evaluateSubstrateSmFoliageWrappedCosine(normalLight, wrap);
  const viewWeight = fifthPower(1 - normalView);
  const wrappedWeight = fifthPower(1 - wrappedCosine);
  const diffuseScale = normalView > 0 ? wrappedCosine / ((1 + wrap) * Math.PI) : 0;
  const transmissionScale = transmissionWeight > 0 && backCosine > 0 && normalView > 0
    ? transmissionWeight * backCosine * evaluateSubstrateSmFoliageTransmissionShape(-dotProduct(lightDirection, viewDirection), phase)
    : 0;
  for (let channel = 0; channel < 3; channel += 1) {
    const specularF0 = surface.specularF0[channel];
    const fresnelRange = surface.specularF90 - specularF0;
    const viewTransmission = 1 - (specularF0 + fresnelRange * viewWeight);
    const lightTransmission = 1 - (specularF0 + fresnelRange * wrappedWeight);
    target.diffuse[channel] = surface.diffuseReflectance[channel] * viewTransmission * lightTransmission *
      diffuseScale * visibleRadiance[channel];
    target.specular[channel] = workspace.base.specular[channel] * frontCosine * visibleRadiance[channel];
    target.transmission[channel] = transmissionTint[channel] * transmissionScale * backRadiance[channel];
    target.total[channel] = target.diffuse[channel] + target.specular[channel] + target.transmission[channel];
  }
  return target;
}
