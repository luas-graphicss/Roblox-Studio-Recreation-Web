import { createSubstrateSmMaterialBinding } from './ssmMaterialBinding.js';
import { createSubstrateSmHostMaterialView } from './ssmHostMaterialView.js';
import { createSubstrateSmMaterialBoundaryGuard } from './ssmMaterialBoundaryGuard.js';
import { resolveSubstrateSmPhongAdmission } from './ssmPhongAdmission.js';
import { inspectSubstrateSmPhongHost } from './ssmPhongHostPolicy.js';
import { withSubstrateSmLegacyExclusion, SSM_LEGACY_EXCLUSION_TRANSFORM_ID } from './ssmLegacyResponseExclusion.js';
import { copySubstrateSmImmutableData } from '../../lighting/substrateSm/ssmImmutableData.js';

export const SSM_PHONG_ADAPTER_VERSION = 1;
export const SSM_PHONG_HOST_BACKEND = 'phong';
export const SSM_PHONG_MATERIAL_PATHS = Object.freeze(['phong', 'poolPhong']);

function reject(reason, details = {}) {
  return Object.freeze({ ok: false, applied: false, gpuVerified: false, reason, ...details });
}

function admissionReason(decision) {
  return decision.materialBoundary?.code ?? decision.host?.code ?? decision.code;
}

export function createSubstrateSmPhongMaterialAdapter({ THREE, mesh, material = mesh?.material, materialPath, getMesh } = {}) {
  if (getMesh !== undefined && typeof getMesh !== 'function') throw new TypeError('SSM_PHONG_MESH_PROVIDER_REQUIRED');
  const readMesh = getMesh ?? (() => mesh);
  const initialMesh = readMesh();
  if (initialMesh?.material !== material) throw new TypeError('SSM_PHONG_MATERIAL_IDENTITY_REQUIRED');
  const host = inspectSubstrateSmPhongHost(initialMesh);
  if (!host.allowed) throw new TypeError(host.code);
  if (materialPath !== undefined && materialPath !== host.materialPath) throw new TypeError('SSM_PHONG_PATH_MISMATCH');
  const hostPath = host.materialPath;
  const binding = createSubstrateSmMaterialBinding({ THREE, material, materialPath: hostPath });
  const hostMaterial = createSubstrateSmHostMaterialView({ material, binding });
  const boundaryGuard = createSubstrateSmMaterialBoundaryGuard();
  let preparedMesh = null;
  let preparedRouting = null;
  let admission = null;

  function hostView(currentMesh) {
    const view = Object.create(currentMesh);
    Object.defineProperty(view, 'material', { value: hostMaterial, enumerable: true });
    return view;
  }

  function readHostMesh() {
    const currentMesh = readMesh();
    if (currentMesh?.material !== material) throw new Error('SSM_PHONG_MATERIAL_REPLACED');
    return { mesh: currentMesh, view: hostView(currentMesh) };
  }

  function inspectHost(candidateMesh) {
    if (!candidateMesh || typeof candidateMesh !== 'object' || candidateMesh.material !== material) {
      return Object.freeze({ allowed: false, materialPath: hostPath, code: 'SSM_PHONG_MATERIAL_IDENTITY_REQUIRED' });
    }
    const inspection = inspectSubstrateSmPhongHost(hostView(candidateMesh));
    if (inspection.allowed && inspection.materialPath !== hostPath) {
      return Object.freeze({ allowed: false, materialPath: inspection.materialPath, code: 'SSM_PHONG_PATH_MISMATCH' });
    }
    return inspection;
  }

  function getState() {
    const state = binding.getState();
    return Object.freeze({ ...state, adapterVersion: SSM_PHONG_ADAPTER_VERSION, hostBackend: SSM_PHONG_HOST_BACKEND,
      decisionType: 'material-binding', shaderCommitted: state.applied,
      applied: state.gpuVerified, ready: state.warmed, admission,
      legacyExclusion: SSM_LEGACY_EXCLUSION_TRANSFORM_ID });
  }

  function disable(reason = 'SSM_PHONG_DISABLED') {
    preparedMesh = null;
    preparedRouting = null;
    admission = null;
    binding.disable(reason);
    return getState();
  }

  function suspend(reason = 'SSM_PHONG_SUSPENDED') {
    preparedMesh = null;
    preparedRouting = null;
    admission = null;
    binding.suspend(reason);
    return getState();
  }

  function resolveRouting(request) {
    return copySubstrateSmImmutableData({ ...request.routing,
      materialPath: request.routing?.materialPath ?? hostPath,
      blendMode: request.routing?.blendMode ?? (material.alphaTest > 0 ? 'alphaTest' : 'opaque'),
      threeRevision: String(THREE.REVISION) });
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
      const routing = resolveRouting(request);
      const decision = resolveSubstrateSmPhongAdmission(current.view, routing);
      if (!decision.eligible) {
        const reason = admissionReason(decision);
        disable(reason);
        admission = decision;
        return reject(reason, { decision });
      }
      const boundary = boundaryGuard.capture(current.view, routing);
      if (!boundary.allowed || !boundaryGuard.isCurrent(boundary.ticket, routing)) {
        throw new Error(boundary.code ?? 'SSM_PHONG_BOUNDARY_STALE');
      }
      const bindingRequest = { ...request, routing, transforms: withSubstrateSmLegacyExclusion(request.transforms ?? []) };
      const result = rebase ? binding.heal(bindingRequest) : binding.prepare(bindingRequest);
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
      if (current.mesh !== preparedMesh) throw new Error('SSM_PHONG_MESH_REPLACED');
      const decision = resolveSubstrateSmPhongAdmission(current.view, preparedRouting);
      if (!decision.eligible) throw new Error(admissionReason(decision));
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

  return Object.freeze({ materialPath: hostPath, hostBackend: SSM_PHONG_HOST_BACKEND,
    beginUpdate: binding.beginUpdate, prepare, update: prepare, confirmProgram, inspectHost,
    disable, suspend, heal, dispose, getState, getHostCallbacks: binding.getHostCallbacks });
}
