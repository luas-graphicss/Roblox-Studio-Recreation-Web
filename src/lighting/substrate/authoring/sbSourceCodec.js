import { SB_MATERIAL_TREE_FORMAT, SB_MATERIAL_TREE_FORMAT_VERSION, normalizeMaterialTree } from '../sbMaterialTreeCore.js';
import { validateAuthoringGraph, resolveAutoParameters } from '../sbAuthoringGraphCore.js';
import { canonicalJson } from '../sbTreeSerializationCore.js';
import { SB_SOURCE_CONTRACT_VERSION, SB_SOURCE_MAX_TEXT_BYTES, SB_SOURCE_ENVELOPE_KEYS } from './sbSourceContract.js';
import { copySourceData, freezeSourceData, isSourceRecord, preserveSourceInput, sourceRefusal } from './sbSourceData.js';
import { validateSourceTreeShape } from './sbSourceTreeValidation.js';

function unwrapSource(value) {
  if (!isSourceRecord(value)) return { refusal: sourceRefusal('invalidSourceEnvelope', '$', 'Source must be a material tree or versioned envelope') };
  if (Object.hasOwn(value, 'format') || Object.hasOwn(value, 'version')) {
    if (value.format !== SB_MATERIAL_TREE_FORMAT) return { refusal: sourceRefusal('unknownSourceFormat', '$/format', 'Unknown material tree format') };
    if (value.version !== SB_MATERIAL_TREE_FORMAT_VERSION) return { refusal: sourceRefusal('unknownSourceVersion', '$/version', 'Unknown material tree version; original source must be retained') };
    if (Object.keys(value).some(key => !SB_SOURCE_ENVELOPE_KEYS.includes(key))) return { refusal: sourceRefusal('unsupportedEnvelopeField', '$', 'Unknown envelope fields cannot be discarded') };
    return { root: value.root, conversions: [] };
  }
  const keys = Object.keys(value);
  if (keys.length === 1 && (keys[0] === 'root' || keys[0] === 'tree')) {
    return { root: value[keys[0]], conversions: [{ sourcePath: '$', operation: 'legacyEngineWrapper', replacement: SB_MATERIAL_TREE_FORMAT, reason: 'Existing engine wrapper without a format version', estimatedLoss: null, measuredLoss: null, evidenceStatus: 'exact' }] };
  }
  return { root: value, conversions: [] };
}

function describeParameterResolutions(authored, resolved, path = 'root') {
  const conversions = [];
  if (authored.type === 'bsdf' && authored.bsdf === 'slab') {
    for (const [name, value] of Object.entries(authored.parameters || {})) {
      const replacement = resolved.parameters[name];
      if (typeof value !== 'number' || value === replacement) continue;
      conversions.push({
        sourcePath: `${path}/parameters/${name}`,
        operation: 'sharedSlabParameterResolution',
        replacement,
        reason: name === 'anisotropyRotation' ? 'Shared half-turn angle wrapping; authored value is retained' : 'Shared second-lobe roughness floor; authored value is retained',
        estimatedLoss: null,
        measuredLoss: null,
        evidenceStatus: name === 'anisotropyRotation' ? 'exact' : 'unmeasured',
      });
    }
  }
  for (const [index, child] of (authored.children || []).entries()) conversions.push(...describeParameterResolutions(child, resolved.children[index], `${path}/${index}`));
  return conversions;
}

export function readSubstrateAuthoringSource(input) {
  const preservation = preserveSourceInput(input);
  const refuse = refusals => ({ ok: false, source: null, preservation, refusals, conversions: [] });
  try {
    let decoded = input;
    if (typeof input === 'string') {
      if (input.length > SB_SOURCE_MAX_TEXT_BYTES || new TextEncoder().encode(input).length > SB_SOURCE_MAX_TEXT_BYTES) return refuse([sourceRefusal('sourceTooLarge', '$', 'Source exceeds the 64 KiB text budget')]);
      try {
        decoded = JSON.parse(input);
      } catch {
        return refuse([sourceRefusal('invalidSourceJson', '$', 'Source is not valid JSON; original text must be retained')]);
      }
    }
    const copied = copySourceData(decoded);
    if (!copied.ok) return refuse(copied.refusals);
    const envelope = unwrapSource(copied.value);
    if (envelope.refusal) return refuse([envelope.refusal]);
    const shape = validateSourceTreeShape(envelope.root);
    if (!shape.ok) return refuse(shape.refusals);
    const normalization = normalizeMaterialTree(envelope.root);
    if (!normalization.ok) return refuse([sourceRefusal('invalidSourceTree', 'root', 'Shared normalization rejected the complete tree')]);
    function resolveMissingSlabValues(node) {
      if (node.type === 'bsdf' && node.bsdf === 'slab') {
        for (const name of Object.keys(node.parameters)) {
          if (node.parameters[name] === undefined) node.parameters[name] = null;
        }
      }
      for (const child of node.children || []) resolveMissingSlabValues(child);
    }
    resolveMissingSlabValues(normalization.root);
    const validation = validateAuthoringGraph(normalization.root);
    if (!validation.ok) return refuse(validation.refusals.map(({ code, path, reason }) => sourceRefusal(code, path, reason)));
    const canonicalEnvelope = { format: SB_MATERIAL_TREE_FORMAT, version: SB_MATERIAL_TREE_FORMAT_VERSION, root: envelope.root };
    const resolvedTree = resolveAutoParameters(normalization.root);
    const parameterResolutions = describeParameterResolutions(envelope.root, resolvedTree);
    const source = freezeSourceData({
      contractVersion: SB_SOURCE_CONTRACT_VERSION,
      format: SB_MATERIAL_TREE_FORMAT,
      version: SB_MATERIAL_TREE_FORMAT_VERSION,
      authoredTree: envelope.root,
      resolvedTree,
      canonicalText: canonicalJson(canonicalEnvelope),
    });
    return { ok: true, source, preservation, refusals: [], conversions: freezeSourceData([...envelope.conversions, ...shape.conversions, ...parameterResolutions]) };
  } catch {
    return refuse([sourceRefusal('unreadableSource', '$', 'Source could not be safely decoded')]);
  }
}

export function restoreSubstrateAuthoringSource(result) {
  const preservation = result?.preservation;
  return preservation?.snapshotAvailable ? preservation.snapshot : preservation?.input;
}
