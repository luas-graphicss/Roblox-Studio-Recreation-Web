function validatePixels(pixels, descriptor) {
  const { width, height, channels = 4, domain } = descriptor ?? {};
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    ![1, 2, 4].includes(channels)
  )
    throw new TypeError("Pixel dimensions and channel count must be explicit");
  if (typeof domain !== "string" || !domain)
    throw new TypeError("Pixel color or data domain is required");
  if (
    !ArrayBuffer.isView(pixels) ||
    pixels instanceof DataView ||
    pixels.length !== width * height * channels
  )
    throw new TypeError(
      "Pixel readback is empty or has an incompatible extent",
    );
  for (const value of pixels)
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new RangeError("Pixel readback contains non-finite values");
  return { width, height, channels, domain };
}

export function measurePixelBuffer(pixels, descriptor) {
  const metadata = validatePixels(pixels, descriptor);
  let minimum = Infinity;
  let maximum = -Infinity;
  let scale = 0;
  let normalizedSum = 0;
  let nonzeroSamples = 0;
  let fingerprint = 2166136261;
  const bytes = new Uint8Array(
    pixels.buffer,
    pixels.byteOffset,
    pixels.byteLength,
  );
  for (const byte of bytes)
    fingerprint = Math.imul(fingerprint ^ byte, 16777619) >>> 0;
  for (const value of pixels) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
    scale = Math.max(scale, Math.abs(value));
    if (value !== 0) nonzeroSamples++;
  }
  if (scale > 0) for (const value of pixels) normalizedSum += value / scale;
  const mean = scale * Math.max(-1, Math.min(1, normalizedSum / pixels.length));
  return Object.freeze({
    ...metadata,
    sampleCount: pixels.length,
    pixelCount: metadata.width * metadata.height,
    minimum,
    maximum,
    mean,
    nonzeroSamples,
    fingerprint: fingerprint.toString(16).padStart(8, "0"),
    fingerprintAlgorithm: "fnv1a32-debug-only",
    finite: true,
  });
}

export function comparePixelBuffers(
  actual,
  expected,
  descriptor,
  tolerance = 0,
) {
  const metadata = validatePixels(actual, descriptor);
  validatePixels(expected, descriptor);
  if (
    typeof tolerance !== "number" ||
    !Number.isFinite(tolerance) ||
    tolerance < 0
  )
    throw new TypeError("Pixel tolerance must be finite and nonnegative");
  let maxAbsError = 0;
  let absoluteSum = 0;
  let squaredSum = 0;
  let differentPixels = 0;
  let mismatchedPixels = 0;
  for (let offset = 0; offset < actual.length; offset += metadata.channels) {
    let pixelError = 0;
    for (let channel = 0; channel < metadata.channels; channel++) {
      const error = Math.abs(
        actual[offset + channel] - expected[offset + channel],
      );
      pixelError = Math.max(pixelError, error);
      if (!Number.isFinite(error))
        throw new RangeError(
          "Pixel difference exceeds finite numeric precision",
        );
    }
    maxAbsError = Math.max(maxAbsError, pixelError);
    if (pixelError > 0) differentPixels++;
    if (pixelError > tolerance) mismatchedPixels++;
  }
  const actualBytes = new Uint8Array(
    actual.buffer,
    actual.byteOffset,
    actual.byteLength,
  );
  const expectedBytes = new Uint8Array(
    expected.buffer,
    expected.byteOffset,
    expected.byteLength,
  );
  const bitExact =
    actual.constructor === expected.constructor &&
    actualBytes.length === expectedBytes.length &&
    actualBytes.every((byte, index) => byte === expectedBytes[index]);
  if (maxAbsError > 0)
    for (let index = 0; index < actual.length; index++) {
      const normalizedError =
        Math.abs(actual[index] - expected[index]) / maxAbsError;
      absoluteSum += normalizedError;
      squaredSum += normalizedError * normalizedError;
    }
  return Object.freeze({
    ...metadata,
    sampleCount: actual.length,
    pixelCount: metadata.width * metadata.height,
    maxAbsError,
    meanAbsError: Math.min(1, absoluteSum / actual.length) * maxAbsError,
    rootMeanSquaredError:
      Math.sqrt(Math.min(1, squaredSum / actual.length)) * maxAbsError,
    differentPixels,
    mismatchedPixels,
    tolerance,
    passed: mismatchedPixels === 0,
    numericallyEqual: differentPixels === 0,
    bitExact,
  });
}
