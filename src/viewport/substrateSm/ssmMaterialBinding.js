import { createSubstrateSmShaderCandidate, commitSubstrateSmShaderCandidate } from './ssmShaderTransaction.js';
import { beginSubstrateSmShaderOwnership, commitSubstrateSmShaderOwnership, rollbackSubstrateSmShaderOwnership } from './ssmShaderOwnership.js';
import { createSubstrateSmRecipeUniform } from './ssmRecipeUniform.js';
import { createSubstrateSmMaterialHooks } from './ssmMaterialHooks.js';
import { createSubstrateSmBindingUniformBridge } from './ssmBindingUniformBridge.js';
import { inspectSubstrateSmBindingProgram } from './ssmBindingProgramInspection.js';
import { prepareSubstrateSmBindingRequest, inspectSubstrateSmBindingMaterial } from './ssmBindingRequest.js';

const bindings = new WeakMap();
const materialBindingGenerations = new WeakMap();

function rejected(reason, details = {}) {
  return Object.freeze({ ok: false, applied: false, reason, ...details });
}

function restoreShader(shader, descriptors) {
  for (const name of Reflect.ownKeys(shader)) {
    if (!Object.hasOwn(descriptors, name)) delete shader[name];
  }
  Object.defineProperties(shader, descriptors);
}

export function createSubstrateSmMaterialBinding({ THREE, material, materialPath } = {}) {
  if (!THREE || !material?.addEventListener || !material?.removeEventListener) throw new TypeError('SSM_BINDING_MATERIAL_REQUIRED');
  if (bindings.has(material)) throw new Error('SSM_BINDING_ALREADY_OWNED');
  inspectSubstrateSmBindingMaterial(material, materialPath);
  const recipeUniform = createSubstrateSmRecipeUniform();
  const uniformBridge = createSubstrateSmBindingUniformBridge(material);
  const refusals = new Map();
  const tokens = new WeakMap();
  const counters = { preparations: 0, compileAttempts: 0, shaderCommits: 0, uniformWrites: 0, rollbacks: 0, programVerifications: 0 };
  let hooks = createSubstrateSmMaterialHooks(material);
  let current = null;
  let latestToken = null;
  let ownershipToken = null;
  let state = 'dormant';
  let reason = null;
  let disposed = false;
  let recoveryGeneration = materialBindingGenerations.get(material) ?? 0;

  function getState() {
    const attached = hooks.attached();
    return Object.freeze({ state: current && !attached ? 'fallback' : state,
      reason: current && !attached ? 'SSM_BINDING_HOST_STRIPPED' : reason,
      applied: !!current?.shaderCommitted && attached,
      gpuVerified: !!current?.gpuVerified && attached,
      stageOnly: current?.stageOnly === true,
      warmed: current?.warmed === true && attached,
      effectiveQuality: current?.effectiveQuality ?? null,
      disposed, materialPath, token: latestToken,
      sourceRevision: current?.routing.sourceRevision ?? null,
      contextGeneration: current?.routing.contextGeneration ?? null,
      programKey: current?.programKey ?? null, recipeKey: current?.recipeKey ?? null,
      uniformRevision: recipeUniform.getRevision(), refusalCount: refusals.size,
      counters: Object.freeze({ ...counters }) });
  }

  function clearOwnership() {
    if (ownershipToken) rollbackSubstrateSmShaderOwnership(ownershipToken);
    ownershipToken = null;
  }

  function disable(nextReason = 'SSM_BINDING_DISABLED') {
    if (disposed) return getState();
    const wasInstalled = hooks.attached() || current !== null;
    latestToken = null;
    current = null;
    clearOwnership();
    hooks.detach();
    uniformBridge.deactivate();
    state = 'fallback';
    reason = nextReason;
    if (wasInstalled) material.needsUpdate = true;
    return getState();
  }

  function suspend(nextReason = 'SSM_BINDING_SUSPENDED') {
    if (disposed) return getState();
    disable(nextReason);
    if (uniformBridge.getRenderer()) recoveryGeneration += 1;
    uniformBridge.clear();
    state = 'suspended';
    return getState();
  }

  function rememberRefusal(prepared, nextReason) {
    refusals.set(prepared.failureKey, nextReason);
    while (refusals.size > 8) refusals.delete(refusals.keys().next().value);
    counters.rollbacks += 1;
  }

  function beginUpdate({ sourceRevision, contextGeneration } = {}) {
    if (disposed) return null;
    if (!((typeof sourceRevision === 'string' && sourceRevision.length > 0)
      || (Number.isSafeInteger(sourceRevision) && sourceRevision >= 0))
      || !Number.isSafeInteger(contextGeneration) || contextGeneration < 0) {
      throw new TypeError('SSM_BINDING_REVISION_REQUIRED');
    }
    if (current && current.routing.contextGeneration !== contextGeneration) suspend('SSM_BINDING_CONTEXT_GENERATION_CHANGED');
    const token = Object.freeze({});
    tokens.set(token, { sourceRevision, contextGeneration });
    latestToken = token;
    state = 'preparing';
    return token;
  }

  function compileShader(shader, renderer) {
    const prepared = current;
    if (disposed || !prepared || !hooks.attached()) {
      throw new Error('SSM_BINDING_COMPILE_STALE');
    }
    const original = Object.getOwnPropertyDescriptors(shader);
    let token = null;
    counters.compileAttempts += 1;
    try {
      inspectSubstrateSmBindingMaterial(material, materialPath);
      if (renderer.getContext().isContextLost()) throw new Error('SSM_BINDING_CONTEXT_LOST');
      if (hooks.hostKey() !== prepared.hostKey) throw new Error('SSM_BINDING_HOST_GENERATION_CHANGED');
      uniformBridge.rememberRenderer(renderer);
      token = beginSubstrateSmShaderOwnership(shader);
      shader.uniforms = { ...shader.uniforms };
      if (shader.defines) shader.defines = { ...shader.defines };
      hooks.previousCompile.call(material, shader, renderer);
      if (prepared !== current) throw new Error('SSM_BINDING_COMPILE_STALE');
      const candidate = createSubstrateSmShaderCandidate({ THREE, shader, hostBackend: prepared.hostBackend,
        recipeUniform: recipeUniform.uniform, emissionMode: prepared.emissionMode, tintMode: prepared.tintMode,
        transforms: prepared.transforms, validateResources: prepared.validateResources });
      if (!candidate.ok) throw new Error(candidate.reason);
      const committed = commitSubstrateSmShaderCandidate({ shader, candidate });
      if (!committed.ok) throw new Error(committed.reason);
      if (!commitSubstrateSmShaderOwnership(token)) throw new Error('SSM_BINDING_OWNERSHIP_LOST');
      clearOwnership();
      ownershipToken = token;
      token = null;
      uniformBridge.record(shader.uniforms, renderer);
      prepared.shaderCommitted = true;
      prepared.gpuVerified = false;
      prepared.warmed = false;
      counters.shaderCommits += 1;
      state = 'ready';
      reason = null;
    } catch (error) {
      if (token) rollbackSubstrateSmShaderOwnership(token);
      restoreShader(shader, original);
      rememberRefusal(prepared, error.message);
      disable(error.message);
      hooks.previousCompile.call(material, shader, renderer);
      const refusal = new Error(`SSM_BINDING_COMPILE_ABORTED:${error.message}`);
      refusal.code = 'SSM_BINDING_COMPILE_ABORTED';
      refusal.cause = error;
      throw refusal;
    }
  }

  function programCacheKey() {
    if (!current) return hooks.hostKey();
    return `${hooks.hostKey()}|${current.programKey.signature}`;
  }

  function prepare(request) {
    if (disposed) return rejected('SSM_BINDING_DISPOSED');
    counters.preparations += 1;
    let token = request?.token;
    try {
      if (token !== undefined && (token !== latestToken || !tokens.has(token))) return rejected('SSM_BINDING_UPDATE_STALE');
      if (token === undefined) token = beginUpdate(request?.routing);
      const expected = tokens.get(token);
      if (request?.routing?.sourceRevision !== expected.sourceRevision
        || request?.routing?.contextGeneration !== expected.contextGeneration) return rejected('SSM_BINDING_UPDATE_STALE');
      if (!hooks.attached() && !hooks.detached()) {
        disable('SSM_BINDING_HOST_STRIPPED');
        return rejected('SSM_BINDING_HOST_STRIPPED');
      }
      if (request.retry === true) recoveryGeneration += 1;
      const prepared = prepareSubstrateSmBindingRequest({ THREE, material, materialPath, request, recoveryGeneration });
      if (!prepared.ok) {
        if (!prepared.pending) disable(prepared.reason);
        else { state = 'preparing'; reason = prepared.reason; }
        return rejected(prepared.reason, { pending: prepared.pending, decision: prepared.decision, token });
      }
      if (prepared.stageOnly && current?.drawConfirmed) {
        latestToken = current.token;
        state = current.gpuVerified ? 'active' : 'ready';
        return rejected('SSM_BINDING_STAGING_REQUIRES_INACTIVE_MATERIAL');
      }
      prepared.hostKey = hooks.hostKey();
      prepared.failureKey += `|${prepared.hostKey}`;
      if (refusals.has(prepared.failureKey)) {
        disable(refusals.get(prepared.failureKey));
        return rejected(reason, { cached: true });
      }
      const unchangedProgram = Boolean(current?.programKey.signature === prepared.programKey.signature
        && current.hostKey === prepared.hostKey && current.routing.contextGeneration === prepared.routing.contextGeneration);
      if (unchangedProgram && current.transforms.some((extension, index) => extension.transform !== prepared.transforms[index]?.transform)) {
        throw new Error('SSM_BINDING_TRANSFORM_GENERATION_REQUIRED');
      }
      prepared.token = token;
      prepared.shaderCommitted = unchangedProgram && current.shaderCommitted;
      prepared.gpuVerified = unchangedProgram && current.gpuVerified;
      prepared.warmed = unchangedProgram && current.warmed;
      prepared.drawConfirmed = unchangedProgram && current.drawConfirmed;
      if (recipeUniform.update(prepared.payload)) counters.uniformWrites += 1;
      current = prepared;
      hooks.install(compileShader, programCacheKey);
      uniformBridge.activate();
      state = prepared.gpuVerified ? 'active' : prepared.shaderCommitted ? 'ready' : 'preparing';
      reason = null;
      if (!unchangedProgram) material.needsUpdate = true;
      return Object.freeze({ ok: true, applied: prepared.shaderCommitted, gpuVerified: prepared.gpuVerified, token,
        state, stageOnly: prepared.stageOnly, effectiveQuality: prepared.effectiveQuality,
        programKey: prepared.programKey, decision: prepared.decision });
    } catch (error) {
      disable(error.message);
      return rejected(error.message);
    }
  }

  function confirmProgram({ renderer, token, requireSelected = true } = {}) {
    if (disposed || !current || token !== latestToken || token !== current.token) return rejected('SSM_BINDING_PROGRAM_STALE');
    const prepared = current;
    try {
      if (!hooks.attached()) throw new Error('SSM_BINDING_HOST_STRIPPED');
      inspectSubstrateSmBindingMaterial(material, materialPath);
      if (hooks.hostKey() !== prepared.hostKey) throw new Error('SSM_BINDING_HOST_GENERATION_CHANGED');
      uniformBridge.rememberRenderer(renderer);
      const inspection = inspectSubstrateSmBindingProgram({ renderer, material, requireSelected,
        expectedKey: `${prepared.hostKey}|${prepared.programKey.signature}`, recipeUniform: recipeUniform.uniform });
      const selected = inspection.selected;
      prepared.shaderCommitted = true;
      prepared.gpuVerified = requireSelected && selected;
      prepared.warmed = true;
      prepared.drawConfirmed = prepared.drawConfirmed || prepared.gpuVerified;
      counters.programVerifications += 1;
      state = prepared.gpuVerified ? 'active' : 'ready';
      reason = null;
      return Object.freeze({ ok: true, applied: prepared.gpuVerified, gpuVerified: prepared.gpuVerified,
        warmed: true, token, programKey: prepared.programKey, effectiveQuality: prepared.effectiveQuality });
    } catch (error) {
      rememberRefusal(prepared, error.message);
      disable(error.message);
      return rejected(error.message);
    }
  }

  function heal(request) {
    if (disposed) return rejected('SSM_BINDING_DISPOSED');
    const previousCompile = hooks.previousCompile;
    const previousKey = hooks.previousKey;
    const previousHostKey = current?.hostKey ?? null;
    disable('SSM_BINDING_HOST_REBASED');
    hooks = createSubstrateSmMaterialHooks(material);
    const sameHost = hooks.previousCompile === previousCompile && hooks.previousKey === previousKey
      && (previousHostKey === null || hooks.hostKey() === previousHostKey);
    if (!sameHost) {
      uniformBridge.clear();
      recoveryGeneration += 1;
    }
    return prepare(request);
  }

  function dispose() {
    if (disposed) return;
    disable('SSM_BINDING_DISPOSED');
    disposed = true;
    state = 'disposed';
    uniformBridge.clear();
    recipeUniform.clear();
    refusals.clear();
    material.removeEventListener('dispose', dispose);
    materialBindingGenerations.set(material, recoveryGeneration + 1);
    bindings.delete(material);
  }

  function getHostCallbacks() {
    return Object.freeze({ onBeforeCompile: hooks.previousCompile, customProgramCacheKey: hooks.previousKey });
  }

  const binding = Object.freeze({ beginUpdate, prepare, update: prepare, confirmProgram, disable, suspend, heal, dispose, getState, getHostCallbacks });
  bindings.set(material, binding);
  material.addEventListener('dispose', dispose);
  return binding;
}
