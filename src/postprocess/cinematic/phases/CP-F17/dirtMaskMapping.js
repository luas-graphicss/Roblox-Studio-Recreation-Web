export function resolveDirtMaskMapping(mask, outputSize, fit, outputRect) {
  for (const size of [mask, outputSize]) {
    if (!size || !Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width < 1 || size.height < 1) throw new RangeError("Dirt mask mapping requires positive integer image extents");
  }
  const outputAspect = outputSize.width / outputSize.height;
  const maskAspect = mask.width / mask.height;
  if (!Number.isFinite(outputAspect) || outputAspect <= 0 || !Number.isFinite(maskAspect) || maskAspect <= 0) throw new RangeError("Dirt mask mapping requires positive image extents");
  if (!["cover", "contain", "stretch"].includes(fit)) throw new TypeError("Unknown dirt mask fit");
  const horizontal = outputAspect / maskAspect;
  const vertical = maskAspect / outputAspect;
  const scale = fit === "cover" ? [Math.min(1, horizontal), Math.min(1, vertical)] : fit === "contain" ? [Math.max(1, horizontal), Math.max(1, vertical)] : [1, 1];
  return Object.freeze({ scale: Object.freeze(scale), outputRect, outsideIsBlack: true, coordinateSpace: "final-output-bottom-left" });
}

export function mapDirtMaskUv(uv, mapping) {
  return [0, 1].map((axis) => ((mapping.outputRect[axis] + uv[axis] * mapping.outputRect[axis + 2]) - 0.5) * mapping.scale[axis] + 0.5);
}
