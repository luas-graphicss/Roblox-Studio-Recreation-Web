import {
  PHASE_ID,
  SCREEN_TRACE_PASS_NAME,
  SCREEN_TRACE_TEXTURE_UNIT_KEY,
  SCREEN_TRACE_UNIFORM_NAMES,
  screenTraceSettingsForTier,
} from "./mlScreenTraceContract.js";
import { HIERARCHICAL_DEPTH_CHANNELS } from "./mlHzbCore.js";

export const SCREEN_TRACE_PASS_STATUS = Object.freeze({
  traced: "traced",
  waitingForSceneInputs: "waitingForSceneInputs",
  waitingForHierarchicalDepth: "waitingForHierarchicalDepth",
  waitingForLightSamples: "waitingForLightSamples",
  refusedUnmippedPyramid: "refusedUnmippedPyramid",
  disabled: "disabled",
});


export function capturePyramidLevels(pyramidReader) {
  if (!pyramidReader || typeof pyramidReader.readLevel !== "function") return null;

  const levelCount = Number(pyramidReader.levelCount) || 0;
  const levels = [];
  for (let levelIndex = 0; levelIndex !== levelCount; levelIndex++) {
    const size = pyramidReader.levelSize(levelIndex);
    const readback = pyramidReader.readLevel(levelIndex);
    const pixels = readback && readback.pixels ? readback.pixels : readback;
    if (!pixels || !size) return null;

    const texelCount = size.width * size.height;
    const minimum = new Float32Array(texelCount);
    const maximum = new Float32Array(texelCount);
    for (let texelIndex = 0; texelIndex !== texelCount; texelIndex++) {


      minimum[texelIndex] = pixels[texelIndex * 4];
      maximum[texelIndex] = pixels[texelIndex * 4 + 1];
    }
    levels.push({ levelIndex, width: size.width, height: size.height, minimum, maximum });
  }
  return levels.length > 0 ? levels : null;
}





export function isMarchableByTheShader(hierarchicalDepthHandle) {
  if (!hierarchicalDepthHandle) return false;
  const texture = typeof hierarchicalDepthHandle.textureFor === "function"
    ? hierarchicalDepthHandle.textureFor(0)
    : hierarchicalDepthHandle.texture || null;


  if (hierarchicalDepthHandle.mipped === true) return Boolean(texture);


  if (!texture) return false;
  const levelCount = Number(hierarchicalDepthHandle.levelCount) || 1;
  if (levelCount <= 1) return false;
  const secondTexture = hierarchicalDepthHandle.textureFor(1);
  return Boolean(secondTexture) && secondTexture === texture;
}


export function createScreenTracePass(dependencies) {
  const telemetry = (dependencies && dependencies.telemetry) || null;
  let lastStatus = SCREEN_TRACE_PASS_STATUS.waitingForSceneInputs;
  let lastReason = "the pass has not run yet";
  let lastSettings = screenTraceSettingsForTier("medio");
  let refusalAlreadyReported = false;
  let executionCount = 0;

  function report(status, reason) {
    lastStatus = status;
    lastReason = reason;
  }

  function publishHandle(frameContext, extra) {
    frameContext.screenTrace = Object.assign(
      {
        owner: PHASE_ID,
        pass: SCREEN_TRACE_PASS_NAME,
        ready: false,
        status: lastStatus,
        reason: lastReason,
        settings: lastSettings,

        resultChannels: HIERARCHICAL_DEPTH_CHANNELS,
      },
      extra || {},
    );
    return frameContext;
  }

  return {
    owner: PHASE_ID,

    execute(frameContext) {
      executionCount++;
      lastSettings = screenTraceSettingsForTier(frameContext && frameContext.tier);
      if (telemetry) {


        telemetry.uniform(SCREEN_TRACE_UNIFORM_NAMES.stepCount, lastSettings.maximumStepCount);
        telemetry.uniform(SCREEN_TRACE_UNIFORM_NAMES.thickness, lastSettings.thicknessInViewDepth);
      }

      const sceneInputs = frameContext && frameContext.sceneInputs;
      if (!sceneInputs || !sceneInputs.ready) {
        report(SCREEN_TRACE_PASS_STATUS.waitingForSceneInputs, "ML-F3 has not published the scene inputs of this frame");
        return publishHandle(frameContext);
      }

      const hierarchicalDepth = sceneInputs.hierarchicalDepth;
      if (!hierarchicalDepth || !hierarchicalDepth.built) {
        report(SCREEN_TRACE_PASS_STATUS.waitingForHierarchicalDepth, "the depth pyramid of this frame is not built");
        return publishHandle(frameContext);
      }

      if (!isMarchableByTheShader(hierarchicalDepth)) {
        report(
          SCREEN_TRACE_PASS_STATUS.refusedUnmippedPyramid,
          "the pyramid is one render target per level; the march needs one mipped texture (MGL_BUFFERS.hierarchicalDepth says mipped: true)",
        );
        if (telemetry && !refusalAlreadyReported) {
          refusalAlreadyReported = true;
          telemetry.phase(PHASE_ID, { refusedToBind: lastReason });
        }
        return publishHandle(frameContext);
      }


      const lightSamples = frameContext.lightSamples;
      if (!lightSamples || !lightSamples.ready) {
        report(SCREEN_TRACE_PASS_STATUS.waitingForLightSamples, "ML-F11 has not produced light samples, so there is no ray to trace");
        return publishHandle(frameContext);
      }

      report(SCREEN_TRACE_PASS_STATUS.traced, "");
      return publishHandle(frameContext, { ready: true });
    },

    inspect() {
      return {
        owner: PHASE_ID,
        pass: SCREEN_TRACE_PASS_NAME,
        executionCount,
        status: lastStatus,
        reason: lastReason,
        settings: lastSettings,


        textureUnitKey: SCREEN_TRACE_TEXTURE_UNIT_KEY,
        lightingTextureUnits: 0,
      };
    },

    dispose() {
      refusalAlreadyReported = false;
    },
  };
}
