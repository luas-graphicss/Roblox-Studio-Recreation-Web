function readThreshold(value, fallback, label) {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)
    throw new TypeError(`${label} must be in [0, 1]`);
  return value;
}

export function describeMotionMaterial(THREE, material, configuration = {}) {
  if (!material || material.visible === false || configuration.enabled === false)
    return { included: false, reason: "disabled" };
  const translucent = material.transparent === true || material.transmission > 0;
  if (translucent && configuration.outputVelocity !== true)
    return { included: false, reason: "translucency-not-authorized" };
  const customShader =
    material.isShaderMaterial ||
    material.isRawShaderMaterial ||
    (material.onBeforeCompile && material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile);
  const customVertex = customShader || material.displacementMap;
  if (
    customVertex &&
    typeof configuration.samplePosition !== "function" &&
    configuration.vertexDeformation !== "none"
  )
    throw new Error("CP-F06 needs an explicit samplePosition for custom vertex deformation");
  if (customShader && configuration.fragmentCoverage !== "standard-alpha")
    throw new Error(
      "CP-F06 requires an explicit standard-alpha fragmentCoverage contract for custom shaders",
    );
  if (material.alphaHash || material.alphaToCoverage || material.wireframe)
    throw new Error("CP-F06 does not silently approximate alphaHash, alphaToCoverage or wireframe coverage");
  if (material.depthTest === false || (!translucent && material.depthWrite === false))
    throw new Error("CP-F06 requires depth-tested surfaces and depth-writing opaque geometry");
  const alphaTest = readThreshold(material.alphaTest, 0, "Alpha test");
  const alphaThreshold = translucent
    ? Math.max(alphaTest, readThreshold(configuration.alphaThreshold, 0.5, "Velocity alpha threshold"))
    : alphaTest;
  return {
    included: true,
    translucent,
    alphaThreshold,
    opacity: readThreshold(material.opacity, 1, "Opacity"),
    side: material.side ?? THREE.FrontSide,
    map: material.map ?? null,
    alphaMap: material.alphaMap ?? null,
    material,
  };
}

export function encodeSurfaceIdentity(identity) {
  if (!Number.isInteger(identity) || identity < 0 || identity > 16777215)
    throw new TypeError("Invalid surface identity");
  return [(identity & 255) / 255, ((identity >>> 8) & 255) / 255, ((identity >>> 16) & 255) / 255];
}
