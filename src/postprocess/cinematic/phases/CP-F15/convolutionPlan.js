import { CONVOLUTION_BATCH_SIZE } from "./convolutionSettings.js";
import { normalizeHdrKernel } from "./kernelNormalization.js";
import { buildKernelFootprint } from "./kernelFootprint.js";
import { createOriginalAnamorphicKernel } from "./originalKernel.js";

export function createConvolutionPlan(width, height, settings, maxTextureSize = 4096) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new TypeError("Convolution requires positive integer dimensions");
  const active = settings.enabled && settings.intensity > 0;
  const sourceWidth = Math.ceil(width * settings.resolutionScale);
  const sourceHeight = Math.ceil(height * settings.resolutionScale);
  const normalizedKernel = active ? normalizeHdrKernel(settings.kernel ?? createOriginalAnamorphicKernel(), settings.normalization) : null;
  const footprint = active ? buildKernelFootprint(normalizedKernel, settings, [sourceWidth / width, sourceHeight / height]) : { taps: [], minimumX: 0, minimumY: 0, maximumX: 0, maximumY: 0 };
  const reserveX = active ? Math.ceil(sourceWidth * settings.bufferScale * 0.5) : 0;
  const reserveY = active ? Math.ceil(sourceHeight * settings.bufferScale * 0.5) : 0;
  const padding = Object.freeze({ left: -footprint.minimumX + reserveX, bottom: -footprint.minimumY + reserveY, right: footprint.maximumX + reserveX, top: footprint.maximumY + reserveY });
  const paddedWidth = active ? sourceWidth + padding.left + padding.right : 1;
  const paddedHeight = active ? sourceHeight + padding.bottom + padding.top : 1;
  const batches = active ? Math.ceil(footprint.taps.length / CONVOLUTION_BATCH_SIZE) : 0;
  const prefilterPixels = active ? sourceWidth * sourceHeight : 0;
  const accumulationPixels = paddedWidth * paddedHeight;
  const memory = Object.freeze({ prefilterBytes: prefilterPixels * 8, accumulationBytes: accumulationPixels * 8 * (active ? 2 : 1), outputBytes: width * height * 8, cpuTapBytes: footprint.taps.length * 5 * 8, accounting: "declared-storage-bytes-excludes-driver-overhead" });
  const targetBytes = memory.prefilterBytes + memory.accumulationBytes + memory.outputBytes;
  const sampleOperations = active ? accumulationPixels * (footprint.taps.length + batches - 1) + prefilterPixels * 25 + width * height * 5 : width * height;
  if (Math.max(width, height, paddedWidth, paddedHeight) > maxTextureSize) throw new RangeError("Convolution padding exceeds maxTextureSize; no cropping or standard-bloom substitution was performed");
  if (targetBytes > settings.maxTargetBytes) throw new RangeError(`Convolution memory budget exceeded: ${targetBytes} > ${settings.maxTargetBytes}`);
  if (sampleOperations > settings.maxSampleOperations) throw new RangeError(`Convolution work budget exceeded: ${sampleOperations} > ${settings.maxSampleOperations}`);
  return Object.freeze({ active, width, height, sourceWidth, sourceHeight, paddedWidth, paddedHeight, padding, footprint, batches, targetBytes, sampleOperations, memory, drawCalls: active ? batches + 2 : 2, algorithm: "full-linear-direct-convolution-batched-ping-pong", precision: "rgba16f-between-batches", quality: settings.resolutionScale === 1 ? "full-resolution-engineering" : "reduced-resolution-non-exact", certifiedReference: false, kernelProvenance: normalizedKernel?.provenance ?? null });
}
