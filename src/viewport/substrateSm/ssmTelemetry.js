import { copySubstrateSmDiagnosticData, readSubstrateSmDiagnosticSource,
  readSubstrateSmProgramDescriptor, substrateSmBindingStamp } from './ssmDiagnosticData.js';
import { attachSubstrateSmTelemetryStore } from './ssmTelemetryStore.js';

function requireLimit(value, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new RangeError('SSM_QA_REGISTRY_LIMIT_INVALID');
  return value;
}

function requireIdentifier(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new TypeError('SSM_QA_IDENTIFIER_REQUIRED');
}

export function createSubstrateSmTelemetry({ maxMaterials = 1024, maxEvents = 64 } = {}) {
  requireLimit(maxMaterials, 4096);
  requireLimit(maxEvents, 256);
  const store = { records: new Map(), providers: new Map(), events: [], revision: 0,
    sequence: 0, nextRegistration: 0, disposed: false, lastCapture: null };
  const materialOwners = new WeakMap();

  function recordEvent(type, details = null) {
    if (store.disposed) return false;
    requireIdentifier(type);
    store.events.push(Object.freeze({ sequence: ++store.sequence, type, details: copySubstrateSmDiagnosticData(details) }));
    if (store.events.length > maxEvents) store.events.shift();
    return true;
  }

  function unregisterMaterial(materialId) {
    const record = store.records.get(materialId);
    if (!record) return false;
    record.material.removeEventListener?.('dispose', record.onDispose);
    materialOwners.delete(record.material);
    store.records.delete(materialId);
    store.revision += 1;
    recordEvent('material-unregistered', { materialId });
    return true;
  }

  function registerMaterial({ materialId, material, binding, readMetadata } = {}) {
    if (store.disposed) throw new Error('SSM_QA_TELEMETRY_DISPOSED');
    requireIdentifier(materialId);
    if (!material || typeof material !== 'object' || typeof binding?.getState !== 'function') {
      throw new TypeError('SSM_QA_MATERIAL_BINDING_REQUIRED');
    }
    if (readMetadata !== undefined && typeof readMetadata !== 'function') throw new TypeError('SSM_QA_METADATA_READER_REQUIRED');
    if (store.records.has(materialId) || materialOwners.has(material)) throw new Error('SSM_QA_MATERIAL_ALREADY_REGISTERED');
    if (store.records.size >= maxMaterials) throw new Error('SSM_QA_MATERIAL_LIMIT');
    const record = { materialId, material, binding, readMetadata, registrationId: ++store.nextRegistration,
      onDispose: () => unregisterMaterial(materialId) };
    material.addEventListener?.('dispose', record.onDispose);
    store.records.set(materialId, record);
    materialOwners.set(material, record);
    store.revision += 1;
    recordEvent('material-registered', { materialId });
    return () => store.records.get(materialId) === record && unregisterMaterial(materialId);
  }

  function registerProvider(name, reader) {
    if (store.disposed) throw new Error('SSM_QA_TELEMETRY_DISPOSED');
    requireIdentifier(name);
    if (typeof reader !== 'function') throw new TypeError('SSM_QA_PROVIDER_REQUIRED');
    if (store.providers.has(name)) throw new Error('SSM_QA_PROVIDER_ALREADY_REGISTERED');
    if (store.providers.size >= 16) throw new Error('SSM_QA_PROVIDER_LIMIT');
    store.providers.set(name, reader);
    return () => store.providers.get(name) === reader && store.providers.delete(name);
  }

  function getSnapshot() {
    const counts = { registered: store.records.size, shaderCommitted: 0, programConfirmed: 0,
      renderedInLastCapture: 0, drawCallsInLastCapture: 0 };
    const materials = [];
    for (const record of store.records.values()) {
      let rawState;
      const binding = readSubstrateSmDiagnosticSource(() => { rawState = record.binding.getState(); return rawState; });
      const state = binding.value;
      const metadata = readSubstrateSmDiagnosticSource(record.readMetadata);
      const decision = metadata.value?.decision;
      const descriptor = readSubstrateSmProgramDescriptor(rawState?.programKey);
      const receipt = store.lastCapture?.materials.find(item => item.materialId === record.materialId);
      const receiptCurrent = binding.available && receipt?.stamp === substrateSmBindingStamp(rawState)
        && receipt?.registrationId === record.registrationId && store.lastCapture?.ok === true;
      const rendered = receiptCurrent && receipt.drawCalls > 0;
      const committed = (state?.shaderCommitted ?? state?.applied) === true && state?.disposed !== true;
      const confirmed = committed && state?.gpuVerified === true;
      counts.shaderCommitted += Number(committed);
      counts.programConfirmed += Number(confirmed);
      counts.renderedInLastCapture += Number(rendered);
      counts.drawCallsInLastCapture += rendered ? receipt.drawCalls : 0;
      materials.push(copySubstrateSmDiagnosticData({
        materialId: record.materialId, materialType: record.material.type ?? null,
        state: state?.state ?? null, reason: binding.reason ?? state?.reason ?? decision?.code ?? null,
        backend: rendered ? 'substrateSm' : null,
        plannedBackend: decision?.backend ?? null, targetBackend: decision?.targetBackend ?? null,
        family: descriptor?.family ?? decision?.family ?? null,
        requestedQuality: decision?.requestedQuality ?? null, effectiveQuality: decision?.effectiveQuality ?? null,
        sourceRevision: state?.sourceRevision ?? null, contextGeneration: state?.contextGeneration ?? null,
        programGeneration: descriptor?.patchGeneration ?? null,
        programHash: rawState?.programKey?.hash ?? null, recipeHash: rawState?.recipeKey?.hash ?? null,
        sourceHash: metadata.value?.sourceKey?.hash ?? null, uniformRevision: state?.uniformRevision ?? null,
        registered: true, shaderCommitted: committed, programConfirmed: confirmed,
        renderedInLastCapture: Boolean(rendered), lastCaptureId: store.lastCapture?.captureId ?? null,
        evidenceCurrent: Boolean(receiptCurrent), bindingAvailable: binding.available,
        metadataAvailable: metadata.available, metadataReason: metadata.reason,
        losses: metadata.value?.lossReport ?? null, routingBudget: decision?.budget ?? null,
        actualResources: rendered ? receipt.resources : null, counters: state?.counters ?? null,
      }));
    }
    const providers = Object.fromEntries([...store.providers].map(([name, reader]) => [name, readSubstrateSmDiagnosticSource(reader)]));
    return Object.freeze({ schemaVersion: 1, disposed: store.disposed, registryRevision: store.revision,
      counts: Object.freeze(counts), materials: Object.freeze(materials), providers: Object.freeze(providers),
      lastCapture: store.lastCapture?.summary ?? null, events: Object.freeze([...store.events]),
      measurementScope: 'on-demand-diagnostics', performanceCertified: false });
  }

  function dispose() {
    if (store.disposed) return;
    for (const id of [...store.records.keys()]) unregisterMaterial(id);
    store.providers.clear();
    store.events.length = 0;
    store.lastCapture = null;
    store.disposed = true;
  }

  const telemetry = Object.freeze({ registerMaterial, unregisterMaterial, registerProvider, recordEvent, getSnapshot, dispose });
  attachSubstrateSmTelemetryStore(telemetry, store);
  return telemetry;
}
