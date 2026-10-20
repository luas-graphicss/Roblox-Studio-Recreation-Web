import { mlQa } from "./megaLightsTelemetry.js";

function mipLevelCountFor(width, height) {
  return Math.max(1, Math.floor(Math.log2(Math.max(width, height))) + 1);
}

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

function unavailableReasonFor(shaderLibrary, renderer) {
  if (!shaderLibrary) return "no three.js namespace was handed to the depth pyramid";
  if (typeof shaderLibrary.WebGLRenderTarget !== "function") {
    return "the three.js namespace has no WebGLRenderTarget";
  }
  if (!renderer) return "no renderer was handed to the depth pyramid";
  return "";
}


export function createMegaLightsHierarchicalZBuffer(setup) {
  const config = setup || {};
  const shaderLibrary = config.THREE || null;
  const renderer = config.renderer || null;
  const telemetry = config.telemetry || mlQa;

  const initialSize = drawingBufferSizeOf(shaderLibrary, renderer);
  let width = Math.max(1, Math.floor(Number(config.width) || initialSize.width));
  let height = Math.max(1, Math.floor(Number(config.height) || initialSize.height));
  let levels = [];
  let isBuiltByAPass = false;
  let unavailableReason = unavailableReasonFor(shaderLibrary, renderer);

  function disposeLevels() {
    levels.forEach((level) => {
      if (level.target && typeof level.target.dispose === "function") level.target.dispose();
    });
    levels = [];
    isBuiltByAPass = false;
  }

  function createLevelTarget(levelWidth, levelHeight) {
    return new shaderLibrary.WebGLRenderTarget(levelWidth, levelHeight, {
      type: shaderLibrary.FloatType,
      format: shaderLibrary.RedFormat,


      minFilter: shaderLibrary.NearestFilter,
      magFilter: shaderLibrary.NearestFilter,
      depthBuffer: false,
    });
  }

  function allocateLevels() {
    disposeLevels();
    if (unavailableReason) return 0;

    const totalLevelCount = mipLevelCountFor(width, height);
    let levelWidth = width;
    let levelHeight = height;
    try {
      for (let levelIndex = 0; levelIndex !== totalLevelCount; levelIndex += 1) {
        levels.push({
          mipIndex: levelIndex,
          width: levelWidth,
          height: levelHeight,
          target: createLevelTarget(levelWidth, levelHeight),
        });
        levelWidth = Math.max(1, levelWidth >> 1);
        levelHeight = Math.max(1, levelHeight >> 1);
      }
    } catch (error) {
      unavailableReason = String((error && error.message) || error);
      disposeLevels();
      telemetry.error("MegaLights depth pyramid unavailable: " + unavailableReason, "megaLightsHierarchicalZBuffer");
      return 0;
    }

    telemetry.phase("engine", {
      hierarchicalDepthLevels: levels.length,
      hierarchicalDepthWidth: width,
      hierarchicalDepthHeight: height,
      hierarchicalDepthReason: unavailableReason,
    });
    return levels.length;
  }

  if (unavailableReason) {
    telemetry.error("MegaLights depth pyramid unavailable: " + unavailableReason, "megaLightsHierarchicalZBuffer");
  }
  allocateLevels();

  return {
    levelCount() {
      return levels.length;
    },

    level(mipIndex) {
      return levels[mipIndex] || null;
    },

    textureFor(mipIndex) {
      const level = levels[mipIndex];
      return level && level.target ? level.target.texture : null;
    },


    markBuilt(hasBeenBuilt) {
      isBuiltByAPass = !!hasBeenBuilt;
      return isBuiltByAPass;
    },

    isBuilt() {
      return isBuiltByAPass;
    },

    resize(nextWidth, nextHeight) {
      width = Math.max(1, Math.floor(Number(nextWidth) || width));
      height = Math.max(1, Math.floor(Number(nextHeight) || height));
      allocateLevels();
      return { width, height, levels: levels.length };
    },

    describe() {
      return {
        available: levels.length !== 0,
        reason: unavailableReason,
        width,
        height,
        levels: levels.length,
        built: isBuiltByAPass,
        builtBy: "ML-F5 lightGrid / ML-F14 screenTrace",
      };
    },

    dispose: disposeLevels,
  };
}
