const REQUIRED_GENERATOR_METHODS = [
  '_setSize', '_allocateTargets', '_compileMaterial', '_textureToCubeUV',
  '_applyPMREM', '_halfBlur', 'compileCubemapShader', 'compileEquirectangularShader',
];

function releaseResource(resource) {
  try { resource?.dispose(); } catch {                                              }
}

function notify(listener, payload) {
  try { listener?.(payload); } catch {                                                   }
}

function withRenderTarget(renderer, target, action) {
  const previousTarget = renderer.getRenderTarget();
  const previousFace = renderer.getActiveCubeFace?.() ?? 0;
  const previousMipmap = renderer.getActiveMipmapLevel?.() ?? 0;
  const previousAutoClear = renderer.autoClear;
  try {
    if (target) renderer.setRenderTarget(target);
    return action();
  } finally {
    renderer.autoClear = previousAutoClear;
    renderer.setRenderTarget(previousTarget, previousFace, previousMipmap);
  }
}


function collectBlurSteps(generator, outputTarget, renderer) {
  const originalHalfBlur = generator._halfBlur;
  const steps = [];
  try {
    generator._halfBlur = (...argumentsForBlur) => steps.push(argumentsForBlur);
    withRenderTarget(renderer, null, () => generator._applyPMREM(outputTarget));
  } finally {
    generator._halfBlur = originalHalfBlur;
  }
  return steps;
}

function programsAreReady(programs) {
  for (const program of programs) {
    if (typeof program?.isReady !== 'function') continue;
    try {
      if (!program.isReady()) return false;
    } catch {                                                                      }
  }
  return true;
}

export function createIncrementalEnvironmentPrefilter({
  THREE,
  renderer,
  onReady,
  onError,
  requestRender = () => {},
  now = () => globalThis.performance?.now() ?? Date.now(),
  timeoutMs = 30000,
} = {}) {
  let generator = null;
  let activeRequest = null;
  let settledKey = null;
  let disposed = false;

  function releaseRequest(request) {
    if (!request) return;
    if (!request.published) releaseResource(request.outputTarget);
    request.outputTarget = null;
    if (request.releaseSource) releaseResource(request.texture);
    request.releaseSource = false;
  }

  function cancel() {
    const cancelledRequest = activeRequest;
    activeRequest = null;
    settledKey = null;
    try { cancelledRequest?.iterator.return(); } finally { releaseRequest(cancelledRequest); }
  }

  function* prepareTexture(request) {
    if (!generator) {
      generator = new THREE.PMREMGenerator(renderer);
      for (const method of REQUIRED_GENERATOR_METHODS) {
        if (typeof generator[method] !== 'function') {
          throw new Error(`The installed PMREM generator does not support incremental ${method}.`);
        }
      }
    }
    const texture = request.texture;
    const isCubemap = texture.mapping === THREE.CubeReflectionMapping ||
      texture.mapping === THREE.CubeRefractionMapping;
    const cubeSize = isCubemap
      ? (texture.image.length === 0 ? 16 : texture.image[0].width || texture.image[0].image.width)
      : texture.image.width / 4;
    if (!Number.isFinite(cubeSize) || cubeSize < 16) {
      throw new Error('Environment prefiltering requires a valid texture of at least 16 pixels per face.');
    }
    generator._setSize(cubeSize);
    const outputTarget = generator._allocateTargets();
    request.outputTarget = outputTarget;
    const blurSteps = collectBlurSteps(generator, outputTarget, renderer);
    const totalWorkUnits = 4 + blurSteps.length;
    let completedWorkUnits = 1;
    yield completedWorkUnits / totalWorkUnits;


    withRenderTarget(renderer, outputTarget, () => {
      const conversionMaterial = isCubemap ? generator._cubemapMaterial : generator._equirectMaterial;
      if (conversionMaterial) generator._compileMaterial(conversionMaterial);
      else if (isCubemap) generator.compileCubemapShader();
      else generator.compileEquirectangularShader();
    });
    yield ++completedWorkUnits / totalWorkUnits;
    withRenderTarget(renderer, outputTarget, () => generator._compileMaterial(generator._blurMaterial));
    yield ++completedWorkUnits / totalWorkUnits;


    const programs = Array.from(renderer.info?.programs || []);
    while (!programsAreReady(programs)) yield completedWorkUnits / totalWorkUnits;

    withRenderTarget(renderer, null, () => generator._textureToCubeUV(texture, outputTarget));
    yield ++completedWorkUnits / totalWorkUnits;
    for (const argumentsForBlur of blurSteps) {
      withRenderTarget(renderer, null, () => {
        renderer.autoClear = false;
        generator._halfBlur(...argumentsForBlur);
      });
      yield ++completedWorkUnits / totalWorkUnits;
    }
    outputTarget.scissorTest = false;
    outputTarget.viewport.set(0, 0, outputTarget.width, outputTarget.height);
    outputTarget.scissor.set(0, 0, outputTarget.width, outputTarget.height);
    return outputTarget;
  }

  function request({ key, texture, releaseSource = false } = {}) {
    if (disposed) {
      if (releaseSource) releaseResource(texture);
      return false;
    }
    if (typeof key !== 'string' || !texture) throw new TypeError('An environment request needs a key and texture.');
    if (activeRequest?.key === key || settledKey === key) {
      if (releaseSource && activeRequest?.texture !== texture) releaseResource(texture);
      return false;
    }
    cancel();
    const nextRequest = {
      key, texture, releaseSource, published: false, outputTarget: null,
      progress: 0, startedAt: now(), iterator: null,
    };
    nextRequest.iterator = prepareTexture(nextRequest);
    activeRequest = nextRequest;
    requestRender();
    return true;
  }


  function step() {
    const requestInProgress = activeRequest;
    if (!requestInProgress || disposed) return false;
    try {
      if (renderer.getContext?.().isContextLost?.()) throw new Error('The graphics context was lost during environment preparation.');
      if (now() - requestInProgress.startedAt >= timeoutMs) throw new Error('Environment preparation exceeded its loading deadline.');
      const outcome = requestInProgress.iterator.next();
      if (!outcome.done) {
        requestInProgress.progress = Math.min(0.99, outcome.value);
        requestRender();
        return true;
      }
      activeRequest = null;
      settledKey = requestInProgress.key;
      onReady?.({ key: requestInProgress.key, texture: requestInProgress.texture, target: outcome.value });
      requestInProgress.published = true;
      releaseRequest(requestInProgress);
      requestRender();
      return false;
    } catch (error) {
      activeRequest = null;
      settledKey = requestInProgress.key;
      try { requestInProgress.iterator.return(); } finally { releaseRequest(requestInProgress); }
      notify(onError, { key: requestInProgress.key, error });
      requestRender();
      return false;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancel();
    releaseResource(generator);
    generator = null;
  }

  return Object.freeze({
    request, step, cancel, dispose,
    isPending: () => activeRequest !== null,
    hasRequest: (key) => activeRequest?.key === key || settledKey === key,
    getProgress: () => activeRequest?.progress ?? 1,
  });
}
