import { resolveFilmicPreExposure } from "./filmicInput.js";

export function createFilmicReplacementUniforms(extraUniforms) {
  if (extraUniforms && typeof extraUniforms.then === "function") throw new TypeError("Replacement uniforms must be synchronous");
  if (!extraUniforms || typeof extraUniforms !== "object" || Array.isArray(extraUniforms)) throw new TypeError("Replacement uniforms must be an object");
  if (Object.hasOwn(extraUniforms, "cp11InputTexture") || Object.hasOwn(extraUniforms, "cp11InversePreExposure")) throw new Error("Replacement cannot shadow reserved input uniforms");
  let inputTexture = null;
  let inversePreExposure = 1;
  const uniforms = { ...extraUniforms };
  Object.defineProperties(uniforms, {
    cp11InputTexture: { enumerable: true, value: Object.freeze({ get value() { return inputTexture; } }) },
    cp11InversePreExposure: { enumerable: true, value: Object.freeze({ get value() { return inversePreExposure; } }) }
  });
  return Object.freeze({
    uniforms,
    updateSource(source) {
      const nextInversePreExposure = 1 / resolveFilmicPreExposure(source);
      inputTexture = source.texture;
      inversePreExposure = nextInversePreExposure;
    }
  });
}
