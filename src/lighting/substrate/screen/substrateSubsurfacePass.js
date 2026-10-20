import { withSubstrateMaterialSelection } from './substrateScreenState.js';
import { createBurleyDiskSamples, createSubsurfaceResolveMaterial } from './substrateSubsurfaceResolve.js';

export function createSubstrateSubsurfacePass({ THREE, renderer, scene, targets, captures, quad, drawScene }) {
  let resolve = null;
  const uniforms = { uSbCaptureSlot: { value: 0 } };
  let frames = 0;
  let lastCapture = null;
  function render(camera, plan, millimetersPerWorldUnit) {
    if (!plan.subsurfaceSlots.length) return null;
    if (!Number.isFinite(millimetersPerWorldUnit) || millimetersPerWorldUnit <= 0) throw new Error('Subsurface requires an explicit positive world-to-millimeter scale');
    const capture = targets.acquire('subsurface capture', plan.diffusionWidth, plan.diffusionHeight, { attachments: 4, depth: true, precision: 'float' });
    const atlas = targets.acquire('subsurface delta atlas', plan.diffusionWidth, plan.diffusionHeight * plan.atlasSlots, { precision: 'float' });
    resolve ??= createSubsurfaceResolveMaterial(THREE);
    if (resolve.uniforms.uSbSampleCount.value !== plan.diffusionSamples) {
      resolve.uniforms.uSbDiskSamples.value = createBurleyDiskSamples(plan.diffusionSamples);
      resolve.uniforms.uSbSampleCount.value = plan.diffusionSamples;
    }
    resolve.uniforms.uSbIrradiance.value = capture.texture[0];
    resolve.uniforms.uSbGeometry.value = capture.texture[1];
    resolve.uniforms.uSbMeanFreePath.value = capture.texture[2];
    resolve.uniforms.uSbAlbedo.value = capture.texture[3];
    resolve.uniforms.uSbProjectionScale.value.set(camera.projectionMatrix.elements[0] * 0.5, camera.projectionMatrix.elements[5] * 0.5);
    resolve.uniforms.uSbOrthographic.value = camera.isOrthographicCamera ? 1 : 0;
    resolve.uniforms.uSbMillimetersPerWorldUnit.value = millimetersPerWorldUnit;
    scene.background = null;
    renderer.setClearColor(0, 0);
    renderer.setRenderTarget(atlas);
    renderer.clear(true, false, false);
    for (const slot of plan.subsurfaceSlots) {
      uniforms.uSbCaptureSlot.value = slot;
      renderer.setRenderTarget(capture);
      renderer.state.buffers.depth.setClear(1);
      renderer.clear(true, true, false);
      withSubstrateMaterialSelection(scene, (object, material) => material?.transparent ? captures.hidden : captures.acquire(object, material, 'subsurface', uniforms), () => drawScene(scene, camera));
      quad.draw(resolve, atlas, { x: 0, y: slot * plan.diffusionHeight, width: plan.diffusionWidth, height: plan.diffusionHeight });
    }
    frames++;
    lastCapture = capture;
    return atlas.texture;
  }
  return { render, capture: () => lastCapture, snapshot: () => ({ frames, method: 'burley-disk-quadrature', referenceCertified: false }),
    reset() { resolve?.dispose(); resolve = null; lastCapture = null; }, dispose() { resolve?.dispose(); resolve = null; lastCapture = null; } };
}
