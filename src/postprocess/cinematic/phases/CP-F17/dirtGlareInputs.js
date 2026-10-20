import { validateResource } from "../../contracts/frameContract.js";
import { readDirtColorDomain } from "./dirtColorDomain.js";

function requireDimension(value, label, minimum = 1) {
  if (!Number.isInteger(value) || value < minimum) throw new TypeError(`CP-F17 glare ${label} must be an integer >= ${minimum}`);
  return value;
}

export function resolveDirtGlareInput(binding, resource, metadata, source, frame) {
  const glarePreExposure = readDirtColorDomain(resource, frame, binding.resource);
  const sourcePreExposure = readDirtColorDomain(source, frame, "CP-F17 current color", true);
  validateResource(metadata, frame, binding.metadata);
  const metadataValue = metadata?.value;
  if (!metadataValue || typeof metadataValue !== "object") throw new TypeError(`CP-F17 missing glare metadata: ${binding.metadata}`);
  let active;
  let gain = 1;
  let sourceSize = [resource.width, resource.height];
  let padding = [0, 0];
  if (binding.provider === "standard" || binding.provider === "flare") {
    if (metadataValue.includesSceneColor !== false || metadataValue.intensityApplied !== true) throw new Error("Bloom or flare glare must exclude scene color and already include producer intensity");
    active = metadataValue.plan?.active;
    if (binding.provider === "flare" && active && metadataValue.alreadyComposited !== true) throw new Error("CP-F16 flare must already be composed into current color");
    if (active && (resource.width !== source.width || resource.height !== source.height)) throw new Error("Bloom or flare glare extent disagrees with current color");
  } else if (binding.provider === "convolution") {
    active = metadataValue.active;
    if (active && metadataValue.alreadyComposited !== true) throw new Error("CP-F15 glare must already be composed into current color");
    sourceSize = [requireDimension(metadataValue.sourceWidth, "sourceWidth"), requireDimension(metadataValue.sourceHeight, "sourceHeight")];
    if (metadataValue.paddedWidth !== resource.width || metadataValue.paddedHeight !== resource.height) throw new Error("CP-F15 padded glare extent is inconsistent");
    if (active) {
      const dimensions = metadataValue.padding;
      padding = [requireDimension(dimensions?.left, "left padding", 0), requireDimension(dimensions?.bottom, "bottom padding", 0)];
      const right = requireDimension(dimensions?.right, "right padding", 0);
      const top = requireDimension(dimensions?.top, "top padding", 0);
      if (sourceSize[0] + padding[0] + right !== resource.width || sourceSize[1] + padding[1] + top !== resource.height) throw new Error("CP-F15 convolution padding does not cover its source");
    }
    gain = metadataValue.intensity;
  } else {
    if (metadataValue.contract !== "linear-glare-v1" || metadataValue.includesSceneColor !== false || metadataValue.intensityApplied !== true || metadataValue.alreadyComposited !== true) throw new Error("Custom dirt glare requires the explicit linear-glare-v1 contract");
    active = metadataValue.active;
    if (active && (resource.width !== source.width || resource.height !== source.height)) throw new Error("Custom glare requires current-color extents");
  }
  if (typeof active !== "boolean") throw new TypeError("CP-F17 glare metadata must declare active as a boolean");
  if (typeof gain !== "number" || !Number.isFinite(gain) || gain < 0) throw new RangeError("CP-F17 glare intensity must be finite and nonnegative");
  const exposureScale = sourcePreExposure / glarePreExposure;
  const combinedGain = active ? gain * exposureScale : 0;
  if (!Number.isFinite(exposureScale) || !Number.isFinite(combinedGain) || combinedGain > 3.402823466e38) throw new RangeError("CP-F17 glare gain exceeds the shader float domain");
  if (resource.texture === source.texture) throw new Error("CP-F17 refuses scene color as a glare provider");
  return Object.freeze({ texture: resource.texture, textureSize: [resource.width, resource.height], sourceSize, padding, gain: combinedGain, active, provider: binding.provider, exposureScale });
}
