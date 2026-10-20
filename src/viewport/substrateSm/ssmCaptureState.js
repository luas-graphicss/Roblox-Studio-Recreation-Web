function vector(values = [0, 0, 0, 0]) {
  return { isVector4: true, x: values[0], y: values[1], z: values[2], w: values[3],
    copy(other) { this.x = other.x; this.y = other.y; this.z = other.z; this.w = other.w; return this; } };
}

export function preserveSubstrateSmCaptureState(renderer) {
  const context = renderer.getContext();
  const target = renderer.getRenderTarget();
  const cubeFace = renderer.getActiveCubeFace?.() ?? 0;
  const mipmapLevel = renderer.getActiveMipmapLevel?.() ?? 0;
  const logicalViewport = renderer.getViewport(vector());
  const logicalScissor = renderer.getScissor(vector());
  const logicalScissorTest = renderer.getScissorTest();
  const viewport = vector(context.getParameter(context.VIEWPORT));
  const scissor = vector(context.getParameter(context.SCISSOR_BOX));
  const scissorTest = context.isEnabled(context.SCISSOR_TEST);
  if (!renderer.state?.viewport || !renderer.state?.scissor || !renderer.state?.setScissorTest) {
    throw new Error('SSM_QA_RENDERER_STATE_UNAVAILABLE');
  }
  return () => {
    renderer.setViewport(logicalViewport);
    renderer.setScissor(logicalScissor);
    renderer.setScissorTest(logicalScissorTest);
    renderer.setRenderTarget(target, cubeFace, mipmapLevel);
    renderer.state.viewport(viewport);
    renderer.state.scissor(scissor);
    renderer.state.setScissorTest(scissorTest);
  };
}
