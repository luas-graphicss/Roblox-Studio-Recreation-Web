import { validateResource } from "../../contracts/frameContract.js";

export function readDirtColorDomain(resource, frame, label, allowUntaggedBase = false) {
  validateResource(resource, frame, label);
  if (!resource.texture || resource.format !== "rgba16f" || resource.encoding !== "scene-linear-rec709") throw new Error(`${label} requires scene-linear-rec709 RGBA16F; no implicit output transform`);
  if (resource.isAlive && !resource.isAlive()) throw new Error(`${label} lease has expired`);
  if (resource.transfer !== undefined && resource.transfer !== "linear") throw new Error(`${label} transfer must be linear`);
  if (resource.samplerDecoded === true || resource.texture.colorSpace === "srgb") throw new Error(`${label} cannot apply implicit sampler gamma decoding`);
  const primaries = typeof resource.colorSpace === "string" ? resource.colorSpace : resource.colorSpace?.name;
  if (primaries !== undefined && primaries !== "rec709") throw new Error(`${label} has incompatible primaries`);
  const preExposure = resource.preExposure === undefined && allowUntaggedBase ? 1 : resource.preExposure;
  if (typeof preExposure !== "number" || !Number.isFinite(preExposure) || preExposure <= 0) throw new Error(`${label} requires finite positive resource preExposure`);
  return preExposure;
}
