import { inspectSubstrateSmMaterialBoundary } from './ssmMaterialBoundaryPolicy.js';

const supportedPaths = new Set(["phong", "poolPhong"]);

function refuse(reason) {
  return Object.freeze({ supported: false, reason });
}

export function inspectSubstrateSmPhongHostMaterial({ material, materialPath = "phong" } = {}) {
  if (!supportedPaths.has(materialPath)) return refuse("SSM_PHONG_PATH_UNSUPPORTED");
  if (!material || material.isMeshPhongMaterial !== true) return refuse("SSM_PHONG_MATERIAL_REQUIRED");
  if (material.isShaderMaterial || material.isRawShaderMaterial) return refuse("SSM_CUSTOM_SHADER_DELEGATED");
  if (material.userData?.__rswGlassRefr) return refuse("SSM_REFRACTION_DELEGATED");
  if (material.transparent || material.alphaHash || material.transmission > 0 || material.opacity !== 1) {
    return refuse("SSM_TRANSPARENCY_DELEGATED");
  }
  if (material.wireframe || material.flatShading) return refuse("SSM_PHONG_VARIANT_DELEGATED");
  if (!Number.isFinite(material.alphaTest) || material.alphaTest < 0 || material.alphaTest > 1) {
    return refuse("SSM_ALPHA_TEST_INVALID");
  }
  const boundary = inspectSubstrateSmMaterialBoundary({ material });
  if (!boundary.allowed) return refuse(boundary.code);
  return Object.freeze({
    supported: true,
    reason: null,
    materialPath,
    hostBackend: "phong",
    blendMode: boundary.blendMode,
    instanceColor: materialPath === "poolPhong" ? "host" : "not-applicable",
    alpha: "host",
    mapCoordinates: "host",
    emission: "host-or-recipe",
    additionalAttributes: 0,
    additionalPasses: 0,
  });
}

export function inspectSubstrateSmPhongMaterial({ material, materialPath = "phong", recipe } = {}) {
  const host = inspectSubstrateSmPhongHostMaterial({ material, materialPath });
  if (!host.supported) return host;
  if (!recipe || recipe.family !== "base") return refuse("SSM_PHONG_BASE_FAMILY_REQUIRED");
  if (recipe.parameters?.opacity !== 1) return refuse("SSM_RECIPE_TRANSPARENCY_DELEGATED");
  return host;
}
