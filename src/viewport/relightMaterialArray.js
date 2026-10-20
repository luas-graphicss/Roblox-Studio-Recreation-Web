export function relightMaterialArray(mesh, relight) {
  const materials = mesh.material;
  if (!Array.isArray(materials)) return false;
  const replacements = new Map();
  const shadowState = { castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow, customDepthMaterial: mesh.customDepthMaterial, customDistanceMaterial: mesh.customDistanceMaterial };
  try {
    for (let index = 0; index < materials.length; index++) {
      const original = materials[index];
      if (!replacements.has(original)) {
        mesh.material = original;
        relight(mesh);
        replacements.set(original, mesh.material);
      }
      materials[index] = replacements.get(original);
    }
  } finally {
    mesh.material = materials;
    Object.assign(mesh, shadowState);
  }
  return true;
}
