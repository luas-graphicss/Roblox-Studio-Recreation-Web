import { resolveFilmicReplacementMetadata } from "./filmicColorMetadata.js";
import { createFilmicReplacementUniforms } from "./filmicReplacementUniforms.js";

const allowedEncodings = new Set(["display-linear-rec709", "display-linear-rec2020", "display-srgb"]);

export function validateFilmicReplacement(replacement) {
  if (replacement == null) return null;
  if (typeof replacement !== "object" || typeof replacement.id !== "string" || !replacement.id.startsWith("CP-F")) throw new TypeError("Replacement requires a phase-qualified id");
  if (typeof replacement.fragmentShader !== "string" || replacement.fragmentShader.trim().length === 0) throw new TypeError("Replacement requires a fragment shader");
  if (!allowedEncodings.has(replacement.outputEncoding)) throw new TypeError("Replacement requires explicit output encoding");
  if (replacement.createUniforms != null && typeof replacement.createUniforms !== "function") throw new TypeError("Replacement createUniforms must be a function");
  if (replacement.updateUniforms != null && typeof replacement.updateUniforms !== "function") throw new TypeError("Replacement updateUniforms must be a function");
  if (replacement.reads?.length) throw new Error("CP-F11 replacement v1 supports $color only; lateral inputs require a reviewed contract extension");
  return Object.freeze({ ...replacement, outputMetadata: resolveFilmicReplacementMetadata(replacement.outputEncoding, replacement.outputMetadata) });
}

export function createFilmicReplacementMaterial(adapter, replacement) {
  const extraUniforms = replacement.createUniforms?.() ?? {};
  const { uniforms, updateSource } = createFilmicReplacementUniforms(extraUniforms);
  const material = adapter.createMaterial(replacement.fragmentShader, uniforms);
  return Object.freeze({
    material,
    update(source, frame) {
      updateSource(source);
      const result = replacement.updateUniforms?.({ uniforms, frame, source });
      if (result && typeof result.then === "function") throw new Error("Replacement updates must be synchronous");
    }
  });
}
