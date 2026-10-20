import {
  SSM_RECIPE_VERSION,
  SSM_RECIPE_LAYOUT,
  SSM_PROFILES,
} from './ssmContract.js';
import { copySubstrateSmImmutableData } from './ssmImmutableData.js';
import { createSubstrateSmCompilationRefusal } from './ssmValidationCore.js';

export const SSM_COMPILER_VERSION = 1;

function collectParameterProblems(parameters) {
  const problems = [];
  const fields = SSM_RECIPE_LAYOUT.fields;
  const fieldNames = new Set(fields.map(field => field.name));
  for (const name of Object.keys(parameters)) {
    if (!fieldNames.has(name)) problems.push(`${name} is not a recipe parameter`);
  }
  for (const field of fields) {
    const value = parameters[field.name];
    const components = field.components === 1 ? [value] : value;
    if (field.components === 1 && Array.isArray(value)) {
      problems.push(`${field.name} must be a scalar`);
      continue;
    }
    if (!Array.isArray(components) || components.length !== field.components) {
      problems.push(`${field.name} requires ${field.components} components`);
      continue;
    }
    if (!Array.from(components).every(component => typeof component === 'number' && Number.isFinite(Math.fround(component)))) {
      problems.push(`${field.name} requires finite float32-representable numbers`);
    }
    if (field.name === 'reserved' || field.name === 'reservedVector') {
      if (components.some(component => component !== 0)) problems.push(`${field.name} must remain zero`);
    }
  }
  return problems;
}

function collectPhysicalRangeProblems(parameters) {
  const problems = [];
  const unitFields = [
    'diffuseReflectance', 'specularF0', 'coverage', 'opacity', 'perceptualRoughness',
    'extensionWeight', 'extensionRoughness', 'extensionTint', 'diffuseWrap',
    'specularF90', 'reflectionRoughness', 'thinTransmissionWeight',
  ];
  for (const name of unitFields) {
    const values = Array.isArray(parameters[name]) ? parameters[name] : [parameters[name]];
    if (values.some(value => value < 0 || value > 1)) problems.push(`${name} must be within [0, 1]`);
  }
  for (const name of ['emissiveRadiance', 'extinctionCoefficient', 'layerThickness']) {
    const values = Array.isArray(parameters[name]) ? parameters[name] : [parameters[name]];
    if (values.some(value => value < 0)) problems.push(`${name} must be nonnegative`);
  }
  if (parameters.anisotropy < -1 || parameters.anisotropy > 1) {
    problems.push('anisotropy must be within [-1, 1]');
  }
  return problems;
}

export function createSubstrateSmCompiledRecipe(surface, profile = 'Lite') {
  const problems = [];
  if (typeof profile !== 'string' || !Object.hasOwn(SSM_PROFILES, profile)) {
    problems.push('The effective compilation profile is unknown');
  } else if (!SSM_PROFILES[profile].families.includes(surface?.family)) {
    problems.push('The selected family is not admitted by the effective profile');
  }
  if (!surface?.parameters || typeof surface.parameters !== 'object' || Array.isArray(surface.parameters)) {
    problems.push('The reduction stage did not produce a parameter object');
  } else {
    problems.push(...collectParameterProblems(surface.parameters));
    if (problems.length === 0) problems.push(...collectPhysicalRangeProblems(surface.parameters));
  }
  if (problems.length > 0) {
    return copySubstrateSmImmutableData({
      ok: false,
      recipe: null,
      refusals: problems.map(reason => createSubstrateSmCompilationRefusal('invalidCompiledRecipe', 'root', reason)),
    });
  }
  return copySubstrateSmImmutableData({
    ok: true,
    recipe: {
      version: SSM_RECIPE_VERSION,
      compilerVersion: SSM_COMPILER_VERSION,
      family: surface.family,
      profile,
      parameters: surface.parameters,
    },
    refusals: [],
  });
}
