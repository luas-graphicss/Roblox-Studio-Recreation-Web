import { createEncodedSampleSlotGridPool } from "./mlEncodedSampleSlotGridPool.js";
import { createVisibilitySampleRecordPool } from "./mlVisibilitySampleRecordPool.js";
import {
  downsampleModeForTier,
  downsampledResolution,
  fullPixelForBlockOffset,
} from "./mlDownsampleModeCore.js";
import { createGBufferSurfaceReader } from "./mlGBufferSurfaceReader.js";
import { createSurfaceReadbackLattice } from "./mlSurfaceReadbackLatticeCore.js";
import {
  denoiseResolutionFor,
  fullPixelColumnOfDenoiseColumn,
  fullPixelRowOfDenoiseRow,
} from "./mlDenoiseResolutionCore.js";
import { MGL_TRACE_RESULT } from "./mlPipelineContract.js";
import {
  createPackedLightReader,
  decodeLightSample,
  isContractTraceResult,
} from "./mlSampleDecoder.js";
import { TRACE_FALLBACK_RESULT } from "./mlTracePolicyCore.js";

export const SAMPLE_SHADING_INPUTS_OWNER = "ML-F18";
export const DEFAULT_MAX_SHADED_SAMPLE_PIXELS = 16384;
export const DEFAULT_TIER_NAME = "medio";

export const SAMPLE_SHADING_INPUTS_REFUSAL = Object.freeze({
  none: "none",
  sceneInputsMissing: "ML-F3 published no sceneInputs handle: there is no G-buffer to shade against",
  gBufferReadbackMissing:
    "the ML-F3 pass is not reachable, so its readAttachmentPixels door is closed: no surface can be read",
  gBufferNotReadable:
    "the readback returned no pixels, or the camera rotation was not available: refusing to shade a guessed surface",
  lightSceneDataMissing: "ML-F4 published no packed light buffer: a sample index resolves to nothing",
  lightSamplesMissing: "ML-F11 published no drawn samples: there is nothing to shade",
  emptyGrid: "the shaded grid has no pixels",
});


export const DEFINED_VISIBILITY_FALLBACK = isContractTraceResult(TRACE_FALLBACK_RESULT)
  ? TRACE_FALLBACK_RESULT
  : MGL_TRACE_RESULT.visible;

function rowMajorRotationOfCamera(camera) {
  const matrix = camera && camera.matrixWorldInverse ? camera.matrixWorldInverse : null;
  const elements = matrix && matrix.elements ? matrix.elements : null;
  if (!elements || elements.length !== 16) return null;

  return [
    elements[0], elements[4], elements[8],
    elements[1], elements[5], elements[9],
    elements[2], elements[6], elements[10],
  ];
}

function tangentOfHalfVerticalFieldOfView(camera) {
  const verticalFieldOfViewInDegrees = Number(camera && camera.fov);
  if (!Number.isFinite(verticalFieldOfViewInDegrees) || !(verticalFieldOfViewInDegrees > 0)) return 1;
  return Math.tan((verticalFieldOfViewInDegrees * Math.PI) / 360);
}


export function createSampleShadingInputsBridge(dependencies) {
  const settings = dependencies || {};
  const telemetry = settings.telemetry || null;
  const resolveAttachmentReader =
    typeof settings.resolveAttachmentReader === "function" ? settings.resolveAttachmentReader : () => null;
  const resolveSampleVisibility =
    typeof settings.resolveSampleVisibility === "function" ? settings.resolveSampleVisibility : null;
  const maxShadedSamplePixels =
    Math.floor(Number(settings.maxShadedSamplePixels)) > 0
      ? Math.floor(Number(settings.maxShadedSamplePixels))
      : DEFAULT_MAX_SHADED_SAMPLE_PIXELS;

  const state = {
    refusal: SAMPLE_SHADING_INPUTS_REFUSAL.lightSamplesMissing,
    surfaceReader: null,
    attachmentReader: null,
    lastFrame: null,
  };


  const surfaceReadbackLattice = createSurfaceReadbackLattice();


  const grid = {
    width: 0,
    height: 0,
    effectiveFactor: 1,
    fullPixelX: new Int32Array(0),
    fullPixelY: new Int32Array(0),
    encodedSlotsByGridPixel: [],
    visibilityBaseIndex: new Int32Array(0),
  };

  let lastPublishedSignature = "";


  const encodedSlotGridPool = createEncodedSampleSlotGridPool();
  const visibilitySampleRecords = createVisibilitySampleRecordPool();

  function ensureGridCapacity(pixelCount) {
    if (grid.fullPixelX.length >= pixelCount) return;
    grid.fullPixelX = new Int32Array(pixelCount);
    grid.fullPixelY = new Int32Array(pixelCount);
    grid.visibilityBaseIndex = new Int32Array(pixelCount);
  }








  function declareReadbackLattice(request) {
    const fullWidth = request.fullWidth;
    const fullHeight = request.fullHeight;
    const effectiveFactor = request.effectiveFactor;
    const blockCentreOffset = request.blockCentreOffset;
    const shadedGrid = request.shadedGrid;
    const denoiseResolution = request.denoiseResolution;
    const latticeKey = [
      effectiveFactor,
      blockCentreOffset,
      shadedGrid.width,
      shadedGrid.height,
      denoiseResolution.width,
      denoiseResolution.height,
    ].join("|");

    const opening = surfaceReadbackLattice.beginFrame({ fullWidth, fullHeight, latticeKey });


    if (!opening.declarationNeeded) return surfaceReadbackLattice;




    for (let gridX = 0; gridX !== shadedGrid.width; gridX += 1) {
      const fullPixel = fullPixelForBlockOffset(
        gridX,
        0,
        blockCentreOffset,
        blockCentreOffset,
        effectiveFactor,
        fullWidth,
        fullHeight,
      );
      if (fullPixel) surfaceReadbackLattice.requestColumn(fullPixel.x);
    }
    for (let gridY = 0; gridY !== shadedGrid.height; gridY += 1) {
      const fullPixel = fullPixelForBlockOffset(
        0,
        gridY,
        blockCentreOffset,
        blockCentreOffset,
        effectiveFactor,
        fullWidth,
        fullHeight,
      );
      if (fullPixel) surfaceReadbackLattice.requestRow(fullPixel.y);
    }


    declareDenoiseGridColumnsAndRows(denoiseResolution.width, denoiseResolution.height, fullWidth, fullHeight);
    declareDenoiseGridColumnsAndRows(shadedGrid.width, shadedGrid.height, fullWidth, fullHeight);

    surfaceReadbackLattice.finishDeclaration();
    return surfaceReadbackLattice;
  }

  function declareDenoiseGridColumnsAndRows(denoiseWidth, denoiseHeight, fullWidth, fullHeight) {
    for (let denoiseX = 0; denoiseX !== denoiseWidth; denoiseX += 1) {
      surfaceReadbackLattice.requestColumn(fullPixelColumnOfDenoiseColumn(denoiseX, denoiseWidth, fullWidth));
    }
    for (let denoiseY = 0; denoiseY !== denoiseHeight; denoiseY += 1) {
      surfaceReadbackLattice.requestRow(fullPixelRowOfDenoiseRow(denoiseY, denoiseHeight, fullHeight));
    }
  }

  function ensureSurfaceReader() {
    const attachmentReader = resolveAttachmentReader();
    if (typeof attachmentReader !== "function") return null;
    if (state.surfaceReader && state.attachmentReader === attachmentReader) return state.surfaceReader;
    state.attachmentReader = attachmentReader;
    state.surfaceReader = createGBufferSurfaceReader({ readAttachmentPixels: attachmentReader });
    return state.surfaceReader;
  }

  function refuse(reason) {
    state.refusal = reason;
    state.lastFrame = null;
    publishWhenChanged();
    return { ready: false, refusal: reason };
  }

  function publishWhenChanged() {
    if (!telemetry || typeof telemetry.phase !== "function") return;
    const frame = state.lastFrame;
    const signature = [
      state.refusal,
      frame ? frame.gridWidth : 0,
      frame ? frame.gridHeight : 0,
      frame ? frame.effectiveDownsampleFactor : 0,
      frame ? frame.encodedSlotCount : 0,
      frame ? frame.samplesLeftUnknownForTheEstimator : -1,
      frame ? frame.coercedUnknownVisibilityCount : -1,
      frame ? frame.visibilityRecordMissingCount : -1,
      surfaceReadbackLattice.offLatticeRequestCount(),
    ].join("|");
    if (signature === lastPublishedSignature) return;
    lastPublishedSignature = signature;
    telemetry.phase("ML-F18:inputsBridge", {
      assembles: "frameContext.sampleShadingInputs",
      refusal: state.refusal,
      frame,
      readsGBufferBackToTheCpu: true,
      definedVisibilityFallback: DEFINED_VISIBILITY_FALLBACK,
      mustStayZero: "samplesLeftUnknownForTheEstimator",


      readbackLattice: surfaceReadbackLattice.describe(),
      readbackMustStayZero: "offLatticeRequestCount",
    });
  }


  function execute(frameContext) {
    const context = frameContext || {};
    const sceneInputs = context.sceneInputs || null;
    const lightSceneData = context.lightSceneData || null;
    const lightSamples = context.lightSamples || null;

    if (!sceneInputs || !sceneInputs.ready) return refuse(SAMPLE_SHADING_INPUTS_REFUSAL.sceneInputsMissing);
    if (!lightSceneData || !lightSceneData.floats) return refuse(SAMPLE_SHADING_INPUTS_REFUSAL.lightSceneDataMissing);
    if (!lightSamples || !lightSamples.ready || !lightSamples.texels) {
      return refuse(SAMPLE_SHADING_INPUTS_REFUSAL.lightSamplesMissing);
    }

    const surfaceReader = ensureSurfaceReader();
    if (!surfaceReader) return refuse(SAMPLE_SHADING_INPUTS_REFUSAL.gBufferReadbackMissing);

    const fullWidth = Math.floor(Number(sceneInputs.width) || 0);
    const fullHeight = Math.floor(Number(sceneInputs.height) || 0);
    const camera = context.camera || null;


    const tierName = context.tier || DEFAULT_TIER_NAME;
    const tierMode = downsampleModeForTier(tierName);
    const tierFactor = Math.max(1, Math.floor(Number(tierMode && tierMode.factor) || 1));
    const budgetFactor = Math.max(
      1,
      Math.ceil(Math.sqrt((fullWidth * fullHeight) / maxShadedSamplePixels)),
    );
    const effectiveFactor = Math.max(tierFactor, budgetFactor);
    const shadedGrid = downsampledResolution(fullWidth, fullHeight, effectiveFactor);
    if (!(shadedGrid.width >= 1) || !(shadedGrid.height >= 1)) {
      return refuse(SAMPLE_SHADING_INPUTS_REFUSAL.emptyGrid);
    }
    const blockCentreOffset = Math.floor(effectiveFactor / 2);
    const denoiseResolution = denoiseResolutionFor({
      shadedGridWidth: shadedGrid.width,
      shadedGridHeight: shadedGrid.height,
      requestedUpsampleFactor: settings.denoiseUpsampleFactor,
      maxDenoisePixels: settings.maxDenoisePixels,
    });
    const readbackLattice = declareReadbackLattice({
      fullWidth,
      fullHeight,
      effectiveFactor,
      blockCentreOffset,
      shadedGrid,
      denoiseResolution,
    });

    const readbackFrame = surfaceReader.beginFrame({
      width: fullWidth,
      height: fullHeight,
      tangentOfHalfVerticalFieldOfView: tangentOfHalfVerticalFieldOfView(camera),
      aspectRatio: Number(camera && camera.aspect) || (fullHeight > 0 ? fullWidth / fullHeight : 1),
      worldToViewRotation: rowMajorRotationOfCamera(camera),


      lattice: readbackLattice,


      readVelocity: true,


      readAlbedo: false,
    });
    if (!readbackFrame.ready) return refuse(SAMPLE_SHADING_INPUTS_REFUSAL.gBufferNotReadable);

    grid.width = shadedGrid.width;
    grid.height = shadedGrid.height;
    grid.effectiveFactor = effectiveFactor;
    const gridPixelCount = grid.width * grid.height;
    ensureGridCapacity(gridPixelCount);
    grid.encodedSlotsByGridPixel.length = gridPixelCount;


    const samplesPerPixel = Math.max(1, Math.floor(Number(lightSamples.samplesPerPixel) || 1));
    const sampleColumnCount = Math.floor(Number(lightSamples.sampleColumnCount) || 0);
    const sampleRowCount = Math.floor(Number(lightSamples.sampleRowCount) || 0);
    const drawnFactor = Math.max(1, Math.floor(Number(lightSamples.downsampleFactor) || tierFactor));


    encodedSlotGridPool.beginFrame({
      texels: lightSamples.texels,
      sampleColumnCount,
      sampleRowCount,
      samplesPerPixel,
    });
    visibilitySampleRecords.beginFrame();
    let encodedSlotCount = 0;

    for (let gridY = 0; gridY !== grid.height; gridY += 1) {
      for (let gridX = 0; gridX !== grid.width; gridX += 1) {
        const gridPixelIndex = gridY * grid.width + gridX;
        const fullPixel = fullPixelForBlockOffset(
          gridX,
          gridY,
          blockCentreOffset,
          blockCentreOffset,
          effectiveFactor,
          fullWidth,
          fullHeight,
        );
        if (!fullPixel) {
          grid.fullPixelX[gridPixelIndex] = -1;
          grid.fullPixelY[gridPixelIndex] = -1;
          grid.encodedSlotsByGridPixel[gridPixelIndex] = null;
          grid.visibilityBaseIndex[gridPixelIndex] = -1;
          continue;
        }
        grid.fullPixelX[gridPixelIndex] = fullPixel.x;
        grid.fullPixelY[gridPixelIndex] = fullPixel.y;

        const encodedSlots = encodedSlotGridPool.decodeGridPixel(
          gridPixelIndex,
          Math.min(sampleColumnCount - 1, Math.floor(fullPixel.x / drawnFactor)),
          Math.min(sampleRowCount - 1, Math.floor(fullPixel.y / drawnFactor)),
        );
        grid.encodedSlotsByGridPixel[gridPixelIndex] = encodedSlots;
        grid.visibilityBaseIndex[gridPixelIndex] = visibilitySampleRecords.count();

        const slotCount = Array.isArray(encodedSlots) ? encodedSlots.length : 0;
        encodedSlotCount += slotCount;
        for (let slot = 0; slot !== slotCount; slot += 1) {
          const encodedSlot = encodedSlots[slot];
          const surface = surfaceReader.readSurfaceAtFullPixel(fullPixel.x, fullPixel.y);


          const visibilitySample = visibilitySampleRecords.nextRecord();
          visibilitySample.gridX = gridX;
          visibilitySample.gridY = gridY;
          visibilitySample.fullX = fullPixel.x;
          visibilitySample.fullY = fullPixel.y;
          visibilitySample.slotIndex = Math.floor(Number(encodedSlot.slotIndex)) || slot;
          visibilitySample.lightIndex = Math.floor(Number(encodedSlot.lightIndex));
          visibilitySample.sourcePointU = Number(encodedSlot.sourcePointU) || 0;
          visibilitySample.sourcePointV = Number(encodedSlot.sourcePointV) || 0;
          visibilitySample.originView.x = surface.positionView.x;
          visibilitySample.originView.y = surface.positionView.y;
          visibilitySample.originView.z = surface.positionView.z;
          visibilitySample.normalView.x = surface.normal.x;
          visibilitySample.normalView.y = surface.normal.y;
          visibilitySample.normalView.z = surface.normal.z;
          visibilitySample.coverage = surface.coverage;
        }
      }
    }



    const existingPolicyInputs = context.tracePolicyInputs || null;
    context.tracePolicyInputs = {
      samples: visibilitySampleRecords.frameRecords(),
      tracers:
        existingPolicyInputs && existingPolicyInputs.tracers && typeof existingPolicyInputs.tracers === "object"
          ? existingPolicyInputs.tracers
          : {},
    };
    let visibilityInstrumentRan = false;
    if (resolveSampleVisibility && visibilitySampleRecords.count() > 0) {
      resolveSampleVisibility(context);
      visibilityInstrumentRan = !!context.sampleVisibility;
    }

    const visibilityRecords =
      context.sampleVisibility && Array.isArray(context.sampleVisibility.records)
        ? context.sampleVisibility.records
        : null;

    const counters = {
      visibilityRecordMissingCount: 0,
      coercedUnknownVisibilityCount: 0,
      samplesLeftUnknownForTheEstimator: 0,
      occludedSampleCount: 0,
      visibleSampleCount: 0,
    };


    function traceResultForSampleIndex(sampleIndex) {
      const record = visibilityRecords ? visibilityRecords[sampleIndex] : null;
      if (!record) {
        counters.visibilityRecordMissingCount += 1;
        counters.visibleSampleCount += 1;
        return DEFINED_VISIBILITY_FALLBACK;
      }
      const traceResult = record.traceResult;
      if (traceResult === MGL_TRACE_RESULT.occluded) {
        counters.occludedSampleCount += 1;
        return traceResult;
      }
      if (traceResult === MGL_TRACE_RESULT.visible) {
        counters.visibleSampleCount += 1;
        return traceResult;
      }

      counters.coercedUnknownVisibilityCount += 1;
      if (!isContractTraceResult(DEFINED_VISIBILITY_FALLBACK)) {
        counters.samplesLeftUnknownForTheEstimator += 1;
        return MGL_TRACE_RESULT.unknown;
      }
      counters.visibleSampleCount += 1;
      return DEFINED_VISIBILITY_FALLBACK;
    }

    const readLightAt = createPackedLightReader(lightSceneData);
    const decodedSamples = [];
    const decodeRefusalCounts = {};

    function readSurface(gridX, gridY) {
      const gridPixelIndex = gridY * grid.width + gridX;
      const fullX = grid.fullPixelX[gridPixelIndex];
      if (fullX === -1) return null;
      return surfaceReader.readSurfaceAtFullPixel(fullX, grid.fullPixelY[gridPixelIndex]);
    }

    function readSamples(gridX, gridY) {
      const gridPixelIndex = gridY * grid.width + gridX;
      const encodedSlots = grid.encodedSlotsByGridPixel[gridPixelIndex];
      decodedSamples.length = 0;
      if (!encodedSlots) return decodedSamples;
      const surface = surfaceReader.readSurfaceAtFullPixel(
        grid.fullPixelX[gridPixelIndex],
        grid.fullPixelY[gridPixelIndex],
      );
      const visibilityBase = grid.visibilityBaseIndex[gridPixelIndex];
      for (let slot = 0; slot !== encodedSlots.length; slot += 1) {
        const decoded = decodeLightSample({
          encodedSlot: encodedSlots[slot],
          readLightAt,
          surface,
          traceResult: traceResultForSampleIndex(visibilityBase + slot),
        });
        if (decoded.sample) {
          decodedSamples.push(decoded.sample);
        } else {
          decodeRefusalCounts[decoded.refusal] = (decodeRefusalCounts[decoded.refusal] || 0) + 1;
        }
      }
      return decodedSamples;
    }

    const frame = {
      gridWidth: grid.width,
      gridHeight: grid.height,
      fullWidth,
      fullHeight,
      tierName,
      tierDownsampleFactor: tierFactor,
      effectiveDownsampleFactor: effectiveFactor,
      budgetLimitedTheGrid: budgetFactor > tierFactor,
      maxShadedSamplePixels,
      samplesPerPixel,
      encodedSlotCount,
      visibilitySampleCount: visibilitySampleRecords.count(),
      visibilityInstrumentRan,
      visibilityRecordsAvailable: !!visibilityRecords,
      definedVisibilityFallback: DEFINED_VISIBILITY_FALLBACK,
      gBufferReadbackCount: readbackFrame.readbackCount,


      gBufferReadback: readbackFrame,
      denoiseResolution,
      counters,
      decodeRefusalCounts,
    };
    state.refusal = SAMPLE_SHADING_INPUTS_REFUSAL.none;
    state.lastFrame = frame;


    context.sampleShadingInputs = {
      assembledBy: SAMPLE_SHADING_INPUTS_OWNER + ":inputsBridge",
      width: grid.width,
      height: grid.height,
      downsampleFactor: effectiveFactor,
      samplesPerPixel,
      readSurface,
      readSamples,
      collectTexels: true,


      visibilityAssembly: frame,
    };

    publishWhenChanged();
    return {
      ready: true,
      refusal: SAMPLE_SHADING_INPUTS_REFUSAL.none,
      fullWidth,
      fullHeight,
      gridWidth: grid.width,
      gridHeight: grid.height,
      downsampleFactor: effectiveFactor,
      samplesPerPixel,


      denoiseResolution,
      frame,
      readSurfaceAtFullPixel: (fullX, fullY) => surfaceReader.readSurfaceAtFullPixel(fullX, fullY),
      readVelocityAtFullPixel: (fullX, fullY) => surfaceReader.readVelocityAtFullPixel(fullX, fullY),
      fullPixelOfGridPixel: (gridX, gridY) => {
        const gridPixelIndex = gridY * grid.width + gridX;
        const fullX = grid.fullPixelX[gridPixelIndex];
        if (fullX === undefined || fullX === -1) return null;
        return { x: fullX, y: grid.fullPixelY[gridPixelIndex] };
      },
    };
  }

  return {
    execute,
    inspect() {
      return {
        owner: SAMPLE_SHADING_INPUTS_OWNER + ":inputsBridge",
        assembles: "frameContext.sampleShadingInputs",
        alsoPublishes: "frameContext.tracePolicyInputs, so the ML-F17 decision actually runs",
        refusal: state.refusal,
        refusals: SAMPLE_SHADING_INPUTS_REFUSAL,
        definedVisibilityFallback: DEFINED_VISIBILITY_FALLBACK,
        maxShadedSamplePixels,
        readsGBufferBackToTheCpu: true,
        frame: state.lastFrame,
      };
    },
    lastFrame: () => state.lastFrame,
  };
}
