export function resolveConvolutionColorMetadata(input, frame, enabled) {
  if (input.format !== "rgba16f") throw new Error("CP-F15 requires rgba16f input; no hidden input quantization is permitted");
  if (input.isAlive && !input.isAlive()) throw new Error("CP-F15 rejects released or overwritten color resources");
  if (input.transfer !== undefined && input.transfer !== "linear") throw new Error("CP-F15 requires linear color transfer");
  if (input.samplerDecoded === true || input.texture?.colorSpace === "srgb") throw new Error("CP-F15 refuses an implicit sRGB decode");
  const preExposure = input.preExposure ?? frame.preExposure;
  if (!Number.isFinite(preExposure) || preExposure <= 0) throw new Error("CP-F15 requires a finite positive pre-exposure");
  const colorSpace = input.colorSpace ?? (input.encoding === "scene-linear-rec709" ? "rec709" : undefined);
  const spaceName = typeof colorSpace === "string" ? colorSpace : colorSpace?.name;
  if (enabled && (input.encoding !== "scene-linear-rec709" || spaceName !== "rec709")) throw new Error("CP-F15 active convolution requires scene-linear-rec709 input and primaries");
  if (enabled && preExposure !== frame.preExposure) throw new Error("CP-F15 input pre-exposure disagrees with the frame");
  return Object.freeze({
    ...(colorSpace !== undefined ? { colorSpace } : {}),
    transfer: "linear",
    samplerDecoded: false,
    preExposure,
    sourceProvenance: input.sourceProvenance ?? input.provenance,
    ...(input.formatPolicy ? { formatPolicy: input.formatPolicy } : {})
  });
}
