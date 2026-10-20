import { CONVOLUTION_OWNER, CONVOLUTION_BATCH_SIZE } from "./convolutionSettings.js";
import { PREFILTER_FRAGMENT } from "./prefilterShader.js";
import { CONVOLUTION_FRAGMENT } from "./convolutionShader.js";
import { COMPOSITE_FRAGMENT, CLEAR_FRAGMENT } from "./compositeShader.js";

export function createConvolutionGpu(rendererAdapter, pool) {
  const { THREE } = rendererAdapter;
  const materials = [];
  const viewResources = new Map();
  function material(fragment, uniforms) {
    const result = rendererAdapter.createMaterial(fragment, uniforms);
    materials.push(result);
    return result;
  }
  const prefilter = material(PREFILTER_FRAGMENT, {
    sourceTexture: { value: null }, sourceSize: { value: new THREE.Vector2() }, reducedSize: { value: new THREE.Vector2() },
    preExposure: { value: 1 }, threshold: { value: 0 }, softKnee: { value: 0 }, prefilterMinimum: { value: 0 }, prefilterMaximum: { value: 64 }, prefilterMultiplier: { value: 1 }
  });
  const convolution = material(CONVOLUTION_FRAGMENT, {
    sourceTexture: { value: null }, previousTexture: { value: null }, sourceSize: { value: new THREE.Vector2() }, paddedSize: { value: new THREE.Vector2() }, paddingOrigin: { value: new THREE.Vector2() },
    firstBatch: { value: true }, tapCount: { value: 0 }, tapOffsets: { value: Array.from({ length: CONVOLUTION_BATCH_SIZE }, () => new THREE.Vector2()) }, tapWeights: { value: Array.from({ length: CONVOLUTION_BATCH_SIZE }, () => new THREE.Vector3()) }
  });
  const composite = material(COMPOSITE_FRAGMENT, {
    sourceTexture: { value: null }, glareTexture: { value: null }, sourceSize: { value: new THREE.Vector2() }, reducedSize: { value: new THREE.Vector2() }, paddedSize: { value: new THREE.Vector2() }, paddingOrigin: { value: new THREE.Vector2() }, intensity: { value: 0 }, effectEnabled: { value: false }
  });
  const clear = material(CLEAR_FRAGMENT, {});
  let disposed = false;

  function acquireTargets(plan, viewId) {
    const prefix = `${CONVOLUTION_OWNER}.${encodeURIComponent(viewId)}`;
    const signature = [plan.active, plan.width, plan.height, plan.sourceWidth, plan.sourceHeight, plan.paddedWidth, plan.paddedHeight].join(":");
    const previous = viewResources.get(viewId);
    if (previous?.signature !== signature) {
      for (const name of ["prefilter", "accumulationA", "accumulationB", "color"]) pool.release(`${prefix}.${name}`);
      viewResources.set(viewId, { signature });
    }
    function acquire(name, width, height) { return pool.acquire(CONVOLUTION_OWNER, `${prefix}.${name}`, { width, height, format: "rgba16f", depth: false, filter: "nearest" }); }
    return {
      prefilter: plan.active ? acquire("prefilter", plan.sourceWidth, plan.sourceHeight) : null,
      accumulationA: acquire("accumulationA", plan.paddedWidth, plan.paddedHeight),
      accumulationB: plan.active ? acquire("accumulationB", plan.paddedWidth, plan.paddedHeight) : null,
      color: acquire("color", plan.width, plan.height)
    };
  }

  function render(input, frame, settings, plan) {
    if (disposed) throw new Error("CP-F15 GPU resources are disposed");
    const targets = acquireTargets(plan, frame.viewId);
    for (const target of Object.values(targets)) if (target?.texture === input.texture) throw new Error("CP-F15 texture feedback refused");
    let glare = targets.accumulationA;
    if (plan.active) {
      prefilter.uniforms.sourceTexture.value = input.texture;
      prefilter.uniforms.sourceSize.value.set(plan.width, plan.height);
      prefilter.uniforms.reducedSize.value.set(plan.sourceWidth, plan.sourceHeight);
      prefilter.uniforms.preExposure.value = frame.preExposure;
      for (const key of ["threshold", "softKnee", "prefilterMinimum", "prefilterMaximum", "prefilterMultiplier"]) prefilter.uniforms[key].value = settings[key];
      rendererAdapter.draw(prefilter, targets.prefilter);
      convolution.uniforms.sourceTexture.value = targets.prefilter.texture;
      convolution.uniforms.sourceSize.value.set(plan.sourceWidth, plan.sourceHeight);
      convolution.uniforms.paddedSize.value.set(plan.paddedWidth, plan.paddedHeight);
      convolution.uniforms.paddingOrigin.value.set(plan.padding.left, plan.padding.bottom);
      for (let batchIndex = 0; batchIndex < plan.batches; batchIndex += 1) {
        const destination = batchIndex % 2 === 0 ? targets.accumulationA : targets.accumulationB;
        convolution.uniforms.firstBatch.value = batchIndex === 0;
        convolution.uniforms.previousTexture.value = batchIndex === 0 ? targets.prefilter.texture : glare.texture;
        const offset = batchIndex * CONVOLUTION_BATCH_SIZE;
        const count = Math.min(CONVOLUTION_BATCH_SIZE, plan.footprint.taps.length - offset);
        convolution.uniforms.tapCount.value = count;
        for (let index = 0; index < count; index += 1) {
          const tap = plan.footprint.taps[offset + index];
          convolution.uniforms.tapOffsets.value[index].set(tap.x, tap.y);
          convolution.uniforms.tapWeights.value[index].set(...tap.weight);
        }
        rendererAdapter.draw(convolution, destination);
        glare = destination;
      }
    } else rendererAdapter.draw(clear, glare);
    composite.uniforms.sourceTexture.value = input.texture;
    composite.uniforms.glareTexture.value = glare.texture;
    composite.uniforms.sourceSize.value.set(plan.width, plan.height);
    composite.uniforms.reducedSize.value.set(plan.sourceWidth, plan.sourceHeight);
    composite.uniforms.paddedSize.value.set(plan.paddedWidth, plan.paddedHeight);
    composite.uniforms.paddingOrigin.value.set(plan.padding.left, plan.padding.bottom);
    composite.uniforms.intensity.value = settings.intensity;
    composite.uniforms.effectEnabled.value = plan.active;
    rendererAdapter.draw(composite, targets.color);
    return { color: targets.color, glare };
  }

  return Object.freeze({ render, dispose() {
    if (disposed) return;
    disposed = true;
    for (const entry of materials) entry.dispose();
    pool.releaseOwner(CONVOLUTION_OWNER);
    viewResources.clear();
  } });
}
