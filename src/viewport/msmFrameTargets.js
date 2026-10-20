export function createMsmFrameTargets({ THREE, renderer }) {
  const webgl2 = renderer.capabilities.isWebGL2 === true;
  const signals = [];
  const moments = [];
  let width = 0;
  let height = 0;
  let historyIndex = 0;
  let momentIndex = 0;
  let valid = false;
  let generation = 0;

  function disposeTargets() {
    for (const target of [...signals, ...moments]) target.dispose();
    signals.length = 0;
    moments.length = 0;
    valid = false;
  }

  function ensure(nextWidth, nextHeight) {
    if (width === nextWidth && height === nextHeight && signals.length === 3) return false;
    width = Math.max(1, Math.floor(nextWidth));
    height = Math.max(1, Math.floor(nextHeight));
    historyIndex = 0;
    momentIndex = 0;
    valid = false;
    generation += 1;
    if (signals.length === 3 && moments.length === 2) {

      for (const target of [...signals, ...moments]) target.setSize(width, height);
      return true;
    }
    for (let index = 0; index < 3; index += 1) {
      const target = new THREE.WebGLRenderTarget(width, height, {
        type: THREE.HalfFloatType, format: THREE.RGBAFormat,
        minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
        depthBuffer: false, stencilBuffer: false,
      });
      target.texture.generateMipmaps = webgl2;
      if (!webgl2) target.texture.minFilter = THREE.LinearFilter;
      target.texture.name = 'MSM signal ' + index;
      signals.push(target);
    }
    for (let index = 0; index < 2; index += 1) {
      const target = new THREE.WebGLRenderTarget(width, height, {
        type: THREE.HalfFloatType, format: webgl2 ? THREE.RGFormat : THREE.RGBAFormat,
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
        depthBuffer: false, stencilBuffer: false,
      });
      target.texture.generateMipmaps = false;
      target.texture.name = 'MSM moments ' + index;
      moments.push(target);
    }
    return true;
  }

  function frame() {
    return {
      history: signals[historyIndex],
      sample: signals[(historyIndex + 1) % 3],
      temporal: signals[(historyIndex + 2) % 3],
      previousMoments: moments[momentIndex],
      nextMoments: moments[1 - momentIndex],
      valid,
    };
  }

  function commit(spatialApplied) {
    historyIndex = (historyIndex + (spatialApplied ? 1 : 2)) % 3;
    momentIndex = 1 - momentIndex;
    valid = true;
  }

  return {
    ensure, frame, commit,
    allocateGpu: () => {
      const previous = renderer.getRenderTarget();
      const gl = renderer.getContext();
      try {
        for (const target of [...signals, ...moments]) {
          renderer.setRenderTarget(target);
          if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
            throw new Error('MSM half-float render target is not supported by this device');
        }
      } finally { renderer.setRenderTarget(previous); }
    },
    invalidate: () => { valid = false; },
    history: () => valid ? signals[historyIndex] : null,
    describe: () => ({ width, height, generation, valid, signalCount: signals.length,
      momentCount: moments.length, mipmappedHistory: webgl2 }),
    dispose: disposeTargets,
  };
}
