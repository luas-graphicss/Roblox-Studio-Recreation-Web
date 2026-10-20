import { copySourceData, isSourceRecord, sourceRefusal } from '../substrate/authoring/sbSourceData.js';

function validRevision(value) {
  return (typeof value === 'string' && value.trim().length > 0) || (Number.isSafeInteger(value) && value >= 0);
}

export function validateSubstrateSmAssetReferences(references, root) {
  const copied = copySourceData(references);
  if (!copied.ok) return copied;
  if (!Array.isArray(copied.value)) return { ok: false, value: null, refusals: [sourceRefusal('invalidAssetReferences', '$/assetReferences', 'Asset references must be an array')] };
  const paths = new Set();
  function collect(node, path) {
    paths.add(path);
    for (const [index, child] of (node.children || []).entries()) collect(child, `${path}/${index}`);
  }
  collect(root, 'root');
  const identities = new Set();
  const refusals = [];
  function validateJsonMetadata(value, path) {
    if (value === undefined) {
      refusals.push(sourceRefusal('invalidAssetMetadata', path, 'Asset metadata must contain JSON values; undefined is not AUTO here'));
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) validateJsonMetadata(child, `${path}/${key}`);
    }
  }
  validateJsonMetadata(copied.value, '$/assetReferences');
  copied.value.forEach((reference, index) => {
    const path = `$/assetReferences/${index}`;
    if (!isSourceRecord(reference) || typeof reference.id !== 'string' || reference.id.trim() === '' || !validRevision(reference.revision)) {
      refusals.push(sourceRefusal('invalidAssetReference', path, 'Asset references require a nonempty id and explicit version revision'));
      return;
    }
    if (identities.has(reference.id)) refusals.push(sourceRefusal('duplicateAssetReference', path, 'Asset ids must be unique within one source'));
    identities.add(reference.id);
    if (reference.sourcePath !== undefined && !paths.has(reference.sourcePath)) refusals.push(sourceRefusal('unknownAssetSourcePath', `${path}/sourcePath`, 'Asset source path does not name an authored tree node'));
  });
  return { ok: refusals.length === 0, value: refusals.length ? null : copied.value, refusals };
}
