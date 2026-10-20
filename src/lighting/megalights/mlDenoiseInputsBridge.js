import {
  DEFAULT_DENOISE_UPSAMPLE_FACTOR,
  DEFAULT_MAX_DENOISE_PIXELS,
  denoiseResolutionFor,
  fullPixelColumnOfDenoiseColumn,
  fullPixelRowOfDenoiseRow,
} from "./mlDenoiseResolutionCore.js";

export const DENOISE_INPUTS_OWNER = "ML-F19+ML-F20";


export { DEFAULT_DENOISE_UPSAMPLE_FACTOR, DEFAULT_MAX_DENOISE_PIXELS };

export const DENOISE_INPUTS_REFUSAL = Object.freeze({
  none: "none",
  shadingFrameMissing:
    "the sample shading bundle was not assembled this frame, so there is no shaded grid to resolve",
  emptyGrid: "the shaded grid has no pixels",
});


export const DENOISE_INPUTS_RESIDUALS = Object.freeze([
  "ML-F19 publishes ONE radiance per pixel (diffuse plus specular, summed on purpose). ML-F20 needs the two lobes apart, so readCurrentPixel takes them from the ML-F18 grid at the nearest tap instead of from the upsampled image. The upsampled image is what proves the no-hole gate; it is not what the temporal filter integrates.",
  "the denoise chain runs at the shaded grid times denoiseUpsampleFactor, never at screen resolution: this is the CPU reference path and no number measured through it is a performance number.",
  "the history rejection of ML-F20 reads the geometry of the CURRENT frame at the reprojected tap, which is the residue ML-F20 already declared. This bridge does not add previous-frame geometry, because no buffer of the contract carries it.",
]);


function hashedUnitValue(pixelX, pixelY, frameIndex) {
  let hash =
    (Math.imul(pixelX + 1, 73856093) ^ Math.imul(pixelY + 1, 19349663) ^ Math.imul(frameIndex + 1, 83492791)) >>> 0;
  hash = (hash ^ (hash >>> 13)) >>> 0;
  hash = Math.imul(hash, 1274126177) >>> 0;
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}


export function createDenoiseInputsBridge(dependencies) {
  const settings = dependencies || {};
  const telemetry = settings.telemetry || null;
  const maxDenoisePixels =
    Math.floor(Number(settings.maxDenoisePixels)) > 0
      ? Math.floor(Number(settings.maxDenoisePixels))
      : DEFAULT_MAX_DENOISE_PIXELS;
  const requestedUpsampleFactor =
    Math.floor(Number(settings.denoiseUpsampleFactor)) > 0
      ? Math.floor(Number(settings.denoiseUpsampleFactor))
      : DEFAULT_DENOISE_UPSAMPLE_FACTOR;

  const state = {
    refusal: DENOISE_INPUTS_REFUSAL.shadingFrameMissing,
    previousFrameContext: null,
    lastFrame: null,
  };
  let lastPublishedSignature = "";


  const centerGeometry = { depth: 0, normal: { x: 0, y: 0, z: 1 } };
  const tapGeometry = { depth: 0, normal: { x: 0, y: 0, z: 1 } };
  const currentPixel = {
    diffuse: { r: 0, g: 0, b: 0 },
    specular: { r: 0, g: 0, b: 0 },
    depth: 0,
    normal: { x: 0, y: 0, z: 1 },
    encodedVelocity: [0.5, 0.5],
    velocityIsValid: false,
  };
  const historyPixel = { accumulatedFrameCount: 0, radiance: { r: 0, g: 0, b: 0 } };

  function copyGeometryFromSurface(surface, destination) {
    destination.depth = surface ? Number(surface.linearViewDepth) || 0 : 0;
    const normal = surface && surface.normal ? surface.normal : null;
    destination.normal.x = normal ? normal.x : 0;
    destination.normal.y = normal ? normal.y : 0;
    destination.normal.z = normal ? normal.z : 1;
    return destination;
  }

  function publishWhenChanged() {
    if (!telemetry || typeof telemetry.phase !== "function") return;
    const frame = state.lastFrame;
    const signature = [
      state.refusal,
      frame ? frame.denoiseWidth : 0,
      frame ? frame.denoiseHeight : 0,
      frame ? frame.denoiseUpsampleFactor : 0,
      frame ? frame.historyAvailable : false,
    ].join("|");
    if (signature === lastPublishedSignature) return;
    lastPublishedSignature = signature;
    telemetry.phase("ML-F19:inputsBridge", {
      assembles: "frameContext.upsampleInputs and frameContext.temporalFilterInputs",
      refusal: state.refusal,
      frame,
      residuals: DENOISE_INPUTS_RESIDUALS,
    });
  }

  function refuse(reason) {
    state.refusal = reason;
    state.lastFrame = null;
    state.previousFrameContext = null;
    publishWhenChanged();
    return { ready: false, refusal: reason };
  }


  function execute(frameContext, shadingFrame) {
    const context = frameContext || {};
    if (!shadingFrame || !shadingFrame.ready) return refuse(DENOISE_INPUTS_REFUSAL.shadingFrameMissing);

    const gridWidth = Math.floor(Number(shadingFrame.gridWidth) || 0);
    const gridHeight = Math.floor(Number(shadingFrame.gridHeight) || 0);
    if (!(gridWidth >= 1) || !(gridHeight >= 1)) return refuse(DENOISE_INPUTS_REFUSAL.emptyGrid);


    const declaredResolution = shadingFrame.denoiseResolution;
    const denoiseResolution =
      declaredResolution && Math.floor(Number(declaredResolution.width)) >= 1
        ? declaredResolution
        : denoiseResolutionFor({
            shadedGridWidth: gridWidth,
            shadedGridHeight: gridHeight,
            requestedUpsampleFactor,
            maxDenoisePixels,
          });
    const denoiseUpsampleFactor = Math.max(1, Math.floor(Number(denoiseResolution.upsampleFactor) || 1));
    const denoiseWidth = Math.max(1, Math.floor(Number(denoiseResolution.width) || gridWidth));
    const denoiseHeight = Math.max(1, Math.floor(Number(denoiseResolution.height) || gridHeight));

    const fullWidth = Math.max(1, Math.floor(Number(shadingFrame.fullWidth) || 1));
    const fullHeight = Math.max(1, Math.floor(Number(shadingFrame.fullHeight) || 1));
    const frameIndex = Math.floor(Number(context.frameIndex)) || 0;

    const previousFiltered =
      state.previousFrameContext && state.previousFrameContext.temporalFilteredShading
        ? state.previousFrameContext.temporalFilteredShading
        : null;
    state.previousFrameContext = context;

    function clampedTapX(tapX) {
      const value = Math.floor(Number(tapX));
      if (!(value >= 0)) return 0;
      return value >= gridWidth ? gridWidth - 1 : value;
    }

    function clampedTapY(tapY) {
      const value = Math.floor(Number(tapY));
      if (!(value >= 0)) return 0;
      return value >= gridHeight ? gridHeight - 1 : value;
    }


    function fullPixelOfDenoisePixel(pixelX, pixelY) {
      return {
        x: fullPixelColumnOfDenoiseColumn(pixelX, denoiseWidth, fullWidth),
        y: fullPixelRowOfDenoiseRow(pixelY, denoiseHeight, fullHeight),
      };
    }

    function readCenterGeometry(pixelX, pixelY) {
      const fullPixel = fullPixelOfDenoisePixel(pixelX, pixelY);
      return copyGeometryFromSurface(shadingFrame.readSurfaceAtFullPixel(fullPixel.x, fullPixel.y), centerGeometry);
    }

    function readTapGeometry(tapX, tapY) {
      const fullPixel = shadingFrame.fullPixelOfGridPixel(clampedTapX(tapX), clampedTapY(tapY));
      if (!fullPixel) return null;
      return copyGeometryFromSurface(shadingFrame.readSurfaceAtFullPixel(fullPixel.x, fullPixel.y), tapGeometry);
    }


    function readTapRadiance(tapX, tapY) {
      const shadedSignals = context.shadedSignals;
      if (!shadedSignals || typeof shadedSignals.readTapRadiance !== "function") return null;
      return shadedSignals.readTapRadiance(clampedTapX(tapX), clampedTapY(tapY));
    }

    function readHistory(pixelX, pixelY) {
      if (!previousFiltered || typeof previousFiltered.readFilteredTexel !== "function") return null;
      const historyWidth = Math.floor(Number(previousFiltered.width) || 0);
      const historyHeight = Math.floor(Number(previousFiltered.height) || 0);
      if (!(historyWidth >= 1) || !(historyHeight >= 1)) return null;
      const historyX = Math.min(historyWidth - 1, Math.floor((pixelX * historyWidth) / denoiseWidth));
      const historyY = Math.min(historyHeight - 1, Math.floor((pixelY * historyHeight) / denoiseHeight));
      const texel = previousFiltered.readFilteredTexel(historyX, historyY);
      if (!texel) return null;
      const diffuse = texel.diffuse || { r: 0, g: 0, b: 0 };
      const specular = texel.specular || { r: 0, g: 0, b: 0 };
      historyPixel.accumulatedFrameCount = Number(texel.accumulatedFrameCount) || 0;
      historyPixel.radiance.r = (Number(diffuse.r) || 0) + (Number(specular.r) || 0);
      historyPixel.radiance.g = (Number(diffuse.g) || 0) + (Number(specular.g) || 0);
      historyPixel.radiance.b = (Number(diffuse.b) || 0) + (Number(specular.b) || 0);
      return historyPixel;
    }

    context.upsampleInputs = {
      assembledBy: DENOISE_INPUTS_OWNER + ":inputsBridge",
      fullWidth: denoiseWidth,
      fullHeight: denoiseHeight,
      downsampleFactor: denoiseUpsampleFactor,
      readCenterGeometry,
      readTapGeometry,
      readTapRadiance,
      readHistory,
      randomValueAt: (pixelX, pixelY) => hashedUnitValue(pixelX, pixelY, frameIndex),


      collectRadiance: true,
    };

    function readCurrentPixel(pixelX, pixelY) {
      const shadedSignals = context.shadedSignals;
      const tapX = clampedTapX(Math.floor(pixelX / denoiseUpsampleFactor));
      const tapY = clampedTapY(Math.floor(pixelY / denoiseUpsampleFactor));
      const texel =
        shadedSignals && typeof shadedSignals.readShadedTexel === "function"
          ? shadedSignals.readShadedTexel(tapX, tapY)
          : null;
      const diffuse = texel && texel.diffuse ? texel.diffuse : { r: 0, g: 0, b: 0 };
      const specular = texel && texel.specular ? texel.specular : { r: 0, g: 0, b: 0 };
      currentPixel.diffuse.r = Number(diffuse.r) || 0;
      currentPixel.diffuse.g = Number(diffuse.g) || 0;
      currentPixel.diffuse.b = Number(diffuse.b) || 0;
      currentPixel.specular.r = Number(specular.r) || 0;
      currentPixel.specular.g = Number(specular.g) || 0;
      currentPixel.specular.b = Number(specular.b) || 0;

      const fullPixel = fullPixelOfDenoisePixel(pixelX, pixelY);
      const surface = shadingFrame.readSurfaceAtFullPixel(fullPixel.x, fullPixel.y);
      currentPixel.depth = surface ? Number(surface.linearViewDepth) || 0 : 0;
      const normal = surface && surface.normal ? surface.normal : null;
      currentPixel.normal.x = normal ? normal.x : 0;
      currentPixel.normal.y = normal ? normal.y : 0;
      currentPixel.normal.z = normal ? normal.z : 1;

      const velocity = shadingFrame.readVelocityAtFullPixel(fullPixel.x, fullPixel.y);
      currentPixel.encodedVelocity[0] = velocity ? velocity.encodedVelocity[0] : 0.5;
      currentPixel.encodedVelocity[1] = velocity ? velocity.encodedVelocity[1] : 0.5;
      currentPixel.velocityIsValid = !!(velocity && velocity.velocityIsValid);
      return currentPixel;
    }

    context.temporalFilterInputs = {
      assembledBy: DENOISE_INPUTS_OWNER + ":inputsBridge",
      width: denoiseWidth,
      height: denoiseHeight,
      readCurrentPixel,
      frameIndex,
      collectPixels: false,
    };

    const frame = {
      denoiseWidth,
      denoiseHeight,
      denoiseUpsampleFactor,
      requestedUpsampleFactor,
      budgetLimitedTheResolution: !!denoiseResolution.budgetLimitedTheResolution,
      resolutionDeclaredByShadedBridge: denoiseResolution === declaredResolution,
      maxDenoisePixels,
      shadedGridWidth: gridWidth,
      shadedGridHeight: gridHeight,
      historyAvailable: !!previousFiltered,
      frameIndex,
    };
    state.refusal = DENOISE_INPUTS_REFUSAL.none;
    state.lastFrame = frame;
    publishWhenChanged();
    return { ready: true, refusal: DENOISE_INPUTS_REFUSAL.none, frame };
  }

  return {
    execute,
    inspect() {
      return {
        owner: DENOISE_INPUTS_OWNER + ":inputsBridge",
        assembles: ["frameContext.upsampleInputs", "frameContext.temporalFilterInputs"],
        refusal: state.refusal,
        refusals: DENOISE_INPUTS_REFUSAL,
        maxDenoisePixels,
        requestedUpsampleFactor,
        residuals: DENOISE_INPUTS_RESIDUALS,
        frame: state.lastFrame,
      };
    },
    lastFrame: () => state.lastFrame,
  };
}
