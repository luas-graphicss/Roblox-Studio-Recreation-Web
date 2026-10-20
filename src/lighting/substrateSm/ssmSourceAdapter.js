import { readSubstrateAuthoringSource } from '../substrate/authoring/sbSourceCodec.js';
import { copySourceData, freezeSourceData, isSourceRecord, isSourceRefusal, preserveSourceInput, sourceRefusal } from '../substrate/authoring/sbSourceData.js';
import { buildAuthoringPreset } from '../substrate/sbAuthoringPresetCatalog.js';
import { convertLegacyMaterialToTopology } from '../substrate/authoring/sbLegacyMaterialConversion.js';
import { legacyTopologyToMaterialTree } from '../substrate/sbLegacyTreeInteropCore.js';
import { legacyMaterialNames, SB_LEGACY_MATERIAL_FALLBACK_NAME } from '../substrate/sbLegacyMaterialTable.js';
import { selectSubstrateSmSource } from './ssmSourceSelection.js';
import { validateSubstrateSmAssetReferences } from './ssmSourceAssets.js';

export const SSM_SOURCE_ADAPTER_VERSION = 1;

function readRequestValue(request, name, fallback) {
  const descriptor = Object.getOwnPropertyDescriptor(request, name);
  if (!descriptor) return fallback;
  if (!Object.hasOwn(descriptor, 'value')) throw sourceRefusal('invalidSourceProperty', `$/` + name, 'Source metadata cannot execute getters');
  return descriptor.value === undefined ? fallback : descriptor.value;
}

function buildLegacySource(input) {
  const copied = copySourceData(input);
  if (!copied.ok) return copied;
  const request = copied.value;
  if (!isSourceRecord(request)) return { ok: false, refusals: [sourceRefusal('invalidLegacyRequest', '$/legacy', 'Legacy source must be an SB-F4 conversion request')] };
  const allowedKeys = ['materialName', 'surfaceColor', 'transparency'];
  if (Object.keys(request).some(key => !allowedKeys.includes(key))) return { ok: false, refusals: [sourceRefusal('unknownLegacyField', '$/legacy', 'Unknown legacy fields cannot be silently discarded')] };
  const materialName = request.materialName === undefined ? SB_LEGACY_MATERIAL_FALLBACK_NAME : request.materialName;
  if (!legacyMaterialNames().includes(materialName)) return { ok: false, refusals: [sourceRefusal('unknownLegacyMaterial', '$/legacy/materialName', 'Unknown explicit legacy material; fallback is not implicit')] };
  if (request.surfaceColor !== undefined && (!Array.isArray(request.surfaceColor) || request.surfaceColor.length !== 3 || !request.surfaceColor.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1))) {
    return { ok: false, refusals: [sourceRefusal('invalidLegacyColor', '$/legacy/surfaceColor', 'Legacy color requires three finite components in [0, 1]')] };
  }
  if (request.transparency !== undefined && (typeof request.transparency !== 'number' || !Number.isFinite(request.transparency) || request.transparency < 0 || request.transparency > 1)) {
    return { ok: false, refusals: [sourceRefusal('invalidLegacyTransparency', '$/legacy/transparency', 'Legacy transparency must be a finite number in [0, 1]')] };
  }
  return { ok: true, root: legacyTopologyToMaterialTree(convertLegacyMaterialToTopology({ ...request, materialName })), refusals: [] };
}

function buildSelectedSource(selection) {
  if (selection.sourceKind === 'tree') return { ok: true, root: selection.value, refusals: [] };
  if (selection.sourceKind === 'legacy') return buildLegacySource(selection.value);
  if (typeof selection.value !== 'string') return { ok: false, refusals: [sourceRefusal('invalidPresetId', '$/preset', 'Preset must be a canonical SB-F30 preset id')] };
  const preset = buildAuthoringPreset(selection.value);
  return preset.ok ? preset : { ...preset, refusals: preset.refusals.map(reason => sourceRefusal('unknownOrInvalidPreset', '$/preset', String(reason))) };
}

export function adaptSubstrateSmSource(request = {}) {
  let preservation = Object.freeze({ request, sourceKind: null, input: request, originalText: null });
  const refuse = refusals => ({ ok: false, source: null, preservation, refusals, conversions: [] });
  try {
    const selection = selectSubstrateSmSource(request);
    if (!selection.ok) return refuse(selection.refusals);
    preservation = Object.freeze({ request, sourceKind: selection.sourceKind, ...preserveSourceInput(selection.value) });
    const sourceRevision = readRequestValue(request, 'sourceRevision', 0);
    if (!Number.isSafeInteger(sourceRevision) || sourceRevision < 0) return refuse([sourceRefusal('invalidSourceRevision', '$/sourceRevision', 'Source revision must be a nonnegative safe integer')]);
    const selected = buildSelectedSource(selection);
    if (!selected.ok) return refuse(selected.refusals);
    const decoded = readSubstrateAuthoringSource(selected.root);
    if (!decoded.ok) return refuse(decoded.refusals);
    const references = validateSubstrateSmAssetReferences(readRequestValue(request, 'assetReferences', []), decoded.source.resolvedTree);
    if (!references.ok) return refuse(references.refusals);
    const source = freezeSourceData({
      ...decoded.source,
      adapterVersion: SSM_SOURCE_ADAPTER_VERSION,
      sourceKind: selection.sourceKind,
      sourceRevision,
      assetReferences: references.value,
    });
    return { ok: true, source, preservation, refusals: [], conversions: decoded.conversions };
  } catch (error) {
    return refuse([isSourceRefusal(error) ? error : sourceRefusal('unreadableSourceRequest', '$', 'Source request could not be safely inspected')]);
  }
}
