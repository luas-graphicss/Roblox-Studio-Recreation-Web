function requireJitter(value, label) {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    value.some(
      (component) => !Number.isFinite(component) || Math.abs(component) > 1,
    )
  )
    throw new TypeError(
      `CP-F22 ${label} requires two finite jitter components within one pixel`,
    );
  return value;
}

export function resolveMotionGeometrySampling(resource, frame, settings) {
  const outputAligned = settings.geometrySampling === "output-aligned";
  const extent = outputAligned ? frame.outputSize : frame.renderSize;
  if (resource.width !== extent.width || resource.height !== extent.height)
    throw new Error(
      `CP-F22 ${settings.geometrySampling} geometry extent is incompatible`,
    );
  const expected = outputAligned
    ? [0, 0]
    : requireJitter(frame.jitterPixels ?? [0, 0], "frame jitter");
  if (resource.jitterPixels) {
    const actual = requireJitter(resource.jitterPixels, "geometry jitter");
    if (
      actual.some(
        (component, axis) => Math.abs(component - expected[axis]) > 1e-7,
      )
    )
      throw new Error("CP-F22 mismatched geometry jitter");
  }
  return Object.freeze([...expected]);
}
