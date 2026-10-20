import { validateResource } from "../../contracts/frameContract.js";
import { requireNumber } from "./materialValidation.js";

export function describeMaterialInput(resource, frame, label, expected = {}) {
  validateResource(resource, frame, label);
  if (!resource.texture || resource.available === false || resource.disposed === true) throw new Error(`Unavailable scene texture: ${label}`);
  if (expected.encoding && resource.encoding !== expected.encoding) throw new Error(`Scene texture encoding mismatch: ${label}`);
  if (expected.format && resource.format !== expected.format) throw new Error(`Scene texture format mismatch: ${label}`);
  const viewport = resource.viewRect ?? { x: 0, y: 0, width: resource.width, height: resource.height };
  for (const field of ["x", "y", "width", "height"]) {
    requireNumber(viewport[field], `${label}.viewRect.${field}`, field === "x" || field === "y" ? 0 : 1, 16384);
    if (!Number.isInteger(viewport[field])) throw new TypeError("Texture viewport must use integer physical pixels");
  }
  if (viewport.x + viewport.width > resource.width || viewport.y + viewport.height > resource.height) throw new Error(`Texture viewport exceeds allocation: ${label}`);
  return Object.freeze({
    texture: resource.texture,
    scaleBias: Object.freeze([viewport.width / resource.width, viewport.height / resource.height, viewport.x / resource.width, viewport.y / resource.height]),
    bounds: Object.freeze([(viewport.x + 0.5) / resource.width, (viewport.y + 0.5) / resource.height, (viewport.x + viewport.width - 0.5) / resource.width, (viewport.y + viewport.height - 0.5) / resource.height])
  });
}

export function validateMaterialDomain(material, source) {
  const replacing = material.location === "replacingTonemapper";
  const afterOutput = material.location === "afterTonemapping";
  if (replacing && !source.encoding.startsWith("scene-linear-")) throw new Error("Tonemapper ownership conflict: input has already left the scene-linear domain");
  if (afterOutput && !source.encoding.startsWith("display-")) throw new Error("After Tonemapping requires an explicit display-referred provider");
  if (!afterOutput && !replacing && !["translucencyAfterDof"].includes(material.location) && !source.encoding.startsWith("scene-linear-") && material.output.transformsColor) throw new Error("Scene-linear material received display-referred color");
  const preExposure = source.preExposure === undefined ? 1 : source.preExposure;
  requireNumber(preExposure, "source.preExposure", 1e-20, 1e20);
  return preExposure;
}
