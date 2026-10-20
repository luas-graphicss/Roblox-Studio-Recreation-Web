import { validateIdentifier } from "./identifierCodec.js";

const SUPPORTED_DOMAINS = Object.freeze(["surface", "terrain", "water", "particle"]);

export function resolveSurfacePolicy(object, material) {
  const configuration = object.userData?.cinematicGeometry ?? {};
  const materialConfiguration = material.userData?.cinematicGeometry ?? {};
  const domain = configuration.domain ?? ((object.isPoints || object.isSprite) ? "particle" : "surface");
  if (!SUPPORTED_DOMAINS.includes(domain)) throw new Error(`CP-F05 unsupported geometry domain: ${domain}`);
  const mode = configuration.mode ?? materialConfiguration.mode ?? (material.transparent || material.transmission > 0 ? "translucent" : material.alphaTest > 0 ? "masked" : "opaque");
  if (!["opaque", "masked", "translucent", "exclude"].includes(mode)) throw new Error(`CP-F05 unsupported surface mode: ${mode}`);
  const customDepth = configuration.customDepth ?? false;
  if (typeof customDepth !== "boolean") throw new TypeError("CP-F05 customDepth must be boolean");
  if (mode === "masked" && !(material.alphaTest > 0)) throw new Error("CP-F05 masked surfaces require an explicit positive alphaTest");
  if (mode === "translucent" && customDepth && !(material.alphaTest > 0)) throw new Error("CP-F05 translucent custom depth requires an explicit alphaTest");
  const primary = mode === "opaque" || mode === "masked";
  if (primary && (material.depthWrite === false || material.depthTest === false)) throw new Error("CP-F05 primary surfaces require depthTest and depthWrite");
  const stencil = validateIdentifier(configuration.stencil ?? 0, "custom stencil", 255);
  if (stencil !== 0 && !customDepth) throw new Error("CP-F05 a stencil value requires customDepth participation");
  const objectId = validateIdentifier(configuration.objectId ?? object.id + 1, "object ID");
  const materialId = validateIdentifier(materialConfiguration.materialId ?? material.id + 1, "material ID");
  return Object.freeze({
    domain,
    mode,
    primary,
    customDepth: mode !== "exclude" && customDepth,
    stencil,
    objectId,
    materialId,
    normalSemantics: object.isPoints || object.isSprite ? "camera-facing-particle" : "view-space-shading-normal",
    reason: primary ? "depth-writing-surface" : mode === "translucent" ? "translucency-is-owned-by-CP-F27" : "explicit-exclusion"
  });
}
