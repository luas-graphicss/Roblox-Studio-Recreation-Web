import { requireFiniteNumber } from "../../contracts/frameContract.js";
import { validateFilmicSourceColor } from "./filmicColorMetadata.js";

export function resolveFilmicPreExposure(source) {
  const preExposure = source.preExposure === undefined ? 1 : source.preExposure;
  requireFiniteNumber(preExposure, "CP-F11 source.preExposure", 1e-20, 1e20);
  return preExposure;
}

export function validateFilmicInput(source, bypass = false) {
  if (!source?.texture) throw new TypeError("CP-F11 requires a source texture");
  if (source.isAlive !== undefined && (typeof source.isAlive !== "function" || !source.isAlive())) throw new Error("CP-F11 source texture lease has expired");
  if (source.format !== "rgba16f") throw new Error("CP-F11 requires rgba16f source metadata");
  const preExposure = resolveFilmicPreExposure(source);
  if (bypass) return preExposure;
  if (source.encoding !== "scene-linear-rec709") throw new Error("CP-F11 refuses double tonemapping or unsupported input encoding: " + source.encoding);
  validateFilmicSourceColor(source);
  if (source.transfer !== undefined && source.transfer !== "linear") throw new Error("CP-F11 requires linear source transfer");
  if (source.samplerDecoded !== undefined && source.samplerDecoded !== false) throw new Error("CP-F11 requires an already-linear buffer, not a sampler-decoded asset");
  if (["srgb", "display-p3"].includes(source.texture.colorSpace)) throw new Error("CP-F11 refuses an encoded texture sampler");
  if (source.alphaMode !== undefined && !["straight", "opaque"].includes(source.alphaMode)) throw new Error("CP-F11 film and replacement require straight or opaque alpha; unpremultiply explicitly upstream");
  return preExposure;
}

export function preserveFilmicBypassMetadata(source, preExposure) {
  const preserved = { preExposure };
  for (const key of ["colorSpace", "transfer", "samplerDecoded", "formatPolicy", "alphaMode"]) {
    if (source[key] !== undefined) preserved[key] = source[key];
  }
  return preserved;
}
