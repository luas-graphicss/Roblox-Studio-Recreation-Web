import { grainSequenceSeed } from "./grainHash.js";

export function resolveGrainSequence(frame, settings, capture = null) {
  if (!Number.isSafeInteger(frame.frameId) || frame.frameId < 0 || !Number.isFinite(frame.timeSeconds) || frame.timeSeconds < 0 || typeof frame.viewId !== "string") throw new TypeError("CP-F25 requires a valid deterministic frame clock");
  let index;
  let clock;
  if (capture) { index = capture.outputFrameId; clock = "capture-output-frame"; }
  else if (settings.temporalMode === "fixed") { index = settings.fixedFrame; clock = "fixed"; }
  else if (settings.temporalMode === "frame") { index = frame.frameId; clock = "frame"; }
  else { index = Math.floor(frame.timeSeconds * settings.framesPerSecond + 1e-7); clock = "time"; }
  if (!Number.isSafeInteger(index) || index < 0) throw new RangeError("CP-F25 sequence index is outside the exact integer clock range");
  return Object.freeze({ index, clock, seed: grainSequenceSeed(settings.seed, frame.viewId, index), period: 4294967296 });
}
