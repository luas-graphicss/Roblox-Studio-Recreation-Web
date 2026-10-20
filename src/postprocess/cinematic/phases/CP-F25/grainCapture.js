const fields = new Set(["frameId", "viewId", "generation", "outputFrameId", "stage", "fullSize", "tileOrigin", "sampleIndex", "sampleCount"]);

export function resolveGrainCapture(value, frame, source) {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new TypeError("CP-F25 capture must be an explicitly stamped object");
  for (const key of Object.keys(value)) if (!fields.has(key)) throw new TypeError(`Unknown CP-F25 capture field: ${key}`);
  if (value.frameId !== frame.frameId || value.viewId !== frame.viewId || value.generation !== frame.generation) throw new Error("CP-F25 stale or cross-view capture control");
  if (!Number.isSafeInteger(value.outputFrameId) || value.outputFrameId < 0 || value.outputFrameId > 0xffffffff) throw new TypeError("CP-F25 outputFrameId must be an unsigned 32-bit integer");
  if (!["subframe", "resolve"].includes(value.stage)) throw new TypeError("CP-F25 capture stage must be subframe or resolve");
  const fullSize = value.fullSize ?? frame.outputSize;
  if (!Number.isInteger(fullSize.width) || !Number.isInteger(fullSize.height) || fullSize.width < 1 || fullSize.height < 1 || fullSize.width > 16777216 || fullSize.height > 16777216) throw new TypeError("CP-F25 capture fullSize must use exact positive pixel dimensions");
  const tileOrigin = value.tileOrigin ?? [0, 0];
  if (!Array.isArray(tileOrigin) || tileOrigin.length !== 2 || tileOrigin.some((coordinate) => !Number.isInteger(coordinate) || coordinate < 0)) throw new TypeError("CP-F25 tileOrigin must contain two nonnegative integer pixel coordinates");
  if (tileOrigin[0] + source.width > fullSize.width || tileOrigin[1] + source.height > fullSize.height) throw new RangeError("CP-F25 tile lies outside the full capture");
  const sampleCount = value.sampleCount ?? 1;
  const sampleIndex = value.sampleIndex ?? 0;
  if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 65536 || !Number.isInteger(sampleIndex) || sampleIndex < 0 || sampleIndex >= sampleCount) throw new RangeError("CP-F25 invalid capture sample count or index");
  return Object.freeze({ ...value, fullSize: Object.freeze({ ...fullSize }), tileOrigin: Object.freeze([...tileOrigin]), sampleCount, sampleIndex });
}
