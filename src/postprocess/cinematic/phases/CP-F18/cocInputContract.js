import { validateResource } from "../../contracts/frameContract.js";
import { requireChoice, requireNumber } from "./cocValidation.js";
import { resolveCocCoverageChannel } from "./cocCoverageChannel.js";

export function validateCocTexture(resource, frame, label) {
  validateResource(resource, frame, label);
  if (!resource.texture || resource.available === false || resource.disposed === true || resource.texture.disposed === true) throw new Error(`Unavailable CP-F18 ${label}`);
  if (resource.width !== frame.renderSize.width || resource.height !== frame.renderSize.height || resource.origin !== "bottom-left") throw new Error(`CP-F18 ${label} extent or origin mismatch`);
  if ((resource.samples ?? resource.target?.samples ?? 1) > 1) throw new Error(`CP-F18 ${label} requires explicitly resolved samples`);
  if (resource.jitterPixels && (!frame.jitterPixels || resource.jitterPixels.length !== 2 || resource.jitterPixels.some((value, axis) => value !== frame.jitterPixels[axis]))) throw new Error(`CP-F18 ${label} jitter mismatch`);
  return resource;
}

export function validateCocInputs(frame, { camera, depth, coverage, color }, plan) {
  validateResource(camera, frame, "CP-F18 camera");
  for (const [name, resource] of Object.entries({ depth, coverage, color })) validateCocTexture(resource, frame, name);
  requireChoice(depth.encoding, "depth.encoding", ["linear-depth-meters", "hardware-depth-opengl"]);
  if (depth.projection && depth.projection !== "perspective") throw new Error("Physical CoC requires perspective depth");
  if (frame.camera?.projection === "orthographic") throw new Error("Physical CoC does not model orthographic lenses");
  const coverageChannel = resolveCocCoverageChannel(coverage);
  for (const field of ["nearMeters", "farMeters"]) {
    if (depth[field] !== undefined) requireNumber(depth[field], `depth.${field}`, Number.MIN_VALUE);
    if (depth[field] !== undefined && Math.abs(depth[field] - plan.camera[field]) > 1e-8 * Math.max(1, plan.camera[field])) throw new Error(`CP-F18 depth ${field} disagrees with camera meters`);
  }
  if (depth.encoding === "hardware-depth-opengl" && (depth.nearMeters === undefined || depth.farMeters === undefined)) throw new Error("Hardware depth requires explicit nearMeters/farMeters");
  if (!color.encoding?.startsWith("scene-linear-") || color.transfer && color.transfer !== "linear") throw new Error("CP-F18 requires scene-linear color before tone mapping");
  requireChoice(color.format, "color.format", ["rgba16f", "rgba32f"]);
  requireNumber(color.preExposure ?? 1, "source preExposure", Number.MIN_VALUE);
  if (frame.referenceMode === true) throw new Error("CP-F18 BLOCKED_REFERENCE: no verified UE5.9 CoC profile");
  const alphaMode = color.alphaMode ?? plan.settings.alphaMode;
  requireChoice(alphaMode, "source alphaMode", ["straight", "premultiplied", "opaque"]);
  return Object.freeze({ coverageChannel, hardwareDepth: depth.encoding === "hardware-depth-opengl", alphaMode });
}
