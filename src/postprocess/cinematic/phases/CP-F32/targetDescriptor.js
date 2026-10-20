import { estimateTargetBytes } from "../../core/resourcePool.js";

const fields = new Set([
  "width",
  "height",
  "format",
  "depth",
  "filter",
  "encoding",
  "exposureMode"
]);
const colorFormats = new Set(["rgba8", "rgba16f", "rg16f", "r16f", "r32f"]);

export function normalizeTargetDescriptor(input, capabilities = {}) {
  if (!input || typeof input !== "object") throw new TypeError("A target descriptor is required");
  for (const name of Object.keys(input))
    if (!fields.has(name)) throw new TypeError(`Unsupported target field: ${name}`);
  const descriptor = {
    width: input.width,
    height: input.height,
    format: input.format,
    depth: input.depth ?? false,
    filter: input.filter ?? "nearest"
  };
  if (!colorFormats.has(descriptor.format)) throw new TypeError("Unsupported color target format");
  if (typeof descriptor.depth !== "boolean" || !["nearest", "linear"].includes(descriptor.filter))
    throw new TypeError("Invalid depth or filtering policy");
  if (
    input.encoding !== undefined &&
    (typeof input.encoding !== "string" || !input.encoding.trim())
  )
    throw new TypeError("Invalid logical texture encoding");
  if (input.exposureMode !== undefined && !["radiance", "invariant"].includes(input.exposureMode))
    throw new TypeError("Invalid logical exposure mode");
  const bytes = estimateTargetBytes(descriptor);
  if (!Number.isSafeInteger(bytes))
    throw new RangeError("Target byte count exceeds safe integer precision");
  const maximum = capabilities.maxTextureSize ?? 16384;
  if (descriptor.width > maximum || descriptor.height > maximum)
    throw new RangeError("Target exceeds device dimensions");
  if (descriptor.format !== "rgba8" && capabilities.floatColorBuffer === false)
    throw new Error("Float targets are unavailable; no implicit byte fallback");
  return Object.freeze(descriptor);
}

export function targetDescriptorKey(descriptor) {
  return JSON.stringify([
    descriptor.width,
    descriptor.height,
    descriptor.format,
    descriptor.depth,
    descriptor.filter
  ]);
}
