import { injectSubsurfaceCapture } from './substrateSubsurfaceShader.js';
import { injectOitCapture } from './substrateOitShader.js';

export function createSubstrateCaptureMaterials(THREE) {
  const entries = new Map();
  const regions = new Map();
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  let frame = 0;
  let nextRegion = 1;
  function begin(scene) {
    frame++;
    regions.clear();
    nextRegion = 1;
    const objects = [];
    scene.traverse(object => { if (object.material) objects.push(object); });
    objects.sort((left, right) => left.id - right.id);
    for (const object of objects) regionFor(object);
  }
  function regionFor(object) {
    const count = object.isInstancedMesh ? Math.max(1, object.count) : 1;
    const previous = regions.get(object);
    if (!previous || previous.count < count) {
      regions.set(object, { value: nextRegion, count, frame });
      nextRegion += count;
      if (nextRegion > 16777215) throw new Error('Subsurface instance regions exceed exact float encoding');
    }
    regions.get(object).frame = frame;
    return regions.get(object).value;
  }
  function acquire(object, source, kind, uniforms) {
    if (!object.isMesh || !source?.visible) return hidden;
    const key = object.id + ':' + source.id + ':' + kind;
    let entry = entries.get(key);
    if (!entry) {
      const material = new source.constructor();
      entry = { material, source, object, shaderKey: null, frame, uniforms: { uSbCaptureRegion: { value: 0 } } };
      entry.disposeListener = () => { material.dispose(); entries.delete(key); source.removeEventListener('dispose', entry.disposeListener); };
      source.addEventListener('dispose', entry.disposeListener);
      entries.set(key, entry);
    }
    entry.frame = frame;
    entry.uniforms.uSbCaptureRegion.value = regionFor(object);
    for (const [name, holder] of Object.entries(uniforms)) {
      if (entry.uniforms[name]) entry.uniforms[name].value = holder.value;
      else entry.uniforms[name] = holder;
    }
    const material = entry.material;
    const shaderKey = source.version + ':' + source.customProgramCacheKey() + '|substrate-screen-rank-v2|' + kind;
    material.copy({ ...source, userData: {} });
    material.userData = { sbCapture: true };
    material.blending = THREE.NoBlending;
    material.depthWrite = true;
    material.depthTest = true;
    material.depthFunc = kind === 'peel' ? THREE.GreaterEqualDepth : THREE.LessEqualDepth;
    material.forceSinglePass = true;
    material.toneMapped = false;
    material.onBeforeCompile = (shader, renderer) => {
      const previousShader = source.userData.sbShader;
      const previousInstalled = source.userData.sbRuntime?.shaderInstalled;
      try { source.onBeforeCompile.call(source, shader, renderer); }
      finally {
        if (previousShader === undefined) delete source.userData.sbShader;
        else source.userData.sbShader = previousShader;
        if (source.userData.sbRuntime) source.userData.sbRuntime.shaderInstalled = previousInstalled;
      }
      if (kind === 'peel') injectOitCapture(shader, entry.uniforms, source.premultipliedAlpha);
      else injectSubsurfaceCapture(shader, entry.uniforms);
    };
    material.customProgramCacheKey = () => shaderKey;
    if (entry.shaderKey !== shaderKey) { entry.shaderKey = shaderKey; material.needsUpdate = true; }
    return material;
  }
  function end() {
    for (const [object, region] of regions) if (region.frame !== frame) regions.delete(object);
    for (const [key, entry] of entries) if (entry.frame !== frame) {
      entry.source.removeEventListener('dispose', entry.disposeListener);
      entry.material.dispose();
      entries.delete(key);
    }
  }
  function dispose() {
    for (const entry of entries.values()) { entry.source.removeEventListener('dispose', entry.disposeListener); entry.material.dispose(); }
    entries.clear(); regions.clear(); hidden.dispose();
  }
  return { begin, acquire, region: regionFor, end, dispose, hidden, count: () => entries.size };
}
