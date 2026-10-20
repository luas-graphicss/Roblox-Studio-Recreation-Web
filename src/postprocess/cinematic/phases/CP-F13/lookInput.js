import { LOOK_ENCODINGS } from "./lookAsset.js";
import { validateLookInput } from "./lookBlend.js";
import { validateLookColorMetadata } from "./lookColorMetadata.js";

export function resolveLookInput(plan, input) {
  if (!input?.texture || input.origin !== "bottom-left") throw new TypeError("CP-F13 requires a bottom-left color texture");
  if (input.isAlive !== undefined && (typeof input.isAlive !== "function" || input.isAlive() !== true)) throw new Error("CP-F13 source texture lease is expired or invalid");
  const textureColorSpace = input.texture.colorSpace;
  if (textureColorSpace !== undefined && textureColorSpace !== "" && textureColorSpace !== "srgb-linear") throw new TypeError("CP-F13 refuses implicit encoded texture sampling");
  const preExposure = input.preExposure === undefined ? 1 : input.preExposure;
  validateLookInput(plan, input.encoding, preExposure);
  const sceneInput = LOOK_ENCODINGS[input.encoding] === "scene";
  if (sceneInput && !["rgba16f", "rgba32f"].includes(input.format)) throw new TypeError("A scene-linear HDR LUT cannot silently process an RGBA8 source");
  if (plan.enabled) {
    if (!["rgba8", "rgba16f", "rgba32f"].includes(input.format)) throw new TypeError("CP-F13 requires an RGBA color source");
    validateLookColorMetadata(input);
  }
  const outputEncoding = plan.enabled ? plan.outputEncoding : input.encoding;
  const inputScale = sceneInput ? preExposure : 1;
  const outputScale = sceneInput && LOOK_ENCODINGS[outputEncoding] === "scene" ? preExposure : 1;
  return { preExposure, outputEncoding, inputScale, outputScale };
}
