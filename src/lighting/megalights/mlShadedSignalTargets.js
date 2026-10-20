import { MGL_BUFFERS } from "./mlPipelineContract.js";

export const SHADED_SIGNAL_BUFFER_NAMES = Object.freeze(["shadedDiffuse", "shadedSpecular"]);

export function shadedSignalBufferDeclaration(bufferName) {
  return MGL_BUFFERS[bufferName] || null;
}

export function downsampledSize(fullWidth, fullHeight, downsampleFactor) {
  const factor = Number.isFinite(downsampleFactor) && downsampleFactor >= 1 ? downsampleFactor : 1;
  return {
    width: Math.max(1, Math.round(fullWidth / factor)),
    height: Math.max(1, Math.round(fullHeight / factor)),
    factor,
  };
}

function createMultiTarget(THREE, width, height) {
  const options = {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  };


  if (typeof THREE.WebGLMultipleRenderTargets === "function") {
    return new THREE.WebGLMultipleRenderTargets(width, height, SHADED_SIGNAL_BUFFER_NAMES.length, options);
  }
  return new THREE.WebGLRenderTarget(
    width,
    height,
    Object.assign({ count: SHADED_SIGNAL_BUFFER_NAMES.length }, options),
  );
}

function textureAt(renderTarget, attachmentIndex) {
  if (!renderTarget) return null;
  if (Array.isArray(renderTarget.textures)) return renderTarget.textures[attachmentIndex] || null;
  if (Array.isArray(renderTarget.texture)) return renderTarget.texture[attachmentIndex] || null;
  return attachmentIndex === 0 ? renderTarget.texture || null : null;
}


export function createShadedSignalTargets(dependencies) {
  const THREE = dependencies && dependencies.THREE ? dependencies.THREE : null;
  let renderTarget = null;
  let allocatedWidth = 0;
  let allocatedHeight = 0;

  function ensure(fullWidth, fullHeight, downsampleFactor) {
    const size = downsampledSize(fullWidth, fullHeight, downsampleFactor);
    if (!THREE) return { allocated: false, reason: "no THREE injected", width: 0, height: 0 };
    if (renderTarget && allocatedWidth === size.width && allocatedHeight === size.height) {
      return { allocated: true, reason: "", width: allocatedWidth, height: allocatedHeight };
    }
    dispose();
    renderTarget = createMultiTarget(THREE, size.width, size.height);
    allocatedWidth = size.width;
    allocatedHeight = size.height;
    return { allocated: true, reason: "", width: allocatedWidth, height: allocatedHeight };
  }

  function dispose() {
    if (renderTarget && typeof renderTarget.dispose === "function") renderTarget.dispose();
    renderTarget = null;
    allocatedWidth = 0;
    allocatedHeight = 0;
  }

  return {
    ensure,
    dispose,
    target: () => renderTarget,
    size: () => ({ width: allocatedWidth, height: allocatedHeight }),
    textureFor(bufferName) {
      const attachmentIndex = SHADED_SIGNAL_BUFFER_NAMES.indexOf(bufferName);
      return attachmentIndex < 0 ? null : textureAt(renderTarget, attachmentIndex);
    },
    describe() {
      return {
        buffers: SHADED_SIGNAL_BUFFER_NAMES.map((bufferName) => ({
          name: bufferName,
          declared: shadedSignalBufferDeclaration(bufferName),
          allocated: !!renderTarget,
        })),
        width: allocatedWidth,
        height: allocatedHeight,
        attachmentsInOneTarget: SHADED_SIGNAL_BUFFER_NAMES.length,
      };
    },
  };
}
