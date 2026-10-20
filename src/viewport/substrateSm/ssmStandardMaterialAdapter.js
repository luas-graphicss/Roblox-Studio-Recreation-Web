import { createSubstrateSmMaterialBinding } from './ssmMaterialBinding.js';
import { createSubstrateSmHostMaterialView } from './ssmHostMaterialView.js';
import { createSubstrateSmMaterialBoundaryGuard } from './ssmMaterialBoundaryGuard.js';
import { resolveSubstrateSmStandardAdmission } from './ssmStandardAdmission.js';
import { inspectSubstrateSmStandardHost, SSM_STANDARD_ADAPTER_VERSION, SSM_STANDARD_MATERIAL_PATH } from './ssmStandardHostPolicy.js';
import { copySubstrateSmImmutableData } from '../../lighting/substrateSm/ssmImmutableData.js';

function reject(reason, details = {}) {
  return Object.freeze({ ok: false, applied: false, gpuVerified: false, reason, ...details });
}

export function createSubstrateSmStandardMaterialAdapter({ THREE, mesh, material = mesh?.material, getMesh } = {}) {
  if (getMesh !== undefined && typeof getMesh !== 'function') throw new TypeError('SSM_STANDARD_MESH_PROVIDER_REQUIRED');
  const readMesh = getMesh ?? (() => mesh);
  const initialMesh = readMesh();
  if (initialMesh?.material !== material) throw new TypeError('SSM_STANDARD_MATERIAL_IDENTITY_REQUIRED');
  const host = inspectSubstrateSmStandardHost(initialMesh);
  if (!host.allowed) throw new TypeError(host.code);
  const binding = createSubstrateSmMaterialBinding({ THREE, material, materialPath: SSM_STANDARD_MATERIAL_PATH });
  const hostMaterial = createSubstrateSmHostMaterialView({ material, binding });
  const boundaryGuard = createSubstrateSmMaterialBoundaryGuard();
  let preparedMesh = null;
  let preparedRouting = null;
  let admission = null;

  function readHostMesh() {
    const currentMesh = readMesh();
    if (currentMesh?.material !== material) throw new Error('SSM_STANDARD_MATERIAL_REPLACED');
    const view = Object.create(currentMesh);
    Object.defineProperty(view, 'material', { value: hostMaterial, enumerable: true });
    return { mesh: currentMesh, view };
  }

  function getState() {
    const state = binding.getState();
    return Object.freeze({ ...state, adapterVersion: SSM_STANDARD_ADAPTER_VERSION,
      decisionType: 'material-binding', shaderCommitted: state.applied,
      applied: state.gpuVerified, ready: state.warmed, admission });
  }

  function disable(reason = 'SSM_STANDARD_DISABLED') {
    preparedMesh = null;
    preparedRouting = null;
    admission = null;
    binding.disable(reason);
    return getState();
  }

  function suspend(reason = 'SSM_STANDARD_SUSPENDED') {
    preparedMesh = null;
    preparedRouting = null;
    admission = null;
    binding.suspend(reason);
    return getState();
  }

  function applyRequest(request, rebase) {
    const previous = binding.getState();
    if (previous.disposed) return reject('SSM_BINDING_DISPOSED');
    if (request?.token !== undefined && request.token !== previous.token) return reject('SSM_BINDING_UPDATE_STALE');
    try {
      if (!request || typeof request !== 'object' || Array.isArray(request)) throw new TypeError('SSM_BINDING_REQUEST_REQUIRED');
      if (request.routing?.threeRevision !== undefined && request.routing.threeRevision !== String(THREE.REVISION)) {
        throw new Error('SSM_HOST_ADAPTER_UNAVAILABLE');
      }
      const current = readHostMesh();
      const routing = copySubstrateSmImmutableData({ ...request.routing,
        materialPath: request.routing?.materialPath ?? SSM_STANDARD_MATERIAL_PATH,
        blendMode: request.routing?.blendMode ?? (material.alphaTest > 0 ? 'alphaTest' : 'opaque'),
        threeRevision: String(THREE.REVISION) });
      const decision = resolveSubstrateSmStandardAdmission(current.view, routing);
      if (!decision.eligible) {
        const reason = decision.materialBoundary?.code ?? decision.host?.code ?? decision.code;
        disable(reason);
        admission = decision;
        return reject(reason, { decision });
      }
      const boundary = boundaryGuard.capture(current.view, routing);
      if (!boundary.allowed || !boundaryGuard.isCurrent(boundary.ticket, routing)) {
        throw new Error(boundary.code ?? 'SSM_STANDARD_BOUNDARY_STALE');
      }
      const result = rebase ? binding.heal({ ...request, routing }) : binding.prepare({ ...request, routing });
      boundaryGuard.invalidate(current.view);
      if (result.ok) {
        preparedMesh = current.mesh;
        preparedRouting = routing;
        admission = decision;
      }
      return Object.freeze({ ...result, decision, shaderCommitted: result.applied,
        applied: result.gpuVerified === true, gpuVerified: result.gpuVerified === true });
    } catch (error) {
      disable(error.message);
      return reject(error.message);
    }
  }

  function prepare(request) { return applyRequest(request, false); }
  function heal(request) { return applyRequest(request, true); }

  function confirmProgram(options = {}) {
    const state = binding.getState();
    if (state.disposed || !preparedRouting || options.token !== state.token) return reject('SSM_BINDING_PROGRAM_STALE');
    try {
      const current = readHostMesh();
      if (current.mesh !== preparedMesh) throw new Error('SSM_STANDARD_MESH_REPLACED');
      const decision = resolveSubstrateSmStandardAdmission(current.view, preparedRouting);
      if (!decision.eligible) throw new Error(decision.materialBoundary?.code ?? decision.host?.code ?? decision.code);
      return binding.confirmProgram(options);
    } catch (error) {
      disable(error.message);
      return reject(error.message);
    }
  }

  function dispose() {
    preparedMesh = null;
    preparedRouting = null;
    admission = null;
    binding.dispose();
  }

  return Object.freeze({ materialPath: SSM_STANDARD_MATERIAL_PATH,
    beginUpdate: binding.beginUpdate, prepare, update: prepare, confirmProgram,
    disable, suspend, heal, dispose, getState, getHostCallbacks: binding.getHostCallbacks });
}
