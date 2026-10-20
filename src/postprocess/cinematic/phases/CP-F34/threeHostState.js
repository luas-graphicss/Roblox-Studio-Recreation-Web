import { requireSynchronous } from "./adapterValidation.js";
import { requireSynchronousCallback } from "./synchronousCallbacks.js";

export function withThreeHostState({ THREE, renderer, scene, camera }, operation) {
  requireSynchronousCallback(operation, "Protected frame");
  const target = renderer.getRenderTarget();
  const cubeFace = renderer.getActiveCubeFace?.() ?? 0;
  const mipLevel = renderer.getActiveMipmapLevel?.() ?? 0;
  const viewport = renderer.getViewport(new THREE.Vector4());
  const scissor = renderer.getScissor(new THREE.Vector4());
  const scissorTest = renderer.getScissorTest();
  const clearColor = renderer.getClearColor(new THREE.Color());
  const clearAlpha = renderer.getClearAlpha();
  const rendererValues = {};
  for (const key of ["autoClear", "autoClearColor", "autoClearDepth", "autoClearStencil", "toneMapping", "toneMappingExposure", "outputColorSpace"]) rendererValues[key] = renderer[key];
  const projection = camera.projectionMatrix.clone();
  const inverseProjection = camera.projectionMatrixInverse.clone();
  const overrideMaterial = scene.overrideMaterial;
  const errors = [];
  let result;
  let operationFailed = false;

  try { result = requireSynchronous(operation(), "Protected frame"); }
  catch (error) { operationFailed = true; errors.push(error); }

  const restoreOperations = [
    () => camera.projectionMatrix.copy(projection),
    () => camera.projectionMatrixInverse.copy(inverseProjection),
    () => { scene.overrideMaterial = overrideMaterial; },
    ...Object.entries(rendererValues).map(([key, value]) => () => { renderer[key] = value; }),
    () => renderer.setRenderTarget(target, cubeFace, mipLevel),
    () => renderer.setViewport(viewport),
    () => renderer.setScissor(scissor),
    () => renderer.setScissorTest(scissorTest),
    () => renderer.setClearColor(clearColor, clearAlpha)
  ];
  for (const restore of restoreOperations) {
    try { requireSynchronous(restore(), "Host state restoration"); }
    catch (error) { errors.push(error); }
  }
  if (operationFailed && errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, "Protected frame or host state restoration failed");
  return result;
}
