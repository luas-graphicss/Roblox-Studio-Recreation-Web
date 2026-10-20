import { CAPTURE_MAXIMUM_BYTES } from "./captureContract.js";
import { integer, finite, choice, object } from "./captureValidation.js";

const defaults = Object.freeze({
  sequenceId: "cinematic-capture", width: 1920, height: 1080, frameCount: 1,
  firstOutputFrameId: 0, startTimeSeconds: 1, framesPerSecond: 24, seed: 0,
  warmupFrames: 8, spatialSamples: 1, temporalSamples: 1,
  shutterAngleDegrees: 180, shutterTiming: "centered", motionBlurMode: "subframes",
  tileWidth: 1024, tileHeight: 1024, overscan: 1,
  format: "exr", alpha: "straight", maxMemoryBytes: 268435456,
  maxRenderCalls: 1000000, maxGpuReadbackMilliseconds: 10000
});

export function resolveCaptureOptions(authored = {}) {
  object(authored, "capture", Object.keys(defaults));
  const options = { ...defaults };
  for (const [key, value] of Object.entries(authored)) if (value != null) options[key] = value;
  if (typeof options.sequenceId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(options.sequenceId)) throw new TypeError("sequenceId requires 1..80 filename-safe characters");
  for (const key of ["width", "height", "tileWidth", "tileHeight"]) integer(options[key], key, 1, 32768);
  integer(options.frameCount, "frameCount", 1, 100000);
  integer(options.firstOutputFrameId, "firstOutputFrameId", 0, 0xffffffff - options.frameCount);
  integer(options.seed, "seed", 0, 0xffffffff);
  integer(options.warmupFrames, "warmupFrames", 0, 4096);
  for (const key of ["spatialSamples", "temporalSamples"]) integer(options[key], key, 1, 256);
  if (options.spatialSamples * options.temporalSamples > 4096) throw new RangeError("Capture exceeds 4096 samples per pixel");
  finite(options.startTimeSeconds, "startTimeSeconds", 0, 1000000000);
  finite(options.framesPerSecond, "framesPerSecond", 1, 1000);
  finite(options.shutterAngleDegrees, "shutterAngleDegrees", 0, 360);
  finite(options.overscan, "overscan", 1, 2);
  integer(options.maxMemoryBytes, "maxMemoryBytes", 1, CAPTURE_MAXIMUM_BYTES);
  integer(options.maxRenderCalls, "maxRenderCalls", 1, 10000000);
  integer(options.maxGpuReadbackMilliseconds, "maxGpuReadbackMilliseconds", 1, 60000);
  choice(options.format, "format", ["exr", "float32", "png"]);
  choice(options.alpha, "alpha", ["straight", "premultiplied", "opaque"]);
  choice(options.shutterTiming, "shutterTiming", ["centered", "leading", "trailing"]);
  choice(options.motionBlurMode, "motionBlurMode", ["subframes", "postprocess", "none"]);
  if (options.motionBlurMode !== "subframes" && options.temporalSamples !== 1) throw new Error("Temporal samples would double-apply motion blur; use subframes mode");
  return Object.freeze(options);
}
