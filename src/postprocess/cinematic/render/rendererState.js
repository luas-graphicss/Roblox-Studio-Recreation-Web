export function withRendererState(THREE, renderer, operation) {
  const savedTarget = renderer.getRenderTarget();
  const savedViewport = renderer.getViewport(new THREE.Vector4());
  const savedScissor = renderer.getScissor(new THREE.Vector4());
  const savedScissorTest = renderer.getScissorTest();
  const savedColor = renderer.getClearColor(new THREE.Color());
  const savedAlpha = renderer.getClearAlpha();
  const savedAutoClear = renderer.autoClear;
  try { return operation(); }
  finally {
    renderer.setRenderTarget(savedTarget);
    renderer.setViewport(savedViewport);
    renderer.setScissor(savedScissor);
    renderer.setScissorTest(savedScissorTest);
    renderer.setClearColor(savedColor, savedAlpha);
    renderer.autoClear = savedAutoClear;
  }
}
