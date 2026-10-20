import { validateSize } from "../../contracts/frameContract.js";

export function resolveHistoryDescriptor(descriptor) {
  validateSize(descriptor, "history");
  const { width, height, format, encoding, exposureMode, filter = "nearest" } = descriptor;
  if (!["rgba16f", "rgba8", "rg16f", "r16f", "r32f"].includes(format)) throw new TypeError("Unsupported history format");
  if (typeof encoding !== "string" || !encoding.trim()) throw new TypeError("History encoding must be explicit");
  if (!["radiance", "invariant"].includes(exposureMode)) throw new TypeError("History exposureMode must be radiance or invariant");
  if (exposureMode === "radiance" && (format !== "rgba16f" || !encoding.startsWith("scene-linear-"))) throw new TypeError("Radiance rescaling requires scene-linear RGBA16F");
  if (!["nearest", "linear"].includes(filter)) throw new TypeError("Unsupported history filter");
  return Object.freeze({ width, height, format, encoding, exposureMode, filter, depth: false });
}

export function historyDescriptorKey(descriptor) {
  return JSON.stringify([descriptor.width, descriptor.height, descriptor.format, descriptor.encoding, descriptor.exposureMode, descriptor.filter]);
}
