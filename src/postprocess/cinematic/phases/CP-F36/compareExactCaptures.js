import { CAPTURE_FORMATS } from "../CP-F01/referenceConstants.js";
import { readCaptureSample } from "./captureSample.js";

export function compareExactCaptures(referenceBytes, candidateBytes, descriptor) {
  const format = CAPTURE_FORMATS[descriptor?.format];
  if (!format || !Number.isSafeInteger(descriptor.width) || !Number.isSafeInteger(descriptor.height) || descriptor.width < 1 || descriptor.height < 1) throw new TypeError("An explicit supported representation and positive extents are required");
  const pixelCount = descriptor.width * descriptor.height;
  const expectedBytes = pixelCount * format.bytesPerPixel;
  if (!Number.isSafeInteger(expectedBytes) || !(referenceBytes instanceof Uint8Array) || !(candidateBytes instanceof Uint8Array) || referenceBytes.byteLength !== expectedBytes || candidateBytes.byteLength !== expectedBytes) throw new TypeError("Capture byte lengths must exactly match the frozen representation");
  const referenceView = new DataView(referenceBytes.buffer, referenceBytes.byteOffset, expectedBytes);
  const candidateView = new DataView(candidateBytes.buffer, candidateBytes.byteOffset, expectedBytes);
  let differingBytes = 0;
  let differingChannels = 0;
  let differingPixels = 0;
  let nonFiniteSamples = 0;
  let maxAbsoluteError = 0;
  let firstDifferentPixel = null;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    let pixelDiffers = false;
    for (let channelOffset = 0; channelOffset < format.bytesPerPixel; channelOffset += format.channelBytes) {
      const offset = pixel * format.bytesPerPixel + channelOffset;
      let channelDiffers = false;
      for (let byte = 0; byte < format.channelBytes; byte += 1) {
        if (referenceBytes[offset + byte] !== candidateBytes[offset + byte]) { differingBytes += 1; channelDiffers = true; }
      }
      const referenceValue = readCaptureSample(referenceView, offset, format.channelBytes, format.floating);
      const candidateValue = readCaptureSample(candidateView, offset, format.channelBytes, format.floating);
      if (!Number.isFinite(referenceValue) || !Number.isFinite(candidateValue)) nonFiniteSamples += 1;
      else maxAbsoluteError = Math.max(maxAbsoluteError, Math.abs(referenceValue - candidateValue));
      if (channelDiffers) { differingChannels += 1; pixelDiffers = true; }
    }
    if (pixelDiffers) { differingPixels += 1; firstDifferentPixel ??= pixel; }
  }
  return Object.freeze({ passed: nonFiniteSamples === 0 && differingBytes === 0, exact: nonFiniteSamples === 0 && differingBytes === 0, pixelCount, comparedBytes: expectedBytes, differingBytes, differingChannels, differingPixels, nonFiniteSamples, maxAbsoluteError: nonFiniteSamples ? null : maxAbsoluteError, firstDifferentPixel, format: descriptor.format, comparison: "unaltered-frozen-bytes", perceptualToleranceApplied: false });
}
