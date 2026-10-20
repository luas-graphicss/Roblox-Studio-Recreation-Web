export function resolveMotionDepthCamera(depth, frame) {
  const linear = depth.encoding !== "hardware-depth-opengl";
  const nearMeters = depth.nearMeters ?? frame.camera?.nearMeters ?? 0.1;
  const farMeters = depth.farMeters ?? frame.camera?.farMeters ?? 1000;
  const projection =
    depth.projection ?? frame.camera?.projection ?? "perspective";
  if (!["perspective", "orthographic"].includes(projection))
    throw new TypeError("CP-F22 unsupported depth projection");
  if (
    ![nearMeters, farMeters].every(
      (value) =>
        typeof value === "number" &&
        Number.isFinite(Math.fround(value)) &&
        Math.fround(value) > 0,
    ) ||
    farMeters <= nearMeters ||
    Math.fround(farMeters) <= Math.fround(nearMeters)
  )
    throw new TypeError(
      "CP-F22 camera planes must be representable positive floats with near below far",
    );
  if (!linear) {
    if (!["depth24", "r32f", "rgba16f"].includes(depth.format))
      throw new TypeError("CP-F22 unsupported hardware depth format");
    for (const key of ["nearMeters", "farMeters", "projection"])
      if (
        depth[key] !== undefined &&
        frame.camera?.[key] !== undefined &&
        depth[key] !== frame.camera[key]
      )
        throw new Error(
          "CP-F22 depth planes or projection disagree with the frame",
        );
  } else if (!["r16f", "r32f", "rgba16f"].includes(depth.format))
    throw new TypeError("CP-F22 unsupported linear depth format");
  return Object.freeze({
    nearMeters,
    farMeters,
    linearDepth: Number(linear),
    orthographicDepth: Number(projection === "orthographic"),
  });
}
