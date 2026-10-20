export const HALF_FLOAT_MAX = 65504;
export const HALF_FLOAT_MIN_SUBNORMAL = 2 ** -24;

export function resolveHdrFormatPolicy(capabilities, { format = "rgba16f", fallback = "blocked", referenceMode = false } = {}) {
  if (!["blocked", "sdr-diagnostic"].includes(fallback)) throw new TypeError("Unknown HDR fallback policy");
  if (!["rgba16f", "rgba8"].includes(format)) throw new TypeError("This adapter supports only rgba16f or explicit rgba8 diagnostics");
  const supportsFloat = capabilities?.webgl2 === true && capabilities?.floatColorBuffer === true;
  const hdr = format === "rgba16f" && supportsFloat;
  if (!hdr && (fallback !== "sdr-diagnostic" || referenceMode)) throw new Error("HDR transport blocked: renderable rgba16f is required; RGBA8 cannot certify exact HDR");
  if (!capabilities?.webgl2) throw new Error("WebGL2 is required for this transport adapter");
  return Object.freeze({ format: hdr ? "rgba16f" : "rgba8", hdr, exactHdrEligible: hdr, referenceCertified: false, displayHdrCertified: false, fallback: hdr ? null : "sdr-diagnostic", minimum: hdr ? -HALF_FLOAT_MAX : 0, maximum: hdr ? HALF_FLOAT_MAX : 1, bytesPerPixel: hdr ? 8 : 4, precision: hdr ? "binary16, finite signed radiance, representation rounding" : "UNORM8, explicit [0,1] clipping, not HDR", reason: hdr ? "WebGL2 and EXT_color_buffer_float available" : "Explicit lossy SDR diagnostic fallback" });
}

export function halfFloatSpacing(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > HALF_FLOAT_MAX) throw new RangeError("Value is outside finite binary16 storage");
  return Math.max(HALF_FLOAT_MIN_SUBNORMAL, 2 ** (Math.floor(Math.log2(Math.abs(value) || HALF_FLOAT_MIN_SUBNORMAL)) - 10));
}

export function assertFiniteHdrChannels(channels, formatPolicy) {
  for (const value of channels) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError("Non-finite radiance is not transportable");
    if (formatPolicy.hdr && Math.abs(value) > formatPolicy.maximum) throw new RangeError("HDR overflow: adjust pre-exposure before storage, never silently clamp");
  }
  return channels;
}
