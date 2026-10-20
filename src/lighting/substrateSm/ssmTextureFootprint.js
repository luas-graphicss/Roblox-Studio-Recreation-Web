export function requireSubstrateSmByteCount(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} requires nonnegative safe bytes`);
  return value;
}

export function sumSubstrateSmBytes(...values) {
  let total = 0;
  for (const value of values) total = requireSubstrateSmByteCount(total + requireSubstrateSmByteCount(value, 'bytes'), 'totalBytes');
  return total;
}

export function describeSubstrateSmMipChain(width, height, bytesPerPixel = 4, mipmapped = true) {
  for (const [name, value] of Object.entries({ width, height, bytesPerPixel })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} requires a positive safe integer`);
  }
  if (typeof mipmapped !== 'boolean') throw new TypeError('mipmapped must be boolean');
  const levels = [];
  let byteLength = 0;
  do {
    const levelBytes = requireSubstrateSmByteCount(width * height * bytesPerPixel, 'mipBytes');
    levels.push(Object.freeze({ width, height, byteLength: levelBytes, offset: byteLength }));
    byteLength = sumSubstrateSmBytes(byteLength, levelBytes);
    if (!mipmapped || (width === 1 && height === 1)) break;
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
  } while (true);
  return Object.freeze({ levels: Object.freeze(levels), byteLength, baseBytes: levels[0].byteLength });
}

export function describeSubstrateSmBakeMemory(sources, output) {
  const originals = new Map();
  for (const source of sources) {
    const identity = JSON.stringify([source.id, source.revision]);
    if (!originals.has(identity)) originals.set(identity, source);
  }
  let hostOriginalBytes = 0;
  let sourceStagingBytes = 0;
  let retainedOriginalBytes = 0;
  for (const source of originals.values()) {
    hostOriginalBytes = sumSubstrateSmBytes(hostOriginalBytes, source.residentBytes);
    sourceStagingBytes = sumSubstrateSmBytes(sourceStagingBytes, source.baseBytes);
    retainedOriginalBytes = sumSubstrateSmBytes(retainedOriginalBytes, source.retainedBytes);
  }
  const derivedCpuBytes = output.byteLength;
  const derivedGpuBytes = output.byteLength;
  const uploadStagingBytes = output.byteLength;
  const cpuPeakBytes = sumSubstrateSmBytes(sourceStagingBytes, derivedCpuBytes, uploadStagingBytes);
  const incrementalPeakBytes = sumSubstrateSmBytes(cpuPeakBytes, derivedGpuBytes, retainedOriginalBytes);
  return Object.freeze({
    hostOriginalBytes, sourceStagingBytes, retainedOriginalBytes,
    derivedCpuBytes, derivedGpuBytes, uploadStagingBytes, cpuPeakBytes, incrementalPeakBytes,
    totalTexturePeakBytes: sumSubstrateSmBytes(hostOriginalBytes, incrementalPeakBytes),
    accounting: 'logical-uncompressed-bytes-with-full-upload-staging-v1',
  });
}
