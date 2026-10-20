import { copyAuthoringData, requireRecord, requireKeys, requireIdentifier, requireNumber, reject } from "./authoringData.js";

export function validateAssets(input = {}) {
  requireRecord(input, "$.assets");
  for (const [id, asset] of Object.entries(input)) {
    requireIdentifier(id, "$.assets");
    requireKeys(asset, ["kind", "uri", "colorSpace", "sha256", "label"], `$.assets.${id}`);
    if (!["texture", "lut", "kernel", "curve", "material"].includes(asset.kind)) reject("invalid-asset-kind", `$.assets.${id}`, "Unsupported asset kind");
    if (typeof asset.uri !== "string" || !asset.uri || /[\\\u0000-\u0020]/.test(asset.uri) || /^(?:javascript|data|file):/i.test(asset.uri) || asset.uri.startsWith("//") || asset.uri.split("/").includes("..") || /^[a-z]+:/i.test(asset.uri) && !/^https?:\/\//i.test(asset.uri)) reject("invalid-asset-uri", `$.assets.${id}.uri`, "Use a relative or HTTP(S) asset reference");
    for (const name of ["colorSpace", "label"]) if (Object.hasOwn(asset, name) && typeof asset[name] !== "string") reject("invalid-asset-metadata", `$.assets.${id}.${name}`, "Expected text");
    if (asset.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(asset.sha256)) reject("invalid-asset-hash", `$.assets.${id}.sha256`, "Expected SHA-256 hex");
  }
  return input;
}
export function validateCurves(input = {}) {
  requireRecord(input, "$.curves");
  for (const [id, curve] of Object.entries(input)) {
    requireIdentifier(id, "$.curves");
    requireKeys(curve, ["interpolation", "keys"], `$.curves.${id}`);
    if (!["linear", "step", "smoothstep"].includes(curve.interpolation) || !Array.isArray(curve.keys) || curve.keys.length < 2 || curve.keys.length > 4096) reject("invalid-curve", `$.curves.${id}`, "Expected interpolation and 2..4096 keys");
    let previous = -Infinity;
    for (const [index, key] of curve.keys.entries()) {
      requireKeys(key, ["x", "y"], `$.curves.${id}.keys.${index}`);
      requireNumber(key.x, `$.curves.${id}.x`); requireNumber(key.y, `$.curves.${id}.y`);
      if (key.x <= previous) reject("invalid-curve-order", `$.curves.${id}`, "Keys must strictly increase in x");
      previous = key.x;
    }
  }
  return input;
}
export function sampleAuthoringCurve(authoredCurve, position) {
  const curve = copyAuthoringData(authoredCurve);
  validateCurves({ sample: curve }); requireNumber(position, "$.position");
  const keys = curve.keys;
  if (position <= keys[0].x) return keys[0].y;
  if (position >= keys.at(-1).x) return keys.at(-1).y;
  const rightIndex = keys.findIndex(key => key.x > position);
  const left = keys[rightIndex - 1]; const right = keys[rightIndex];
  if (curve.interpolation === "step") return left.y;
  const extent = right.x - left.x;
  const fraction = Number.isFinite(extent) ? (position - left.x) / extent : (position / 2 - left.x / 2) / (right.x / 2 - left.x / 2);
  const weight = curve.interpolation === "smoothstep" ? fraction * fraction * (3 - 2 * fraction) : fraction;
  return left.y * (1 - weight) + right.y * weight;
}
