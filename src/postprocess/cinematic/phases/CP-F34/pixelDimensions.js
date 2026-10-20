export function resolvePixelDimensions(width, height, pixelRatio = 1, renderScale = 1) {
  for (const [name, value] of Object.entries({ width, height, pixelRatio, renderScale })) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new TypeError(`${name} must be positive and finite`);
  }
  const outputSize = { width: Math.round(width * pixelRatio), height: Math.round(height * pixelRatio) };
  const renderSize = { width: Math.round(outputSize.width * renderScale), height: Math.round(outputSize.height * renderScale) };
  for (const size of [outputSize, renderSize]) {
    if (Object.values(size).some((value) => !Number.isSafeInteger(value) || value < 1 || value > 32768)) {
      throw new RangeError("Physical dimensions must be safe integers in [1, 32768]");
    }
  }
  return Object.freeze({ cssSize: Object.freeze({ width, height }), pixelRatio, renderScale, outputSize: Object.freeze(outputSize), renderSize: Object.freeze(renderSize) });
}
