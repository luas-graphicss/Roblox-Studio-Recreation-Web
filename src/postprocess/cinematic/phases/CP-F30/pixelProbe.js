import { validatePixels, requireFinite } from "./diagnosticValidation.js";

export function probePixel(snapshot, x, y, origin = "top-left") {
  if (!snapshot) throw new Error("Capture a buffer before probing pixels");
  const { metadata, pixels } = snapshot;
  validatePixels(pixels, metadata.width, metadata.height);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= metadata.width || y >= metadata.height) throw new RangeError("Pixel coordinate is outside the capture");
  if (!["top-left", "bottom-left"].includes(origin)) throw new TypeError("Unknown probe origin");
  const sourceY = origin === "top-left" ? metadata.height - 1 - y : y;
  const offset = (sourceY * metadata.width + x) * 4;
  const values = metadata.channels.map((channel) => pixels[offset + channel]);
  const result = { x, y, origin, sourceY, values, channels: metadata.channels, unit: metadata.unit, domain: metadata.domain, frameId: metadata.frame.frameId, viewId: metadata.frame.viewId };
  if (metadata.kind === "motion") result.outputPixelVelocity = [values[0] * metadata.frame.outputSize.width, values[1] * metadata.frame.outputSize.height];
  return result;
}

export function probeUv(snapshot, u, v) {
  requireFinite(u, "u", 0, 1);
  requireFinite(v, "v", 0, 1);
  return probePixel(snapshot, Math.min(snapshot.metadata.width - 1, Math.floor(u * snapshot.metadata.width)), Math.min(snapshot.metadata.height - 1, Math.floor(v * snapshot.metadata.height)), "bottom-left");
}
