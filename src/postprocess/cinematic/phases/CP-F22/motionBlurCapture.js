export function resolveMotionBlurCapture(value = null) {
  if (value === null || value === undefined)
    return Object.freeze({
      motionBlurOwner: "postprocess",
      temporalSamples: 1,
      tiled: false,
    });
  if (typeof value !== "object" || Array.isArray(value))
    throw new TypeError("CP-F22 capture ownership requires a record");
  for (const key of Object.keys(value))
    if (!["motionBlurOwner", "temporalSamples", "tiled"].includes(key))
      throw new TypeError(`CP-F22 unknown capture field: ${key}`);
  if (!["capture", "postprocess"].includes(value.motionBlurOwner))
    throw new TypeError("CP-F22 capture must declare one shutter owner");
  if (!Number.isSafeInteger(value.temporalSamples) || value.temporalSamples < 1)
    throw new TypeError(
      "CP-F22 capture temporalSamples must be a positive integer",
    );
  if (typeof value.tiled !== "boolean")
    throw new TypeError("CP-F22 capture must declare tiled explicitly");
  if (
    value.motionBlurOwner === "postprocess" &&
    (value.temporalSamples > 1 || value.tiled)
  )
    throw new Error(
      "CP-F22 BLOCKED_CAPTURE_INTEGRATION: multisample or tiled capture must own shutter accumulation",
    );
  return Object.freeze({ ...value });
}
