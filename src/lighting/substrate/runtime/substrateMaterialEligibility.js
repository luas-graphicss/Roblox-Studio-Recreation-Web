export function substrateMaterialRefusal(material) {
  if (!material?.isMeshStandardMaterial) return 'Substrate requires a real Standard or Physical material';
  if (!material.isMeshPhysicalMaterial) return null;
  const advanced = ['clearcoat', 'transmission', 'sheen', 'iridescence', 'anisotropy'].filter(name => Number(material[name]) > 0);
  const maps = ['clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'transmissionMap', 'thicknessMap', 'sheenColorMap', 'sheenRoughnessMap', 'iridescenceMap', 'iridescenceThicknessMap', 'anisotropyMap', 'specularColorMap', 'specularIntensityMap'].filter(name => material[name]);
  if (Number(material.ior) !== 1.5 || Number(material.specularIntensity) !== 1 || material.specularColor?.getHex() !== 0xffffff) advanced.push('native specular response');
  return advanced.length || maps.length ? 'Preserved native PhysicalMaterial: the current slab GPU ABI does not reproduce ' + [...advanced, ...maps].join(', ') : null;
}
