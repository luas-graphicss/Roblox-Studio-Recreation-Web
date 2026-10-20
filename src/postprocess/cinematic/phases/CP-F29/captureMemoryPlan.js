export function createCaptureMemoryPlan(options, tiles, hostMemoryBytes, fullFrameResolve = false) {
  if (!Number.isSafeInteger(hostMemoryBytes) || hostMemoryBytes < 0) throw new TypeError("The host must declare its peak GPU/CPU resource bytes");
  const fullPixels = options.width * options.height;
  const tilePixels = Math.max(...tiles.tiles.map((tile) => tile.width * tile.height));
  const frameBytes = fullPixels * 16;
  const entries = Object.freeze({
    hostResources: hostMemoryBytes,
    outputFloatFrame: frameBytes,
    fullFrameResolve: fullFrameResolve ? frameBytes : 0,
    float64TileAccumulator: tilePixels * 32,
    asynchronousReadback: tilePixels * 16 * 2,
    resolvedTile: tilePixels * 16,
    encoderScratchAndOutput: frameBytes * 3 + options.height * 128 + 65536,
    manifestAndSchedule: tiles.tiles.length * 512 + options.frameCount * 512 + 65536
  });
  const estimatedPeakBytes = Object.values(entries).reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes > options.maxMemoryBytes) throw new RangeError(`Capture memory budget exceeded: ${estimatedPeakBytes} > ${options.maxMemoryBytes}`);
  const renderCalls = options.frameCount * tiles.tiles.length * (options.warmupFrames + options.spatialSamples * options.temporalSamples);
  if (renderCalls > options.maxRenderCalls) throw new RangeError(`Capture work budget exceeded: ${renderCalls} > ${options.maxRenderCalls}`);
  return Object.freeze({ entries, estimatedPeakBytes, budgetBytes: options.maxMemoryBytes, renderCalls, concurrentReadbacks: 1, retainedOutputFrames: 1, accounting: "declared-buffer-storage-excludes-browser-driver-overhead" });
}
