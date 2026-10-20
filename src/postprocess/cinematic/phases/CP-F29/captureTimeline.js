function hash(value) {
  value = Math.imul(value ^ value >>> 16, 0x7feb352d);
  value = Math.imul(value ^ value >>> 15, 0x846ca68b);
  return (value ^ value >>> 16) >>> 0;
}

function radicalInverse(index, base) {
  let result = 0;
  let scale = 1;
  while (index > 0) { scale /= base; result += index % base * scale; index = Math.floor(index / base); }
  return result;
}

export function captureShutter(options, outputIndex) {
  const frameTime = options.startTimeSeconds + outputIndex / options.framesPerSecond;
  const duration = options.motionBlurMode === "subframes" ? options.shutterAngleDegrees / 360 / options.framesPerSecond : 0;
  const startFraction = { centered: -0.5, leading: 0, trailing: -1 }[options.shutterTiming];
  return Object.freeze({ frameTime, openTime: frameTime + duration * startFraction, closeTime: frameTime + duration * (startFraction + 1), duration });
}

export function captureSample(options, outputIndex, sampleIndex) {
  const sampleCount = options.spatialSamples * options.temporalSamples;
  if (!Number.isInteger(outputIndex) || outputIndex < 0 || outputIndex >= options.frameCount) throw new RangeError("Invalid output frame index");
  if (!Number.isInteger(sampleIndex) || sampleIndex < 0 || sampleIndex >= sampleCount) throw new RangeError("Invalid capture sample index");
  const temporalIndex = Math.floor(sampleIndex / options.spatialSamples);
  const spatialIndex = sampleIndex % options.spatialSamples;
  const shutter = captureShutter(options, outputIndex);
  const temporalFraction = (temporalIndex + 0.5) / options.temporalSamples;
  const offset = hash(options.seed) % 4096;
  const jitterPixels = options.spatialSamples === 1 ? [0, 0] : [radicalInverse(spatialIndex + offset + 1, 2) - 0.5, radicalInverse(spatialIndex + offset + 1, 3) - 0.5];
  return Object.freeze({
    outputFrameId: options.firstOutputFrameId + outputIndex, sampleIndex, sampleCount,
    temporalIndex, spatialIndex, timeSeconds: shutter.openTime + shutter.duration * temporalFraction,
    seed: options.seed, frameSeed: hash(options.seed ^ (options.firstOutputFrameId + outputIndex)),
    jitterPixels: Object.freeze(jitterPixels), weight: 1 / sampleCount, shutter
  });
}

export function* captureTileTimeline(options, outputIndex) {
  const firstSample = captureSample(options, outputIndex, 0);
  const timestep = 1 / options.framesPerSecond;
  const firstWarmupTime = firstSample.timeSeconds - options.warmupFrames * timestep;
  if (firstWarmupTime < 0) throw new RangeError("Capture warmup/shutter precedes time zero; move startTimeSeconds forward");
  for (let index = 0; index < options.warmupFrames; index += 1) {
    yield Object.freeze({ ...firstSample, kind: "warmup", frameId: index, timeSeconds: firstWarmupTime + index * timestep, deltaSeconds: timestep, cameraCut: index === 0 });
  }
  let previousTime = firstSample.timeSeconds - timestep;
  for (let sampleIndex = 0; sampleIndex < firstSample.sampleCount; sampleIndex += 1) {
    const sample = captureSample(options, outputIndex, sampleIndex);
    yield Object.freeze({ ...sample, kind: "sample", frameId: options.warmupFrames + sampleIndex, deltaSeconds: sample.timeSeconds - previousTime, cameraCut: options.warmupFrames === 0 && sampleIndex === 0 });
    previousTime = sample.timeSeconds;
  }
}
