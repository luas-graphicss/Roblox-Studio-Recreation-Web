import { createSubstrateSmStandardMaterialAdapter } from './ssmStandardMaterialAdapter.js';
import { createSubstrateSmPhongMaterialAdapter } from './ssmPhongMaterialAdapter.js';

export const SSM_LIFECYCLE_ADAPTER_VERSION = 1;

function createBindingAdapter({ THREE, material, materialPath, getMesh }) {
  if (materialPath === 'standard') return createSubstrateSmStandardMaterialAdapter({ THREE, material, getMesh });
  if (materialPath === 'phong' || materialPath === 'poolPhong') {
    return createSubstrateSmPhongMaterialAdapter({ THREE, material, materialPath, getMesh });
  }
  throw new Error('SSM_HOST_PATH_UNSUPPORTED');
}

export function createSubstrateSmLifecycleMaterialAdapter({ THREE, renderer, material, materialPath, getMesh, requestRender } = {}) {
  if (!THREE || !renderer || !material || typeof getMesh !== 'function') throw new TypeError('SSM_LIFECYCLE_ADAPTER_SERVICES_REQUIRED');
  let binding = null;
  let active = null;
  let awaiting = null;
  let disposed = false;
  const counters = { admissions: 0, transactions: 0, prepares: 0, confirmations: 0, confirmationFailures: 0, restores: 0, releases: 0 };

  function ensureBinding() {
    if (disposed) throw new Error('SSM_HOST_ADAPTER_DISPOSED');
    if (binding) return binding;
    if (!getMesh()) throw new Error('SSM_HOST_MESH_REQUIRED');
    binding = createBindingAdapter({ THREE, material, materialPath, getMesh });
    return binding;
  }

  function contextLost() {
    return renderer.getContext?.()?.isContextLost?.() === true;
  }

  function admit(input, identity) {
    counters.admissions += 1;
    const base = { sourceRevision: identity.sourceRevision, contextGeneration: identity.contextGeneration, materialPath };
    try {
      if (contextLost()) throw new Error('SSM_CONTEXT_UNAVAILABLE');
      if (!input?.request?.routing) throw new Error('SSM_BINDING_REQUEST_REQUIRED');
      if (input.request.routing.materialPath !== materialPath) throw new Error('SSM_BINDING_HOST_ROUTE_MISMATCH');
      ensureBinding();
      return Object.freeze({ ...base, eligible: true, code: null });
    } catch (error) {
      return Object.freeze({ ...base, eligible: false, code: error.message });
    }
  }

  function prepareWithFreshToken(request) {
    const adapter = ensureBinding();
    const token = adapter.beginUpdate({ sourceRevision: request.routing.sourceRevision, contextGeneration: request.routing.contextGeneration });
    if (!token) throw new Error('SSM_BINDING_TOKEN_UNAVAILABLE');
    counters.prepares += 1;
    const result = adapter.prepare({ ...request, token });
    if (!result.ok) throw new Error(result.reason || 'SSM_BINDING_PREPARE_REFUSED');
    return { token, result };
  }

  function createTransaction(input, { identity, signal }) {
    counters.transactions += 1;
    const request = input.request;
    let token = null;
    let confirmation = null;
    let released = false;
    const transaction = {
      identity,
      materialPath,
      get token() { return token; },
      get confirmation() { return confirmation; },
      get released() { return released; },
      setConfirmation(result) { confirmation = result; },
      allocate() {
        if (signal.aborted || contextLost()) throw new Error('SSM_LIFECYCLE_ALLOCATION_CANCELLED');
        ensureBinding();
        return true;
      },
      upload() {
        if (signal.aborted || contextLost()) throw new Error('SSM_LIFECYCLE_UPLOAD_CANCELLED');
        const prepared = prepareWithFreshToken(request);
        token = prepared.token;
        confirmation = null;
        awaiting = transaction;
        requestRender?.();
        return true;
      },
      compile() {
        if (signal.aborted) throw new Error('SSM_LIFECYCLE_COMPILE_CANCELLED');
        if (binding.getState().token !== token) throw new Error('SSM_BINDING_UPDATE_STALE');
        requestRender?.();
        return true;
      },
      link() {
        if (signal.aborted || contextLost()) throw new Error('SSM_LIFECYCLE_LINK_CANCELLED');
        if (binding.getState().token !== token) throw new Error('SSM_BINDING_UPDATE_STALE');
        if (!confirmation) return false;
        if (!confirmation.ok) throw new Error(confirmation.reason || 'SSM_BINDING_PROGRAM_REFUSED');
        return true;
      },
      firstUse() {
        if (confirmation?.gpuVerified !== true) throw new Error('SSM_BINDING_PROGRAM_NOT_SELECTED');
        return true;
      },
      verify() {
        const state = binding.getState();
        return Object.freeze({
          ok: !signal.aborted && confirmation?.ok === true && state.token === token && !state.disposed,
          linked: confirmation?.ok === true,
          selected: confirmation?.gpuVerified === true,
          identity,
        });
      },
      activate() {
        if (signal.aborted || contextLost()) return false;
        const state = binding.getState();
        if (state.token !== token || state.applied !== true) return false;
        active = transaction;
        if (awaiting === transaction) awaiting = null;
        return true;
      },
      release({ reason, contextLost: lost } = {}) {
        if (released) return true;
        released = true;
        counters.releases += 1;
        if (awaiting === transaction) awaiting = null;
        if (active === transaction) active = null;
        if (binding && !binding.getState().disposed && token !== null && binding.getState().token === token) {
          if (lost) binding.suspend(reason ?? 'SSM_LIFECYCLE_CONTEXT_LOST');
          else binding.disable(reason ?? 'SSM_LIFECYCLE_RELEASED');
        }
        token = null;
        return true;
      },
      reprepare() {
        if (released || disposed || contextLost()) return false;
        try {
          const prepared = prepareWithFreshToken(request);
          token = prepared.token;
          confirmation = null;
          awaiting = transaction;
          requestRender?.();
          return true;
        } catch {
          return false;
        }
      },
    };
    return transaction;
  }

  function restore(previous) {
    counters.restores += 1;
    if (disposed || !binding) return true;
    if (!previous || previous.released) {
      awaiting = null;
      active = null;
      if (!binding.getState().disposed) binding.disable('SSM_LIFECYCLE_HOST_RESTORED');
      return true;
    }
    const state = binding.getState();
    if (state.token === previous.token && state.applied === true) return true;
    const restored = previous.reprepare();
    if (restored) active = previous;
    return restored;
  }

  function notifyDraw() {
    const transaction = awaiting;
    if (!transaction || disposed || !binding) return false;
    const state = binding.getState();
    if (state.disposed || state.token !== transaction.token) return false;
    counters.confirmations += 1;
    const result = binding.confirmProgram({ renderer, token: transaction.token, requireSelected: true });
    if (!result.ok) counters.confirmationFailures += 1;
    transaction.setConfirmation(result);
    if (result.ok) awaiting = null;
    return result.ok;
  }

  function getState() {
    return Object.freeze({
      adapterVersion: SSM_LIFECYCLE_ADAPTER_VERSION,
      materialPath,
      disposed,
      bindingCreated: binding !== null,
      binding: binding?.getState() ?? null,
      activeTransaction: active !== null,
      awaitingDraw: awaiting !== null,
      counters: Object.freeze({ ...counters }),
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    awaiting = null;
    active = null;
    binding?.dispose();
    binding = null;
  }

  return Object.freeze({ materialPath, admit, createTransaction, restore, notifyDraw, getState, dispose });
}
