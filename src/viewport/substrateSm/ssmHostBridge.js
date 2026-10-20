import { createSubstrateSmReleasePolicy } from '../../lighting/substrateSm/ssmReleasePolicyCore.js';
import { createSubstrateSmHostMaterialRegistry, isSubstrateSmSourceProperty } from './ssmHostMaterialRegistry.js';
import { createSubstrateSmHostMaterialDescriber } from './ssmHostMaterialDescriber.js';
import { createSubstrateSmLifecycleMaterialAdapter } from './ssmLifecycleMaterialAdapter.js';
import { createSubstrateSmProgramWarmup } from './ssmProgramWarmup.js';
import { createSubstrateSmDrawObserver } from './ssmDrawObserver.js';

const RETRY_ON_DRAW_REASONS = new Set([
  'SSM_LIFECYCLE_LINK_TIMEOUT', 'SSM_LIFECYCLE_WARMUP_TIMEOUT', 'SSM_LIFECYCLE_STALE_JOB',
  'SSM_BINDING_PROGRAM_NOT_SELECTED', 'SSM_LIFECYCLE_QUEUE_FULL',
]);
const RETRY_FRAME_INTERVAL = 30;
const MAX_SLICE_OPERATIONS = 16;
const SLICE_BUDGET_MS = 4;

function ownerId(instance) {
  if (instance?.className === 'SurfaceAppearance') return instance.parent?.id ?? null;
  return instance?.id ?? null;
}

function firstMesh(record) {
  for (const mesh of record.meshes) return mesh;
  return null;
}


function createDescriber(setup, THREE, renderer) {
  if (typeof setup.describeMaterial === 'function') {
    return { evidence: true, describe: setup.describeMaterial, readHost: () => null, invalidateHost() {} };
  }
  try {
    return { evidence: true, ...createSubstrateSmHostMaterialDescriber({ THREE, renderer }) };
  } catch {
    return {
      evidence: false,
      describe: (record, configuration) => Object.freeze({
        ok: false, reason: 'SSM_HOST_EVIDENCE_UNAVAILABLE', sourceRevision: record.revision,
        contextGeneration: configuration.contextGeneration, projectGeneration: configuration.projectGeneration,
      }),
      readHost: () => null,
      invalidateHost() {},
    };
  }
}

export function createSubstrateSmHostBridge(setup = {}) {
  const THREE = setup.THREE;
  const renderer = setup.renderer;
  const releasePolicy = createSubstrateSmReleasePolicy(setup.releaseManifest);
  const describer = createDescriber(setup, THREE, renderer);
  const createWarmup = typeof setup.createWarmup === 'function' ? setup.createWarmup : createSubstrateSmProgramWarmup;
  const requestRender = typeof setup.requestRender === 'function' ? setup.requestRender : () => setup.onStateChanged?.();
  const now = typeof setup.now === 'function' ? setup.now : () => performance.now();
  const meshRecords = new Map();
  let configuration = null;
  let warmup = null;
  let disposed = false;
  let sliceFrame = 0;
  let hostFrame = 0;
  let permissionSnapshot = null;
  const counters = { describes: 0, requests: 0, retries: 0, draws: 0, confirmedDraws: 0, sliceOperations: 0 };
  const registry = createSubstrateSmHostMaterialRegistry({
    maxMaterials: 1024,
    onInvalidate: refreshRecord,
    onRemove: removeRecord,
  });
  const observer = createSubstrateSmDrawObserver(onDraw);

  function lifecycleState(record) {
    return record.lifecycle?.getState() ?? null;
  }

  function dropLifecycle(record, reason) {
    if (record.lifecycle) {
      try { record.lifecycle.cancel(reason); } catch {                                 }
      warmup?.unregister(record.lifecycle);
      record.lifecycle = null;
    }
  }

  function dropAdapter(record) {
    if (record.adapter) {
      record.adapter.dispose();
      record.adapter = null;
    }
  }

  function unobserveRecord(record) {
    for (const mesh of record.meshes) {
      const set = meshRecords.get(mesh);
      if (!set) continue;
      set.delete(record);
      if (set.size === 0) {
        meshRecords.delete(mesh);
        observer.release(mesh);
      }
    }
  }

  function observeRecord(record) {
    for (const mesh of record.meshes) {
      let set = meshRecords.get(mesh);
      if (!set) {
        set = new Set();
        meshRecords.set(mesh, set);
        observer.observe(mesh);
      }
      set.add(record);
    }
  }

  function removeRecord(record, reason) {
    unobserveRecord(record);
    dropLifecycle(record, reason);
    dropAdapter(record);
    record.request = null;
    record.description = null;
    record.reason = reason;
  }

  function ensureWarmup() {
    if (warmup) return warmup;
    warmup = createWarmup({
      profile: configuration.quality === 'Moderate' ? 'Moderate' : 'Lite',
      canvas: renderer?.domElement,
      contextGeneration: configuration.contextGeneration,
      projectGeneration: configuration.projectGeneration,
      now,
      onRestore: () => registry.invalidateAll('SSM_HOST_CONTEXT_RESTORED'),
    });
    return warmup;
  }

  function settleReason(record, accepted) {
    const state = lifecycleState(record);
    if (!state) return 'SSM_HOST_WARMUP_UNAVAILABLE';
    if (state.applied) return null;
    if (accepted || state.state === 'preparing' || state.state === 'ready') return 'SSM_PREPARATION_PENDING';
    return state.reason ?? 'SSM_LIFECYCLE_REQUEST_REFUSED';
  }

  function refreshRecord(record) {
    if (disposed || !configuration || record.removed) return;
    counters.describes += 1;
    record.request = null;
    record.lastRetryFrame = -1;
    const host = describer.readHost(configuration);
    const targetsPreview = record.description?.releaseTargets;
    const permission = releasePolicy.resolve({
      enabled: configuration.enabled,
      softwareRenderer: host ? host.softwareRenderer : true,
      targets: Array.isArray(targetsPreview) && targetsPreview.length ? targetsPreview : undefined,
    });
    permissionSnapshot = permission;
    record.permission = permission;
    if (permission.status !== 'permitted') {
      record.reason = permission.code;
      record.lifecycle?.disable(permission.code);
      return;
    }
    const description = describer.describe(record, configuration, permission.release);
    record.description = description;
    if (!description || description.sourceRevision !== record.revision
      || description.contextGeneration !== configuration.contextGeneration
      || description.projectGeneration !== configuration.projectGeneration) {
      record.reason = 'SSM_HOST_DESCRIPTION_STALE';
      record.lifecycle?.disable(record.reason);
      return;
    }
    if (!description.ok) {
      record.reason = description.reason;
      record.lifecycle?.disable(description.reason);
      return;
    }
    ensureWarmup();
    if (record.adapter && record.adapter.materialPath !== description.materialPath) {
      dropLifecycle(record, 'SSM_HOST_PATH_CHANGED');
      dropAdapter(record);
    }
    if (!record.adapter) {
      try {
        record.adapter = createSubstrateSmLifecycleMaterialAdapter({
          THREE, renderer, material: record.material, materialPath: description.materialPath,
          getMesh: () => firstMesh(record), requestRender,
        });
      } catch (error) {
        record.reason = error.message;
        return;
      }
    }
    if (!record.lifecycle) {
      record.lifecycle = warmup.register({ material: record.material, adapter: record.adapter, enabled: true });
      if (!record.lifecycle) {
        record.reason = 'SSM_HOST_WARMUP_UNAVAILABLE';
        return;
      }
    }
    observeRecord(record);
    record.request = Object.freeze({
      request: description.request,
      identity: description.identity,
      cost: description.cost,
      release: permission.release,
      sourceRevision: record.revision,
      contextGeneration: configuration.contextGeneration,
      projectGeneration: configuration.projectGeneration,
    });
    counters.requests += 1;
    const accepted = record.lifecycle.request(record.request);
    record.reason = settleReason(record, accepted);
    requestRender();
    setup.onStateChanged?.();
  }

  function retryRecord(record) {
    if (!record.request || !record.lifecycle || record.removed) return false;
    if (hostFrame - record.lastRetryFrame < RETRY_FRAME_INTERVAL) return false;
    const state = lifecycleState(record);
    if (!state || state.state !== 'fallback' || !RETRY_ON_DRAW_REASONS.has(state.reason)) return false;
    record.lastRetryFrame = hostFrame;
    counters.retries += 1;
    const accepted = record.lifecycle.request({ ...record.request, retry: true });
    record.reason = settleReason(record, accepted);
    return accepted;
  }

  function onDraw(mesh) {
    if (disposed) return;
    counters.draws += 1;
    const records = meshRecords.get(mesh);
    if (!records) return;
    for (const record of records) {
      if (record.removed) continue;
      if (record.adapter?.notifyDraw(mesh) === true) {
        counters.confirmedDraws += 1;
        requestRender();
      } else retryRecord(record);
    }
  }

  function clear(reason) {
    registry.clear(reason);
    observer.dispose();
    meshRecords.clear();
    const previous = warmup;
    warmup = null;
    previous?.dispose();
    describer.invalidateHost();
  }

  function configure(next) {
    if (disposed) return;
    if (configuration && (configuration.contextGeneration !== next.contextGeneration
      || configuration.projectGeneration !== next.projectGeneration || configuration.quality !== next.quality
      || configuration.enabled !== next.enabled)) clear('SSM_HOST_CONFIGURATION_CHANGED');
    configuration = next;
  }

  function attachMaterial(material, mesh, site) {
    if (disposed || !configuration) return false;
    const existing = registry.get(material);
    const previousReferences = existing?.meshes.size ?? 0;
    const record = registry.register(material, mesh, site);
    if (!record) return false;
    if (record.lifecycle) observeRecord(record);
    if (record.reason === undefined || record.meshes.size !== previousReferences || !record.lifecycle) refreshRecord(record);
    return record.lifecycle !== null && record.lifecycle !== undefined;
  }

  function invalidateSource(instance, property) {
    if (disposed || !isSubstrateSmSourceProperty(property)) return false;
    return registry.invalidateOwner(ownerId(instance), property);
  }

  function invalidateStructure(event) {
    if (disposed) return false;
    const instance = event?.instance ?? event?.child;
    if (instance?.id !== undefined) registry.removeOwner(ownerId(instance));
    return registry.invalidateAll('SSM_HOST_STRUCTURE_CHANGED');
  }

  function runFrame(frame) {
    if (disposed || !warmup) return false;
    hostFrame += 1;
    const workAllowed = frame?.workAllowed !== false;
    if (!workAllowed) return false;



    const started = now();
    const nowMs = started;
    let operations = 0;
    while (operations < MAX_SLICE_OPERATIONS) {
      sliceFrame += 1;
      const performed = warmup.processSlice({ frameId: sliceFrame, atFrameBoundary: true, workAllowed: true, nowMs });
      if (performed === 0) break;
      operations += performed;
      if (now() - started >= SLICE_BUDGET_MS) break;
    }
    counters.sliceOperations += operations;
    if (hostFrame % 120 === 0) warmup.retryRetiredResources();
    if (operations > 0) requestRender();
    return operations > 0;
  }

  function collectCounts() {
    let applied = 0;
    let shaderCommitted = 0;
    let preparing = 0;
    let fallback = 0;
    registry.forEach(record => {
      const state = lifecycleState(record);
      const binding = record.adapter?.getState().binding;
      if (state?.applied) applied += 1;
      if (binding?.shaderCommitted) shaderCommitted += 1;
      if (state?.state === 'preparing' || state?.state === 'ready') preparing += 1;
      if (!state || state.state === 'fallback' || state.state === 'dormant') fallback += 1;
    });
    return { applied, shaderCommitted, preparing, fallback };
  }

  function snapshot() {
    const counts = collectCounts();
    return {
      ...registry.snapshot(),
      applied: counts.applied > 0,
      appliedCount: counts.applied,
      shaderCommitted: counts.shaderCommitted,
      preparing: counts.preparing,
      fallback: counts.fallback,
      release: releasePolicy.getSnapshot(),
      permission: permissionSnapshot,
      lifecycle: warmup?.getState() ?? null,
      observer: observer.getState(),
      counters: { ...counters },
      hostEvidenceAvailable: describer.evidence,
      hostWarmupAvailable: true,
      renderer: describer.readHost(configuration)?.rendererString ?? null,
      softwareRenderer: describer.readHost(configuration)?.softwareRenderer ?? null,
    };
  }

  function getDiagnostics() {
    const materials = [];
    registry.forEach(record => {
      const state = lifecycleState(record);
      const adapter = record.adapter?.getState() ?? null;
      materials.push({
        materialId: record.id,
        site: record.site,
        sourceRevision: record.revision,
        contextGeneration: configuration?.contextGeneration ?? null,
        projectGeneration: configuration?.projectGeneration ?? null,
        materialPath: record.description?.materialPath ?? null,
        family: record.description?.family ?? null,
        profile: record.description?.profile ?? null,
        sourceKind: record.description?.sourceKind ?? null,
        compilation: record.description?.compilation ?? null,
        state,
        reason: state?.applied ? null : record.reason ?? 'SSM_HOST_EVIDENCE_UNAVAILABLE',
        permission: record.permission ?? null,
        backend: state?.applied ? 'substrateSm' : adapter ? 'host' : null,
        adapter: record.adapter ? {
          awaitingDraw: record.adapter.getState().awaitingDraw,
          activeTransaction: record.adapter.getState().activeTransaction,
          counters: record.adapter.getState().counters,
        } : null,
        rendered: adapter ? adapter.counters.confirmations > adapter.counters.confirmationFailures : null,
        binding: adapter?.binding ?? null,
        meshes: record.meshes.size,
      });
    });
    return { host: snapshot(), materials };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clear('SSM_HOST_DISPOSED');
    registry.dispose();
    configuration = null;
  }

  return Object.freeze({
    configure, attachMaterial, invalidateSource, invalidateStructure, runFrame, snapshot, getDiagnostics, dispose,
    detachMaterial: (material, reason) => registry.remove(material, reason),
    owns: material => registry.get(material)?.lifecycle?.getState().applied === true,
  });
}
