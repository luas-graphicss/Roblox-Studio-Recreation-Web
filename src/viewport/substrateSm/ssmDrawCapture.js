import { replaceSubstrateSmDiagnosticMethod } from './ssmTemporaryMethod.js';
import { inspectSubstrateSmDrawProgram } from './ssmProgramDiagnostics.js';
import { substrateSmBindingStamp } from './ssmDiagnosticData.js';

export function readSubstrateSmGlErrors(context) {
  const errors = [];
  for (let index = 0; index < 16; index += 1) {
    const error = context.getError();
    if (error === context.NO_ERROR) break;
    errors.push(error);
  }
  return errors;
}

export function observeSubstrateSmDraws({ renderer, renderTarget, records, contextGeneration, maxDraws = 512 }) {
  if (!Number.isSafeInteger(maxDraws) || maxDraws < 1 || maxDraws > 4096) throw new RangeError('SSM_QA_DRAW_LIMIT_INVALID');
  const context = renderer.getContext();
  const framebuffer = context.getParameter(context.DRAW_FRAMEBUFFER_BINDING);
  const materialRecords = new Map([...records.values()].map(record => [record.material, record]));
  const resourceIds = new WeakMap();
  const programs = new Map();
  const sourceCache = new Map();
  const draws = [];
  const restorers = [];
  let nextResourceId = 0;
  let activeMaterial = null;
  let droppedDraws = 0;
  let totalDrawCalls = 0;
  let restored = false;
  const resourceId = resource => {
    if (!resource || typeof resource !== 'object') return null;
    if (!resourceIds.has(resource)) resourceIds.set(resource, ++nextResourceId);
    return resourceIds.get(resource);
  };
  function restore() {
    if (restored) return true;
    let complete = true;
    for (const restoreMethod of [...restorers].reverse()) {
      try { complete = restoreMethod() && complete; } catch { complete = false; }
    }
    restored = complete;
    return complete;
  }
  try {
    restorers.push(replaceSubstrateSmDiagnosticMethod(renderer, 'renderBufferDirect', original =>
      function renderBufferDirect(camera, scene, geometry, material, object, group) {
        const previous = activeMaterial;
        activeMaterial = material;
        try { return Reflect.apply(original, this, arguments); }
        finally { activeMaterial = previous; }
      }));
    for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
      restorers.push(replaceSubstrateSmDiagnosticMethod(context, name, original => function capturedDraw(...args) {
        totalDrawCalls += 1;
        if (draws.length >= maxDraws) { droppedDraws += 1; return Reflect.apply(original, this, args); }
        const count = args[name.startsWith('drawArrays') ? 2 : 1];
        const instances = name.endsWith('Instanced') ? args[name === 'drawArraysInstanced' ? 3 : 4] : 1;
        const record = materialRecords.get(activeMaterial);
        const targetMatched = renderer.getRenderTarget() === renderTarget
          && context.getParameter(context.DRAW_FRAMEBUFFER_BINDING) === framebuffer;
        const preexistingErrors = readSubstrateSmGlErrors(context);
        let inspection = null;
        let stamp = null;
        let state = null;
        let reason = null;
        try {
          if (record && targetMatched) {
            state = record.binding.getState();
            stamp = substrateSmBindingStamp(state);
            inspection = inspectSubstrateSmDrawProgram({ renderer, material: activeMaterial, state,
              contextGeneration, resourceId, sourceCache });
            if (inspection.programId != null && !programs.has(inspection.programId)) {
              programs.set(inspection.programId, { programId: inspection.programId,
                programCacheKey: inspection.programCacheKey, descriptor: inspection.descriptor,
                shaders: inspection.shaders, linked: inspection.linked });
            }
          }
        } catch (error) { reason = String(error?.message ?? error); }
        let result;
        let failure;
        try { result = Reflect.apply(original, this, args); }
        catch (error) { failure = error; }
        const errors = readSubstrateSmGlErrors(context);
        const verified = inspection?.verified === true && targetMatched && Number.isSafeInteger(count)
          && count > 0 && Number.isSafeInteger(instances) && instances > 0 && !failure
          && errors.length === 0 && preexistingErrors.length === 0 && !context.isContextLost();
        draws.push({ method: name, materialId: record?.materialId ?? null,
          registrationId: record?.registrationId ?? null, stamp, count, instances, targetMatched, verified,
          reason: reason ?? failure?.message ?? inspection?.reason ?? null,
          programId: inspection?.programId ?? null, sourceRevision: state?.sourceRevision ?? null,
          contextGeneration: state?.contextGeneration ?? null, uniformRevision: state?.uniformRevision ?? null,
          resources: inspection?.resources ?? null, errors, preexistingErrors });
        if (failure) throw failure;
        return result;
      }));
    }
  } catch (error) { restore(); throw error; }
  return { restore, draws, programs, get droppedDraws() { return droppedDraws; },
    get totalDrawCalls() { return totalDrawCalls; } };
}
