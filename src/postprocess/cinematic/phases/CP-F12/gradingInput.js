import { requireFinite } from "./gradingSettings.js";

const REC709_CHROMATICITIES = Object.freeze([0.64, 0.33, 0.30, 0.60, 0.15, 0.06, 0.3127, 0.3290]);

export function resolveGradingInput(input) {
  if (input.encoding !== "scene-linear-rec709" || input.format !== "rgba16f" || input.origin !== "bottom-left") throw new Error("CP-F12 requires bottom-left scene-linear-rec709 rgba16f; convert explicitly upstream");
  if (input.transfer !== undefined && input.transfer !== "linear") throw new Error("CP-F12 rejects non-linear transfer metadata");
  if (input.samplerDecoded !== undefined && input.samplerDecoded !== false) throw new Error("CP-F12 expects an already-linear color buffer, not an asset sampler");
  if (input.isAlive !== undefined && (typeof input.isAlive !== "function" || !input.isAlive())) throw new Error("CP-F12 input resource lease has expired");
  const colorSpace = input.colorSpace ?? "rec709";
  if (typeof colorSpace === "string") {
    if (colorSpace !== "rec709") throw new Error("CP-F12 only supports Rec709/D65 primaries");
  } else {
    const actual = [colorSpace?.primaries?.[0]?.[0], colorSpace?.primaries?.[0]?.[1], colorSpace?.primaries?.[1]?.[0], colorSpace?.primaries?.[1]?.[1], colorSpace?.primaries?.[2]?.[0], colorSpace?.primaries?.[2]?.[1], colorSpace?.whitePoint?.[0], colorSpace?.whitePoint?.[1]];
    if (colorSpace?.name !== "rec709" || actual.some((value, index) => typeof value !== "number" || !Number.isFinite(value) || Math.abs(value - REC709_CHROMATICITIES[index]) > 1e-8)) throw new Error("CP-F12 color-space metadata contradicts Rec709/D65 encoding");
  }
  const preExposure = input.preExposure === undefined ? 1 : requireFinite(input.preExposure, "source.preExposure", 2 ** -64, 2 ** 64);
  return { preExposure, colorSpace, transfer: "linear", samplerDecoded: false, ...(input.formatPolicy === undefined ? {} : { formatPolicy: input.formatPolicy }) };
}
