import { SB_PASS_OWNERS } from '../sbMaterialContract.js';
export function createSubstrateFrameGraph(telemetry) {
  const passes = new Map();
  const stages = new Map();
  function registerPass(name, definition) {
    if (SB_PASS_OWNERS[name] !== definition.owner) return { accepted: false, reason: 'Pass owner mismatch' };
    passes.set(name, definition);
    return { accepted: true, name, owner: definition.owner };
  }
  function registerFrameStage(name, definition) {
    if (!['beforeMaterials', 'beforeRender', 'afterRender'].includes(name) || typeof definition.run !== 'function') return { accepted: false, reason: 'Invalid frame stage' };
    stages.set(definition.id, { ...definition, name });
    return { accepted: true, id: definition.id, stageName: name };
  }
  function invoke(definition, callback, frame, name) {
    try { const result = callback(frame); if (result && result !== frame && typeof result === 'object' && !ArrayBuffer.isView(result)) Object.assign(frame, result); } catch (error) { telemetry.error(name, error?.message || String(error)); }
  }
  return {
    registerPass,
    restoreStubPass: name => passes.delete(name),
    registerFrameStage,
    runStage(name, frame) { for (const definition of stages.values()) if (definition.name === name) invoke(definition, definition.run, frame, definition.id); },
    runPasses(frame) { for (const name of Object.keys(SB_PASS_OWNERS)) { const definition = passes.get(name); if (definition) invoke(definition, definition.execute, frame, name); } },
    snapshot: () => ({ passes: [...passes.keys()], stages: [...stages.values()].map(stage => ({ id: stage.id, name: stage.name })) }),
    dispose() { passes.clear(); stages.clear(); },
  };
}
