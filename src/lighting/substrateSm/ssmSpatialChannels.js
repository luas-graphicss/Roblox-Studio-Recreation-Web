import { SSM_RECIPE_FIELDS } from './ssmRecipeLayout.js';
import { serializeSubstrateSmKeyDescriptor } from './ssmKeySerialization.js';
import { copySubstrateSmImmutableData } from './ssmImmutableData.js';

const varyingFields = new Set([
  'diffuseReflectance', 'specularF0', 'perceptualRoughness', 'reflectionRoughness',
  'emissiveRadiance', 'extensionWeight', 'extensionRoughness', 'extensionTint',
  'diffuseWrap', 'anisotropy',
]);
const roughnessFields = new Set(['perceptualRoughness', 'reflectionRoughness', 'extensionRoughness']);

export function describeSubstrateSmSpatialComponent(name) {
  if (typeof name !== 'string') throw new TypeError('Spatial component names must be explicit');
  const [fieldName, componentName, extra] = name.split('.');
  const field = SSM_RECIPE_FIELDS[fieldName];
  const component = field?.components === 3 ? 'rgb'.indexOf(componentName ?? '') : 0;
  if (!varyingFields.has(fieldName) || extra !== undefined || !field
    || (field.components === 1 && componentName !== undefined)
    || (field.components === 3 && (componentName?.length !== 1 || component < 0))) {
    throw new TypeError(`Unsupported spatial component: ${name}`);
  }
  return Object.freeze({ name, fieldName, component, offset: field.offset + component,
    interpolation: roughnessFields.has(fieldName) ? 'ggx-alpha-squared' : 'linear' });
}

export function planSubstrateSmSpatialChannels(input, zeroPayload, onePayload) {
  const groups = JSON.parse(serializeSubstrateSmKeyDescriptor(input));
  if (!Array.isArray(groups) || groups.length < 1 || groups.length > 4) {
    throw new RangeError('Limited spatial mixing admits one to four target channels, not a second full recipe');
  }
  const visited = new Set();
  const channels = groups.map((names, targetIndex) => {
    if (!Array.isArray(names) || names.length < 1 || names.length > 3) {
      throw new TypeError('Each target channel requires one to three explicitly tied components');
    }
    const components = names.map(describeSubstrateSmSpatialComponent);
    const reference = components[0];
    for (const component of components) {
      if (visited.has(component.offset)) throw new TypeError('Spatial components cannot be repeated');
      visited.add(component.offset);
      if (component.interpolation !== reference.interpolation
        || zeroPayload[component.offset] !== zeroPayload[reference.offset]
        || onePayload[component.offset] !== onePayload[reference.offset]) {
        throw new Error('Tied channels require identical endpoint values and interpolation semantics');
      }
    }
    return { targetIndex, components, interpolation: reference.interpolation, targetValue: onePayload[reference.offset] };
  });
  for (let offset = 0; offset < zeroPayload.length; offset += 1) {
    if (!visited.has(offset) && zeroPayload[offset] !== onePayload[offset]) {
      throw new Error('An endpoint differs outside the explicitly budgeted spatial channels');
    }
  }
  return copySubstrateSmImmutableData(channels);
}

export function interpolateSubstrateSmSpatialValue(zero, one, weight, interpolation) {
  if (weight <= 0) return zero;
  if (weight >= 1) return one;
  if (interpolation === 'ggx-alpha-squared') {
    return ((1 - weight) * zero ** 4 + weight * one ** 4) ** 0.25;
  }
  return (1 - weight) * zero + weight * one;
}
