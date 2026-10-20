import { MGL_BUFFERS } from "./mlPipelineContract.js";

export const HISTORY_BUFFER_NAMES = Object.freeze(["historyDiffuse", "historySpecular"]);
export const TEMPORAL_VARIANCE_BUFFER_NAME = "temporalVariance";

export function historyBufferDeclaration(bufferName) {
  return MGL_BUFFERS[bufferName] || null;
}

function textureOptionsForFormat(THREE, formatName) {
  if (formatName === "rgba16f") return { format: THREE.RGBAFormat, type: THREE.HalfFloatType };
  if (formatName === "rg16f") return { format: THREE.RGFormat, type: THREE.HalfFloatType };
  return null;
}

function baseTargetOptions(THREE) {
  return {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  };
}

function createHistoryTarget(THREE, width, height) {
  const declaration = historyBufferDeclaration(HISTORY_BUFFER_NAMES[0]);
  const formatOptions = textureOptionsForFormat(THREE, declaration && declaration.format);
  if (!formatOptions) return null;
  const options = Object.assign(baseTargetOptions(THREE), formatOptions);


  if (typeof THREE.WebGLMultipleRenderTargets === "function") {
    return new THREE.WebGLMultipleRenderTargets(width, height, HISTORY_BUFFER_NAMES.length, options);
  }
  return new THREE.WebGLRenderTarget(width, height, Object.assign({ count: HISTORY_BUFFER_NAMES.length }, options));
}

function createVarianceTarget(THREE, width, height) {
  const declaration = historyBufferDeclaration(TEMPORAL_VARIANCE_BUFFER_NAME);
  const formatOptions = textureOptionsForFormat(THREE, declaration && declaration.format);
  if (!formatOptions) return null;
  return new THREE.WebGLRenderTarget(width, height, Object.assign(baseTargetOptions(THREE), formatOptions));
}

function textureAt(renderTarget, attachmentIndex) {
  if (!renderTarget) return null;
  if (Array.isArray(renderTarget.textures)) return renderTarget.textures[attachmentIndex] || null;
  if (Array.isArray(renderTarget.texture)) return renderTarget.texture[attachmentIndex] || null;
  return attachmentIndex === 0 ? renderTarget.texture || null : null;
}

function disposeTarget(renderTarget) {
  if (renderTarget && typeof renderTarget.dispose === "function") renderTarget.dispose();
}


export function createHistoryBuffers(dependencies) {
  const THREE = dependencies && dependencies.THREE ? dependencies.THREE : null;
  let historyTargets = [null, null];
  let varianceTargets = [null, null];
  let readIndex = 0;
  let allocatedWidth = 0;
  let allocatedHeight = 0;
  let promotedFrameCount = 0;

  function dispose() {
    historyTargets.forEach(disposeTarget);
    varianceTargets.forEach(disposeTarget);
    historyTargets = [null, null];
    varianceTargets = [null, null];
    readIndex = 0;
    allocatedWidth = 0;
    allocatedHeight = 0;
  }

  function ensure(width, height) {
    const requestedWidth = Math.max(1, Math.floor(Number(width) || 0));
    const requestedHeight = Math.max(1, Math.floor(Number(height) || 0));
    if (!THREE) {
      return { allocated: false, reason: "no THREE injected", width: 0, height: 0 };
    }
    if (historyTargets[0] && allocatedWidth === requestedWidth && allocatedHeight === requestedHeight) {
      return { allocated: true, reason: "", width: allocatedWidth, height: allocatedHeight };
    }


    dispose();
    const nextHistoryTargets = [
      createHistoryTarget(THREE, requestedWidth, requestedHeight),
      createHistoryTarget(THREE, requestedWidth, requestedHeight),
    ];
    const nextVarianceTargets = [
      createVarianceTarget(THREE, requestedWidth, requestedHeight),
      createVarianceTarget(THREE, requestedWidth, requestedHeight),
    ];
    if (nextHistoryTargets.some((target) => !target) || nextVarianceTargets.some((target) => !target)) {
      nextHistoryTargets.forEach(disposeTarget);
      nextVarianceTargets.forEach(disposeTarget);
      return {
        allocated: false,
        reason: "MGL_BUFFERS declares a format this glue cannot map to a three texture format",
        width: 0,
        height: 0,
      };
    }

    historyTargets = nextHistoryTargets;
    varianceTargets = nextVarianceTargets;
    allocatedWidth = requestedWidth;
    allocatedHeight = requestedHeight;
    return { allocated: true, reason: "", width: allocatedWidth, height: allocatedHeight };
  }

  function writeIndex() {
    return readIndex === 0 ? 1 : 0;
  }

  return {
    ensure,
    dispose,
    size: () => ({ width: allocatedWidth, height: allocatedHeight }),


    readTarget: () => historyTargets[readIndex],
    varianceReadTarget: () => varianceTargets[readIndex],


    writeTarget: () => historyTargets[writeIndex()],
    varianceWriteTarget: () => varianceTargets[writeIndex()],


    swap() {
      readIndex = writeIndex();
      promotedFrameCount++;
      return promotedFrameCount;
    },

    promotedFrameCount: () => promotedFrameCount,


    textureFor(bufferName) {
      if (bufferName === TEMPORAL_VARIANCE_BUFFER_NAME) {
        const target = varianceTargets[readIndex];
        return target ? target.texture || null : null;
      }
      const attachmentIndex = HISTORY_BUFFER_NAMES.indexOf(bufferName);
      return attachmentIndex < 0 ? null : textureAt(historyTargets[readIndex], attachmentIndex);
    },

    describe() {
      return {
        buffers: HISTORY_BUFFER_NAMES.concat([TEMPORAL_VARIANCE_BUFFER_NAME]).map((bufferName) => ({
          name: bufferName,
          declared: historyBufferDeclaration(bufferName),
          allocated: !!historyTargets[0],
        })),
        width: allocatedWidth,
        height: allocatedHeight,
        attachmentsInTheHistoryTarget: HISTORY_BUFFER_NAMES.length,
        pingPongSides: historyTargets.length,
        promotedFrameCount,
        nearestFilteringOnly: true,
      };
    },
  };
}
