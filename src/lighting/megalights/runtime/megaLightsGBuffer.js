import { mlQa } from "./megaLightsTelemetry.js";


export const SCENE_INPUT_ATTACHMENT_NAMES = Object.freeze([
  "sceneDepth",
  "sceneNormal",
  "sceneAlbedo",
  "sceneVelocity",
]);

function drawingBufferSizeOf(shaderLibrary, renderer) {
  if (renderer && typeof renderer.getDrawingBufferSize === "function" && shaderLibrary && shaderLibrary.Vector2) {
    const measuredSize = renderer.getDrawingBufferSize(new shaderLibrary.Vector2());
    return {
      width: Math.max(1, Math.floor(measuredSize.x)),
      height: Math.max(1, Math.floor(measuredSize.y)),
    };
  }
  const canvas = renderer ? renderer.domElement : null;
  return {
    width: Math.max(1, Math.floor((canvas && canvas.width) || 1)),
    height: Math.max(1, Math.floor((canvas && canvas.height) || 1)),
  };
}

function createMultipleRenderTarget(shaderLibrary, width, height, attachmentCount) {
  const targetOptions = {
    type: shaderLibrary.HalfFloatType,
    minFilter: shaderLibrary.NearestFilter,
    magFilter: shaderLibrary.NearestFilter,
  };
  if (typeof shaderLibrary.WebGLMultipleRenderTargets === "function") {
    return new shaderLibrary.WebGLMultipleRenderTargets(width, height, attachmentCount, targetOptions);
  }
  return new shaderLibrary.WebGLRenderTarget(
    width,
    height,
    Object.assign({ count: attachmentCount }, targetOptions),
  );
}

function unavailableReasonFor(shaderLibrary, renderer) {
  if (!shaderLibrary) return "no three.js namespace was handed to the G-buffer";
  if (typeof shaderLibrary.WebGLRenderTarget !== "function") {
    return "the three.js namespace has no WebGLRenderTarget";
  }
  if (!renderer) return "no renderer was handed to the G-buffer";
  return "";
}


export function createMegaLightsGBuffer(setup) {
  const config = setup || {};
  const shaderLibrary = config.THREE || null;
  const renderer = config.renderer || null;
  const telemetry = config.telemetry || mlQa;

  const initialSize = drawingBufferSizeOf(shaderLibrary, renderer);
  let width = Math.max(1, Math.floor(Number(config.width) || initialSize.width));
  let height = Math.max(1, Math.floor(Number(config.height) || initialSize.height));

  let renderTarget = null;
  let isAllocated = false;
  let unavailableReason = unavailableReasonFor(shaderLibrary, renderer);

  if (!unavailableReason) {
    try {
      renderTarget = createMultipleRenderTarget(shaderLibrary, width, height, SCENE_INPUT_ATTACHMENT_NAMES.length);
      isAllocated = true;
    } catch (error) {
      unavailableReason = String((error && error.message) || error);
    }
  }

  if (!isAllocated) {
    telemetry.error("MegaLights G-buffer unavailable: " + unavailableReason, "megaLightsGBuffer");
  }

  telemetry.phase("engine", {
    gBufferAvailable: isAllocated,
    gBufferAttachments: SCENE_INPUT_ATTACHMENT_NAMES.slice(),
    gBufferReason: unavailableReason,
    gBufferWidth: width,
    gBufferHeight: height,
  });

  return {
    attachments: SCENE_INPUT_ATTACHMENT_NAMES,

    isAvailable() {
      return isAllocated;
    },


    textureFor(attachmentName) {
      if (!isAllocated || !renderTarget) return null;
      const attachmentIndex = SCENE_INPUT_ATTACHMENT_NAMES.indexOf(attachmentName);
      if (attachmentIndex === -1) return null;
      return Array.isArray(renderTarget.texture) ? renderTarget.texture[attachmentIndex] : renderTarget.texture;
    },

    target() {
      return renderTarget;
    },

    size() {
      return { width, height };
    },

    resize(nextWidth, nextHeight) {
      width = Math.max(1, Math.floor(Number(nextWidth) || width));
      height = Math.max(1, Math.floor(Number(nextHeight) || height));
      if (renderTarget && typeof renderTarget.setSize === "function") renderTarget.setSize(width, height);
      return { width, height };
    },

    describe() {
      return {
        available: isAllocated,
        reason: unavailableReason,
        width,
        height,
        attachments: SCENE_INPUT_ATTACHMENT_NAMES.slice(),

        filledBy: "ML-F3 sceneInputs",
      };
    },

    dispose() {
      if (renderTarget && typeof renderTarget.dispose === "function") renderTarget.dispose();
      renderTarget = null;
      isAllocated = false;
    },
  };
}
