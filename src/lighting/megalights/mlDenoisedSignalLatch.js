export const DENOISED_SIGNAL_CONTEXT_KEYS = Object.freeze([
  "disocclusionResolvedShading",
  "spatialFilteredShading",
  "temporalFilteredShading",
]);


export const DENOISED_SIGNAL_CONTEXT_KEY = "temporalFilteredShading";


function isReadableSignal(candidate) {
  return !!(candidate && typeof candidate.readFilteredTexel === "function");
}


function harvestBestSignal(frameContext) {
  if (!frameContext) return { signal: null, contextKey: null };

  for (let index = 0; index !== DENOISED_SIGNAL_CONTEXT_KEYS.length; index += 1) {
    const contextKey = DENOISED_SIGNAL_CONTEXT_KEYS[index];
    const candidate = frameContext[contextKey];
    if (isReadableSignal(candidate)) return { signal: candidate, contextKey };
  }
  return { signal: null, contextKey: null };
}

function finiteFrameIndexOf(frameContext) {
  const frameIndex = Number(frameContext ? frameContext.frameIndex : NaN);
  return Number.isFinite(frameIndex) ? frameIndex : -1;
}

export function createDenoisedSignalLatch() {
  let previousFrameContext = null;
  let latchedSignal = null;
  let latchedContextKey = null;
  let latchedFrameIndex = -1;
  let framesSeen = 0;
  let framesWithoutSignal = 0;
  let distinctSignalsLatched = 0;


  function rememberFrame(frameContext) {
    framesSeen += 1;
    const harvest = harvestBestSignal(previousFrameContext);
    const harvested = harvest.signal;

    if (harvested) {
      if (harvested !== latchedSignal) distinctSignalsLatched += 1;
      latchedSignal = harvested;
      latchedContextKey = harvest.contextKey;
      latchedFrameIndex = finiteFrameIndexOf(previousFrameContext);
      framesWithoutSignal = 0;
    } else {
      framesWithoutSignal += 1;
    }

    previousFrameContext = frameContext || null;
    return latchedSignal;
  }

  return {
    rememberFrame,


    readSignal: () => latchedSignal,


    forget() {
      previousFrameContext = null;
      latchedSignal = null;
      latchedContextKey = null;
      latchedFrameIndex = -1;
      framesWithoutSignal = 0;
    },

    inspect() {
      return {
        contextKey: latchedContextKey || DENOISED_SIGNAL_CONTEXT_KEY,
        contextKeys: DENOISED_SIGNAL_CONTEXT_KEYS,
        latchedFromContextKey: latchedContextKey,
        hasSignal: latchedSignal !== null,
        signalWidth: latchedSignal ? Number(latchedSignal.width) || 0 : 0,
        signalHeight: latchedSignal ? Number(latchedSignal.height) || 0 : 0,
        latchedFromFrameIndex: latchedFrameIndex,
        distinctSignalsLatched,
        framesSeen,
        framesWithoutSignal,
        composesOneFrameLate: true,
        reason:
          "the pass graph gives each frame a fresh context and ML-F20 runs after ML-F18, so the signal is read from the frame before",
      };
    },
  };
}
