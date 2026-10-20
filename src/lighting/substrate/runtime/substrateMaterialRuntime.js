import { createMaterialRuntime } from '../sbMaterialRuntime.js';
import { refreshSubstrateMaterialSource } from './substrateMaterialSource.js';
import { substrateMaterialRefusal } from './substrateMaterialEligibility.js';
const FRAME_KEYS = ['substrateRuntimeGate', 'substrateMaterials', 'substrateTopology', 'substrateClosures', 'substrateStack', 'closures', 'substrateClosureCount', 'materialRuntimeEnabled'];
export function createSubstrateMaterialRuntime({ THREE, flags, telemetry, readGate, readTier, readUniform }) {
  const registered = new Set();
  const revisions = new WeakMap();
  const scene = { traverse(callback) { for (const material of registered) callback({ material }); } };
  const runtime = createMaterialRuntime({ THREE, bench: { scene }, isFlagActive: flags.isFlagActive, telemetry, readIntegrationGate: () => ({ substrateActive: readGate() }), readUniform });
  let selectedFrame = null;
  let cachedFields = null;
  let dirty = true;
  let previousPolicy = '';
  function prepare(material) {
    const data = material.userData;
    data.__rswSbMaterialVeto = substrateMaterialRefusal(material);
    refreshSubstrateMaterialSource(material);
    const root = data.sbAuthoredTree || data.sbSceneTree;
    const error = data.__rswSbAuthoringError || data.__rswSbMaterialVeto;
    const previous = revisions.get(material);
    if (previous && previous.root === root && previous.error === error && previous.transparent === material.transparent && previous.depthWrite === material.depthWrite) return false;
    revisions.set(material, { root, error, transparent: material.transparent, depthWrite: material.depthWrite });
    return true;
  }
  function bindInheritedSlots(frame) {
    for (const entry of frame.substrateMaterials || []) {
      const holder = entry.uniforms.uSbInheritedSlot ??= { value: -1 };
      const bottom = entry.result.closures.findIndex(closure => closure.path.endsWith('/1'));
      holder.value = entry.material.userData.sbAuthoredTree ? -1 : Math.max(0, bottom);
    }
  }
  function resolveFrame(frame) {
    const policy = String(readGate()) + ':' + readTier() + ':' + flags.listFlags(readTier()).map(flag => Number(flag.on)).join('');
    let changed = dirty || policy !== previousPolicy;
    for (const material of registered) if (prepare(material)) changed = true;
    if (changed || !cachedFields) {
      runtime.resolveFrame(frame);
      bindInheritedSlots(frame);
      cachedFields = Object.fromEntries(FRAME_KEYS.map(key => [key, frame[key]]));
      previousPolicy = policy;
      dirty = false;
    } else Object.assign(frame, cachedFields);
    selectedFrame = frame;
    return frame;
  }
  function refresh() {
    dirty = true;
    const frame = { tier: readTier() };
    resolveFrame(frame);
    runtime.uploadFrame(frame);
  }
  function register(material) {
    if (!material?.isMeshStandardMaterial || registered.has(material)) return false;
    material.userData ??= {};
    prepare(material);
    registered.add(material);
    material.addEventListener('dispose', forget);
    const frame = { tier: readTier() };
    runtime.resolveFrame(frame, { materials: [material], updateSelection: false });
    bindInheritedSlots(frame);
    runtime.uploadFrame(frame);
    dirty = true;
    return true;
  }
  function forget(eventOrMaterial) {
    const material = eventOrMaterial?.target || eventOrMaterial;
    if (!registered.delete(material)) return;
    material.removeEventListener('dispose', forget);
    runtime.forgetMaterial(material);
    revisions.delete(material);
    delete material.userData.sbUniforms;
    delete material.userData.sbRuntime;
    delete material.userData.__rswSbMaterialVeto;
    cachedFields = null;
    selectedFrame = null;
    dirty = true;
  }
  const invalidate = method => (...args) => { const result = runtime[method](...args); dirty = true; return result; };
  return {
    ...runtime, resolveFrame, register, forget, refresh,
    applyAuthoredTree: invalidate('applyAuthoredTree'), useSceneMaterial: invalidate('useSceneMaterial'), setClosureLimit: invalidate('setClosureLimit'), setMaterialData: invalidate('setMaterialData'),
    target: (...args) => { const result = runtime.target(...args); if (args.length) dirty = true; return result; },
    frame: () => selectedFrame,
    owns: material => registered.has(material) && material.userData.sbRuntime?.enabled === true,
    dispose() { for (const material of [...registered]) forget(material); runtime.dispose(); },
  };
}
