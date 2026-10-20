import { MGL_GUIDING_TILE_SIZE } from "./mlPipelineContract.js";
import {
  LIGHT_SAMPLE_GENERATION_OWNER,
  LIGHT_SAMPLE_GENERATION_PASS_NAME,
  LIGHT_SAMPLE_GENERATION_REFUSAL_CODES,
  candidateEvaluationCeiling,
  createLightSampleGenerator,
  samplesPerPixelForTier,
} from "./mlLightSampleGenerationCore.js";
import {
  createLightSampleTexels,
  encodeLightSamplesForPixel,
  lightSampleTextureSize,
} from "./mlLightSampleEncodingCore.js";
import { createSurfaceDescription } from "./mlSampleWeightCore.js";
import { createStratifiedRandomSource, describeRandomSource } from "./mlSampleRandomSourceCore.js";
import { LIGHT_SAMPLE_UNIFORM_NAMES } from "./mlLightSampleGlsl.js";
import { downsampleModeForTier, downsampledResolution, fullPixelForBlockOffset } from "./mlDownsampleModeCore.js";
import { unpackLightFromArray } from "./mlLightPackingCore.js";


export const DEFAULT_SAMPLE_PIXEL_BUDGET_PER_FRAME = 4096;

export const FALLBACK_RENDER_WIDTH = 1280;
export const FALLBACK_RENDER_HEIGHT = 720;

export const SURFACE_SOURCE = Object.freeze({
  declaredPlaceholder: "declaredPlaceholder",
  gBufferReadBack: "gBufferReadBack",
});

function millisecondsNow() {
  if (typeof performance !== "undefined" && performance && typeof performance.now === "function") {
    return performance.now();
  }
  return null;
}

function positiveInteger(value, fallbackValue) {
  const rounded = Math.floor(Number(value));
  return Number.isFinite(rounded) && rounded > 0 ? rounded : fallbackValue;
}


export function createLightSampleGenerationPass(dependencies) {
  const settings = dependencies && typeof dependencies === "object" ? dependencies : {};
  const THREE = settings.THREE || null;
  const telemetry = settings.telemetry || null;
  const randomSource = settings.randomSource || createStratifiedRandomSource({ name: "ML-F11 pass source" });
  const samplePixelBudgetPerFrame = positiveInteger(
    settings.samplePixelBudgetPerFrame,
    DEFAULT_SAMPLE_PIXEL_BUDGET_PER_FRAME,
  );


  const injectedLightReader = typeof settings.readLightAt === "function" ? settings.readLightAt : null;

  const placeholderSurface = settings.surface || createSurfaceDescription(null);
  const surfaceSource = settings.surface ? SURFACE_SOURCE.gBufferReadBack : SURFACE_SOURCE.declaredPlaceholder;

  const generator = createLightSampleGenerator({ randomSource });
  const lightDescriptorTarget = {};
  const observationPool = [];
  const observations = [];
  const reportedProblems = [];

  let texels = null;
  let texture = null;
  let textureWidth = 0;
  let textureHeight = 0;
  let sampleColumnCount = 0;
  let sampleRowCount = 0;
  let samplesPerPixel = 0;
  let nextSamplePixelIndex = 0;
  let lastFrameReport = null;

  const handle = {
    owner: LIGHT_SAMPLE_GENERATION_OWNER,
    ready: false,
    texture: null,
    texels: null,
    width: 0,
    height: 0,
    samplesPerPixel: 0,
    sampleColumnCount: 0,
    sampleRowCount: 0,
    downsampleFactor: 1,
    frameIndex: -1,
    surfaceSource,
    uniformValues: {},
    samplesForPixel: null,
  };

  function acquireObservation(index) {
    let observation = observationPool[index];
    if (!observation) {
      observation = { tileX: 0, tileY: 0, lightIndex: -1, energy: 0, needsShadowTrace: false, shapeIndex: 0 };
      observationPool[index] = observation;
    }
    return observation;
  }

  function reportProblem(problem) {
    if (reportedProblems.length >= 8) return;
    if (reportedProblems.indexOf(problem) === -1) reportedProblems.push(problem);
  }

  function ensureBuffer(nextSampleColumnCount, nextSampleRowCount, nextSamplesPerPixel) {
    const geometry = {
      sampleColumnCount: nextSampleColumnCount,
      sampleRowCount: nextSampleRowCount,
      samplesPerPixel: nextSamplesPerPixel,
    };
    const size = lightSampleTextureSize(geometry);
    const alreadySized = texels && size.width === textureWidth && size.height === textureHeight;
    if (alreadySized) return false;

    texels = createLightSampleTexels(geometry);
    textureWidth = size.width;
    textureHeight = size.height;
    sampleColumnCount = nextSampleColumnCount;
    sampleRowCount = nextSampleRowCount;
    samplesPerPixel = nextSamplesPerPixel;
    nextSamplePixelIndex = 0;

    if (texture && typeof texture.dispose === "function") texture.dispose();
    texture = null;

    if (THREE && typeof THREE.DataTexture === "function") {
      texture = new THREE.DataTexture(texels, textureWidth, textureHeight, THREE.RGBAFormat, THREE.FloatType);


      texture.minFilter = THREE.NearestFilter;
      texture.magFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.needsUpdate = true;
    }
    return true;
  }

  function buildLightReader(lightSceneData) {
    if (!lightSceneData || !lightSceneData.floats) return null;
    const floats = lightSceneData.floats;
    const lightIdOfSlot = typeof lightSceneData.lightIdOfSlot === "function" ? lightSceneData.lightIdOfSlot : null;
    return function readLightAt(lightIndex, target) {
      if (lightIdOfSlot && !lightIdOfSlot(lightIndex)) return null;
      return unpackLightFromArray(floats, lightIndex, target || lightDescriptorTarget);
    };
  }






  function renderResolutionOfFrame(context) {
    const frameWidth = positiveInteger(context.resolution?.width, 0);
    const frameHeight = positiveInteger(context.resolution?.height, 0);
    if (frameWidth && frameHeight) {
      return { width: frameWidth, height: frameHeight, measured: true };
    }
    const explicitWidth = positiveInteger(context.width, 0);
    const explicitHeight = positiveInteger(context.height, 0);
    if (explicitWidth && explicitHeight) {
      return { width: explicitWidth, height: explicitHeight, measured: true };
    }
    const drawingBufferSize = context.drawingBufferSize || null;
    const drawingBufferWidth = drawingBufferSize ? positiveInteger(drawingBufferSize.x, 0) : 0;
    const drawingBufferHeight = drawingBufferSize ? positiveInteger(drawingBufferSize.y, 0) : 0;
    if (drawingBufferWidth && drawingBufferHeight) {
      return { width: drawingBufferWidth, height: drawingBufferHeight, measured: true };
    }
    return { width: FALLBACK_RENDER_WIDTH, height: FALLBACK_RENDER_HEIGHT, measured: false };
  }

  function execute(frameContext) {
    const context = frameContext && typeof frameContext === "object" ? frameContext : {};
    const startedAt = millisecondsNow();
    reportedProblems.length = 0;
    observations.length = 0;

    const tierName = context.tier || (context.bench && context.bench.tier) || "forte";
    const requestedSamplesPerPixel = samplesPerPixelForTier(tierName);
    const mode = downsampleModeForTier(tierName) || { name: "full", factor: 1 };
    const renderResolution = renderResolutionOfFrame(context);
    const fullWidth = renderResolution.width;
    const fullHeight = renderResolution.height;
    if (!renderResolution.measured) {
      reportProblem(
        "the frame did not carry a resolution, so the declared fallback of " +
          FALLBACK_RENDER_WIDTH + "x" + FALLBACK_RENDER_HEIGHT + " was used",
      );
    }
    const grid = downsampledResolution(fullWidth, fullHeight, mode.factor);
    ensureBuffer(grid.width, grid.height, requestedSamplesPerPixel);

    const frameIndex = Math.max(0, Math.floor(Number(context.frameIndex) || 0));
    const visibleLightList = context.visibleLightList || null;
    const guidedLightsForPixel =
      visibleLightList && typeof visibleLightList.guidedLightsForPixel === "function"
        ? visibleLightList.guidedLightsForPixel
        : null;
    if (!guidedLightsForPixel) {
      reportProblem(
        "frameContext.visibleLightList has no guidedLightsForPixel(): every sample of this frame is a hidden light draw",
      );
    }

    const lightSceneData = context.lightSceneData || null;
    const readLightAt = injectedLightReader || buildLightReader(lightSceneData);
    const lightCount = lightSceneData ? Math.max(0, Math.floor(Number(lightSceneData.lightCount) || 0)) : 0;
    const drawRange = lightSceneData
      ? Math.max(lightCount, Math.floor(Number(lightSceneData.highestSlot) || 0) + 1)
      : 0;
    if (!readLightAt) {
      reportProblem(
        "frameContext.lightSceneData (ML-F4) is missing, so no light could be weighed and the buffer stayed empty",
      );
    }


    function hiddenLightIndexAt(drawIndex, unitRandom) {
      if (drawRange <= 0) return -1;
      const slot = Math.floor(unitRandom * drawRange);
      return slot >= drawRange ? drawRange - 1 : slot;
    }

    const totalSamplePixels = sampleColumnCount * sampleRowCount;
    const processedPixelCount = Math.min(samplePixelBudgetPerFrame, totalSamplePixels);
    const centreOffset = Math.floor(mode.factor / 2);

    let filledSlotCount = 0;
    let guidedSlotCount = 0;
    let hiddenSlotCount = 0;
    let candidateEvaluationCount = 0;
    let observationCount = 0;
    let refusedSampleCount = 0;

    for (let step = 0; step < processedPixelCount; step += 1) {
      const samplePixelIndex = (nextSamplePixelIndex + step) % Math.max(1, totalSamplePixels);
      const sampleX = samplePixelIndex % Math.max(1, sampleColumnCount);
      const sampleY = Math.floor(samplePixelIndex / Math.max(1, sampleColumnCount));
      const fullPixel = fullPixelForBlockOffset(
        sampleX,
        sampleY,
        centreOffset,
        centreOffset,
        mode.factor,
        fullWidth,
        fullHeight,
      );
      if (!fullPixel) continue;

      const guidedLights = guidedLightsForPixel
        ? guidedLightsForPixel({
            pixelX: fullPixel.x,
            pixelY: fullPixel.y,
            randomValue: randomSource.unitRandom({
              pixelX: fullPixel.x,
              pixelY: fullPixel.y,
              frameIndex,
              slotIndex: 0,
              candidateIndex: 0,
              dimensionIndex: 1,
            }),
          })
        : null;
      const guidedLightCount = guidedLights && guidedLights.length ? guidedLights.length : 0;

      const generated = generator.generateForPixel({
        pixelX: fullPixel.x,
        pixelY: fullPixel.y,
        frameIndex,
        samplesPerPixel: requestedSamplesPerPixel,
        surface: placeholderSurface,
        guidedLights,
        readLightAt,
        hiddenLightCount: readLightAt ? Math.max(0, drawRange - guidedLightCount) : null,
        hiddenLightIndexAt,
        historyReprojectionValid: context.historyReprojectionValid !== false,
      });

      candidateEvaluationCount += generated.candidateEvaluationCount;
      for (let index = 0; index < generated.problems.length; index += 1) reportProblem(generated.problems[index]);

      const encoded = encodeLightSamplesForPixel({
        destination: texels,
        samples: generated.samples,
        sampleX,
        sampleY,
        sampleColumnCount,
        samplesPerPixel,
      });
      filledSlotCount += encoded.writtenSlotCount;
      refusedSampleCount += encoded.refusedSampleCount;

      const tileX = Math.floor(fullPixel.x / MGL_GUIDING_TILE_SIZE);
      const tileY = Math.floor(fullPixel.y / MGL_GUIDING_TILE_SIZE);
      for (let index = 0; index < generated.samples.length; index += 1) {
        const sample = generated.samples[index];
        if (sample.origin === "hidden") hiddenSlotCount += 1;
        else guidedSlotCount += 1;


        const energy = sample.brdfWeightedLuminance * sample.estimatorWeight;
        if (!(energy > 0)) continue;
        const observation = acquireObservation(observationCount);
        observation.tileX = tileX;
        observation.tileY = tileY;
        observation.lightIndex = sample.lightIndex;
        observation.energy = energy;
        observation.needsShadowTrace = sample.needsShadowTrace;
        observation.shapeIndex = sample.lightShapeIndex;
        observations.push(observation);
        observationCount += 1;
      }
    }

    nextSamplePixelIndex = totalSamplePixels > 0
      ? (nextSamplePixelIndex + processedPixelCount) % totalSamplePixels
      : 0;

    if (texture) texture.needsUpdate = true;

    handle.ready = !!texels && filledSlotCount > 0;
    handle.texture = texture;
    handle.texels = texels;
    handle.width = textureWidth;
    handle.height = textureHeight;
    handle.samplesPerPixel = samplesPerPixel;
    handle.sampleColumnCount = sampleColumnCount;
    handle.sampleRowCount = sampleRowCount;
    handle.downsampleFactor = mode.factor;
    handle.frameIndex = frameIndex;
    handle.uniformValues = {
      [LIGHT_SAMPLE_UNIFORM_NAMES.sampleTexture]: texture,
      [LIGHT_SAMPLE_UNIFORM_NAMES.samplesPerPixel]: samplesPerPixel,
    };
    handle.samplesForPixel = function samplesForPixel(sampleX, sampleY) {
      return { sampleX, sampleY, sampleColumnCount, samplesPerPixel, texels };
    };

    context.lightSamples = handle;


    context.lightSampleObservations = observations;

    const finishedAt = millisecondsNow();
    lastFrameReport = {
      frameIndex,
      tierName,
      samplesPerPixel,
      downsampleMode: mode.name,
      downsampleFactor: mode.factor,
      sampleColumnCount,
      sampleRowCount,
      totalSamplePixels,
      processedPixelCount,
      samplePixelBudgetPerFrame,
      coverageRatioThisFrame: totalSamplePixels > 0 ? processedPixelCount / totalSamplePixels : 0,
      framesForFullCoverage:
        processedPixelCount > 0 ? Math.ceil(totalSamplePixels / processedPixelCount) : null,
      filledSlotCount,
      guidedSlotCount,
      hiddenSlotCount,
      hiddenSlotShare: filledSlotCount > 0 ? hiddenSlotCount / filledSlotCount : 0,
      refusedSampleCount,
      observationCount,
      candidateEvaluationCount,
      candidateEvaluationsPerPixel:
        processedPixelCount > 0 ? candidateEvaluationCount / processedPixelCount : 0,
      candidateEvaluationCeiling: candidateEvaluationCeiling(samplesPerPixel),
      lightCount,
      textureWidth,
      textureHeight,
      surfaceSource,
      randomSource: describeRandomSource(randomSource),
      millisecondsMeasured: startedAt !== null && finishedAt !== null,
      milliseconds: startedAt !== null && finishedAt !== null ? finishedAt - startedAt : null,
      problems: reportedProblems.slice(),
    };

    if (telemetry && typeof telemetry.phase === "function") {
      telemetry.phase(LIGHT_SAMPLE_GENERATION_OWNER, lastFrameReport);
    }
    return lastFrameReport;
  }

  return {
    passName: LIGHT_SAMPLE_GENERATION_PASS_NAME,
    owner: LIGHT_SAMPLE_GENERATION_OWNER,
    execute,
    handle,


    inspect() {
      return {
        owner: LIGHT_SAMPLE_GENERATION_OWNER,
        passName: LIGHT_SAMPLE_GENERATION_PASS_NAME,
        refuses: LIGHT_SAMPLE_GENERATION_REFUSAL_CODES,
        lastFrame: lastFrameReport,
        residues: [
          "the sample draw runs on the CPU (WebGL2 has no compute shader), so the per frame work is a declared rotating budget of sample pixels",
          "the surface used for the weight is a declared placeholder: the ML-F3 G-buffer is not read back, so no number here is measured shading geometry",
          "hidden candidates are drawn from the whole light population instead of the froxel cell of the pixel, because the cell needs the view depth of the pixel",
          "the millisecond side of the fixed cost gate is not measured on the GPU: the bench does not boot (TDZ of bench in src/main.js), so the proof is the candidate evaluation count",
        ],
      };
    },

    dispose() {
      if (texture && typeof texture.dispose === "function") texture.dispose();
      texture = null;
      texels = null;
      textureWidth = 0;
      textureHeight = 0;
      handle.ready = false;
      handle.texture = null;
      handle.texels = null;
      generator.reset();
      return true;
    },
  };
}
