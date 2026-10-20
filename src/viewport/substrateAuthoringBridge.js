import { readSubstrateAuthoringSource } from '../lighting/substrate/authoring/sbSourceCodec.js';
import { SB_SOURCE_MAX_TEXT_BYTES } from '../lighting/substrate/authoring/sbSourceContract.js';

export function parseSubstrateMaterial(source) {
  if (source == null || source === '') return { tree: null, error: null };
  if (typeof source !== 'string' || source.length > SB_SOURCE_MAX_TEXT_BYTES) return { tree: null, error: 'SubstrateMaterial must be JSON text under 64 KiB' };
  const result = readSubstrateAuthoringSource(source);
  if (!result.ok) return { tree: null, error: result.refusals.map(refusal => `${refusal.path}: ${refusal.reason} [${refusal.code}]`).join('; ') };
  return { tree: JSON.parse(result.source.canonicalText).root, error: null };
}

export function setSubstrateMaterialSource(material, source = '') {
  if (!material) return false;
  const data = material.userData ??= {};
  if (data.__rswSubstrateSource === source) return false;
  const result = parseSubstrateMaterial(source);
  data.__rswSubstrateSource = source;
  data.__rswSbAuthoringError = result.error;
  if (result.tree) data.sbAuthoredTree = result.tree;
  else delete data.sbAuthoredTree;
  delete data.__rswSbSourceSignature;
  delete data.sbSceneTree;
  material.needsUpdate = true;
  return !result.error;
}

export function synchronizeSubstrateAuthoring(object, record) {
  if (!object || !record) return;
  const source = record.substrateMaterial || record.appearance?.surface?.substrateMaterial || '';
  const apply = node => {
    if (node.userData?.rswDecal || !node.material) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) setSubstrateMaterialSource(material, source);
  };
  if (typeof object.traverse === 'function') object.traverse(apply);
  else apply(object);
}
