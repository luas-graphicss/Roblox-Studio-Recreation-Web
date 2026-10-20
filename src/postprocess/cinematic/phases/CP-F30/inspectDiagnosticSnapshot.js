import { validateFrame } from "../../contracts/frameContract.js";
import { validatePixels } from "./diagnosticValidation.js";

export function inspectDiagnosticSnapshot(snapshot) {
  const { metadata, pixels } = snapshot ?? {};
  if (!metadata || !metadata.state || !metadata.statistics) throw new Error("Capture metadata is incomplete");
  validateFrame(metadata.frame);
  validatePixels(pixels, metadata.width, metadata.height);
  if (!["bottom-left"].includes(metadata.origin)) throw new Error("Capture origin is not supported");
  if (!metadata.domain || !metadata.unit || !Array.isArray(metadata.channels) || !metadata.channels.length || metadata.channels.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 3) || new Set(metadata.channels).size !== metadata.channels.length) throw new Error("Capture metric domain is incomplete");
  if (metadata.state.sceneAvailable !== true) throw new Error("Scene availability is not confirmed by the capture host");
  const seed = metadata.state.seed;
  if (!((typeof seed === "number" && Number.isFinite(seed)) || (typeof seed === "string" && seed.length > 0))) throw new Error("An explicit reproducible capture seed is required");
  if (metadata.state.shaderErrors?.length || metadata.state.pipelineErrors?.length) throw new Error("Capture records renderer or pipeline errors");
  let nonzeroPixels = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (metadata.channels.some((channel) => channel !== 3 && pixels[offset + channel] !== 0)) nonzeroPixels += 1;
  }
  if (!nonzeroPixels) throw new Error("Empty or all-zero signal cannot establish a passing comparison");
  return { pixels: pixels.length / 4, nonzeroPixels };
}
