import { MATERIAL_FORMAT_BYTES } from "./materialContract.js";
import { requireKeys, requireNumber, requireIdentifier } from "./materialValidation.js";

export function normalizeMaterialOutput(authored, materialId, location) {
  const output = authored === undefined ? {} : requireKeys(authored, ["name", "format", "lifetime", "size", "transformsColor", "encoding"], "output");
  const name = output.name === undefined ? null : requireIdentifier(output.name, "output.name");
  const format = output.format ?? "rgba16f";
  if (!Object.hasOwn(MATERIAL_FORMAT_BYTES, format)) throw new TypeError(`Unsupported output format: ${format}`);
  const lifetime = output.lifetime ?? "frame";
  if (lifetime !== "frame") throw new TypeError("User scene textures have frame content lifetime; history requires a separate history provider");
  const size = output.size === undefined ? {} : requireKeys(output.size, ["basis", "scale", "width", "height"], "output.size");
  const basis = size.basis ?? "input";
  if (!["input", "render", "output", "fixed"].includes(basis)) throw new TypeError("Invalid output size basis");
  if (basis !== "fixed" && (size.width !== undefined || size.height !== undefined)) throw new TypeError("Explicit dimensions require fixed size basis");
  const scale = size.scale ?? 1;
  requireNumber(scale, "output.size.scale", 1 / 16, 4);
  if (basis === "fixed") {
    for (const dimension of ["width", "height"]) {
      requireNumber(size[dimension], `output.size.${dimension}`, 1, 16384);
      if (!Number.isInteger(size[dimension])) throw new TypeError("Fixed dimensions must be integers");
    }
  }
  const transformsColor = output.transformsColor ?? (!name && !location.branch);
  if (typeof transformsColor !== "boolean" || location.branch && transformsColor) throw new TypeError("Branch materials cannot transform the main scene color");
  if (transformsColor && (!["rgba16f", "rgba8"].includes(format) || basis !== "input" || scale !== 1)) throw new TypeError("Main color must preserve input extent and use an RGBA format");
  if (transformsColor && location.domain === "scene-linear" && format !== "rgba16f") throw new TypeError("Scene-linear color requires rgba16f; RGBA8 is not an HDR fallback");
  return Object.freeze({
    name: name ? `CP-F26.texture.${name}` : `CP-F26.${location.branch ? "branch" : "color"}.${materialId}`,
    format, lifetime, transformsColor,
    encoding: output.encoding ?? "preserve",
    size: Object.freeze({ basis, scale, ...(basis === "fixed" ? { width: size.width, height: size.height } : {}) })
  });
}

export function resolveMaterialExtent(output, source, frame, maximum = 16384) {
  const { size } = output;
  const basis = size.basis === "render" ? frame.renderSize : size.basis === "output" ? frame.outputSize : size.basis === "fixed" ? size : source;
  const width = Math.max(1, Math.ceil(basis.width * size.scale));
  const height = Math.max(1, Math.ceil(basis.height * size.scale));
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width > maximum || height > maximum) throw new RangeError("Material target extent exceeds device capabilities");
  return Object.freeze({ width, height, format: output.format, filter: "nearest" });
}
