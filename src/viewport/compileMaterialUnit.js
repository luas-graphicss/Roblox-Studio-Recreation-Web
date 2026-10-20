export function compileMaterialUnit({
  renderer,
  scratchScene,
  camera,
  targetScene,
  unit,
  renderTarget,
}) {
  if (!unit?.object || !unit.material) return { yieldFrame: false };
  const objectView = Object.create(unit.object);
  Object.defineProperties(objectView, {
    children: { value: [], writable: true },
    material: { value: unit.material, writable: true },
  });
  const programs = renderer.info?.programs;
  const previousProgramCount = programs?.length;
  const previousLastProgram = programs?.at(-1);
  const changesRenderTarget = renderTarget !== undefined;
  const previousTarget = changesRenderTarget ? renderer.getRenderTarget() : null;
  const previousFace = changesRenderTarget ? renderer.getActiveCubeFace?.() ?? 0 : 0;
  const previousMipmap = changesRenderTarget ? renderer.getActiveMipmapLevel?.() ?? 0 : 0;
  scratchScene.children.length = 0;
  scratchScene.children.push(objectView);
  try {
    if (changesRenderTarget) renderer.setRenderTarget(renderTarget);
    renderer.compile(scratchScene, camera, targetScene);
    const currentPrograms = renderer.info?.programs;
    return {
      yieldFrame: !Number.isFinite(previousProgramCount) ||
        currentPrograms?.length !== previousProgramCount ||
        currentPrograms?.at(-1) !== previousLastProgram,
    };
  } finally {
    scratchScene.children.length = 0;
    if (changesRenderTarget) renderer.setRenderTarget(previousTarget, previousFace, previousMipmap);
  }
}
