export function withSubstrateRenderState({ THREE, renderer, scene }, callback) {
  const target = renderer.getRenderTarget();
  const cubeFace = renderer.getActiveCubeFace();
  const mipLevel = renderer.getActiveMipmapLevel();
  const viewport = renderer.getViewport(new THREE.Vector4());
  const currentViewport = renderer.getCurrentViewport(new THREE.Vector4());
  const gl = renderer.getContext();
  const currentScissor = new THREE.Vector4().fromArray(gl.getParameter(gl.SCISSOR_BOX));
  const currentScissorTest = gl.getParameter(gl.SCISSOR_TEST);
  const scissor = renderer.getScissor(new THREE.Vector4());
  const clearColor = renderer.getClearColor(new THREE.Color());
  const clearAlpha = renderer.getClearAlpha();
  const scissorTest = renderer.getScissorTest();
  const autoClear = renderer.autoClear;
  const shadowAutoUpdate = renderer.shadowMap.autoUpdate;
  const shadowNeedsUpdate = renderer.shadowMap.needsUpdate;
  const background = scene.background;
  const overrideMaterial = scene.overrideMaterial;
  const depthClear = renderer.getContext().getParameter(renderer.getContext().DEPTH_CLEAR_VALUE);
  try {
    renderer.autoClear = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    renderer.setScissorTest(false);
    return callback();
  } finally {
    scene.background = background;
    scene.overrideMaterial = overrideMaterial;
    renderer.shadowMap.autoUpdate = shadowAutoUpdate;
    renderer.shadowMap.needsUpdate = shadowNeedsUpdate;
    renderer.autoClear = autoClear;
    renderer.state.buffers.depth.setClear(depthClear);
    renderer.setClearColor(clearColor, clearAlpha);
    renderer.setViewport(viewport);
    renderer.setScissor(scissor);
    renderer.setScissorTest(scissorTest);
    if (target) {
      const targetViewport = target.viewport.clone();
      const targetScissor = target.scissor.clone();
      const targetScissorTest = target.scissorTest;
      try {
        target.viewport.copy(currentViewport);
        target.scissor.copy(currentScissor);
        target.scissorTest = currentScissorTest;
        renderer.setRenderTarget(target, cubeFace, mipLevel);
      } finally {
        target.viewport.copy(targetViewport);
        target.scissor.copy(targetScissor);
        target.scissorTest = targetScissorTest;
      }
    } else renderer.setRenderTarget(null, cubeFace, mipLevel);
  }
}

export function withSubstrateMaterialSelection(scene, selectMaterial, callback) {
  const changed = [];
  try {
    scene.traverseVisible(object => {
      if (!object.material) return;
      const original = object.material;
      const replacement = Array.isArray(original) ? original.map(material => selectMaterial(object, material)) : selectMaterial(object, original);
      changed.push({ object, original });
      object.material = replacement;
    });
    return callback();
  }
  finally { for (const { object, original } of changed) object.material = original; }
}
