import { isSourceRecord, sourceRefusal } from '../substrate/authoring/sbSourceData.js';

export const SSM_SOURCE_PRECEDENCE = Object.freeze(['tree', 'preset', 'legacy']);

export function isSubstrateSourceAbsent(value) {
  return value === undefined || value === null || value === '';
}

export function selectSubstrateSmSource(request) {
  if (!isSourceRecord(request)) return { ok: false, sourceKind: null, value: null, refusals: [sourceRefusal('invalidSourceRequest', '$', 'Source request must be a plain record')] };
  for (const sourceKind of SSM_SOURCE_PRECEDENCE) {
    const descriptor = Object.getOwnPropertyDescriptor(request, sourceKind);
    if (!descriptor) continue;
    if (!Object.hasOwn(descriptor, 'value')) return { ok: false, sourceKind, value: null, refusals: [sourceRefusal('invalidSourceProperty', `$/` + sourceKind, 'Source selection cannot execute a getter')] };
    if (!isSubstrateSourceAbsent(descriptor.value)) return { ok: true, sourceKind, value: descriptor.value, refusals: [] };
  }
  return { ok: true, sourceKind: 'legacy', value: {}, refusals: [] };
}

export function selectEngineSubstrateSource(basePartSource, surfaceAppearanceSource) {
  return isSubstrateSourceAbsent(basePartSource) ? surfaceAppearanceSource : basePartSource;
}
