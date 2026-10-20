import { SSM_CONTRACT_VERSION, SSM_RECIPE_VERSION, SSM_FAMILIES, SSM_PROFILES } from './ssmContract.js';
import { hashSubstrateSmKeySignature, serializeSubstrateSmKeyDescriptor } from './ssmKeySerialization.js';

const SSM_KEY_KINDS = Object.freeze(['source', 'recipe', 'program', 'batch']);
const SSM_KEY_VERSION = 1;

function requireText(value, name) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a nonempty string`);
  return value;
}

function requireVersion(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(`${name} must be a safe revision`);
  return value;
}

function keyPrefix(kind) {
  return `ssm/${kind}/v${SSM_KEY_VERSION}:`;
}

function createKey(kind, descriptor, hashSignature) {
  const signature = keyPrefix(kind) + serializeSubstrateSmKeyDescriptor(descriptor);
  const hash = hashSignature(signature);
  if (typeof hash !== 'string' || hash.length === 0 || hash.length > 128) {
    throw new TypeError('SSM diagnostic hashes must be bounded nonempty strings');
  }
  return Object.freeze({ kind, hash, signature });
}

export function assertSubstrateSmKey(key, expectedKind) {
  if (!key || !SSM_KEY_KINDS.includes(key.kind) || (expectedKind && key.kind !== expectedKind)
    || typeof key.signature !== 'string' || !key.signature.startsWith(keyPrefix(key.kind))
    || key.signature.length <= keyPrefix(key.kind).length || key.signature.length > 1048640
    || typeof key.hash !== 'string' || key.hash.length === 0 || key.hash.length > 128) {
    throw new TypeError(`Invalid SSM ${expectedKind || 'identity'} key`);
  }
  return key;
}

export function areSubstrateSmKeysEqual(first, second) {
  return first != null && second != null && first.kind === second.kind && first.signature === second.signature;
}

function sortedDescriptors(values, name) {
  if (!Array.isArray(values)) throw new TypeError(`${name} must be an array`);
  return values.map(value => serializeSubstrateSmKeyDescriptor(value)).sort();
}

export function createSubstrateSmSourceKey(source, hashSignature = hashSubstrateSmKeySignature) {
  return createKey('source', {
    contractVersion: requireVersion(source.contractVersion, 'contractVersion', 1),
    adapterVersion: requireVersion(source.adapterVersion, 'adapterVersion', 1),
    format: requireText(source.format, 'format'),
    version: requireVersion(source.version, 'version', 1),
    canonicalText: requireText(source.canonicalText, 'canonicalText'),
    assetReferences: sortedDescriptors(source.assetReferences, 'assetReferences'),
  }, hashSignature);
}

export function createSubstrateSmRecipeKey({ sourceKey, profile, compilerVersion, mapPlan = {}, geometry = {} },
  hashSignature = hashSubstrateSmKeySignature) {
  assertSubstrateSmKey(sourceKey, 'source');
  if (!Object.hasOwn(SSM_PROFILES, profile)) throw new TypeError('Unknown SSM recipe profile');
  return createKey('recipe', {
    contractVersion: SSM_CONTRACT_VERSION,
    recipeVersion: SSM_RECIPE_VERSION,
    source: sourceKey.signature,
    profile,
    compilerVersion: requireVersion(compilerVersion, 'compilerVersion', 1),
    mapPlan,
    geometry,
  }, hashSignature);
}

export function createSubstrateSmProgramKey({ family, hostBackend, structuralVariant, patchGeneration, mapBindings = [] },
  hashSignature = hashSubstrateSmKeySignature) {
  if (!SSM_FAMILIES.includes(family)) throw new TypeError('Unknown SSM shader family');
  if (!Array.isArray(mapBindings) || mapBindings.some(binding => typeof binding !== 'string')) {
    throw new TypeError('SSM program mapBindings must contain structural strings, not resource objects');
  }
  return createKey('program', {
    contractVersion: SSM_CONTRACT_VERSION,
    recipeVersion: SSM_RECIPE_VERSION,
    family,
    hostBackend: requireText(hostBackend, 'hostBackend'),
    structuralVariant: requireText(structuralVariant, 'structuralVariant'),
    patchGeneration: requireVersion(patchGeneration, 'patchGeneration'),
    mapBindings: [...new Set(mapBindings)].sort(),
  }, hashSignature);
}

export function createSubstrateSmBatchKey({ hostBatchKey, recipeKey, resources = [] },
  hashSignature = hashSubstrateSmKeySignature) {
  assertSubstrateSmKey(recipeKey, 'recipe');
  return createKey('batch', {
    hostBatchKey: requireText(hostBatchKey, 'hostBatchKey'),
    recipe: recipeKey.signature,
    resources: sortedDescriptors(resources, 'resources'),
  }, hashSignature);
}
