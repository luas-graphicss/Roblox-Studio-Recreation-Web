import { createSlabNode } from '../sbMaterialTreeCore.js';
import { createLayeredMaterialTree } from '../sbSceneMaterialTree.js';
import { sanitizeSlabParameters } from '../sbSlabParametersCore.js';
import { physicsFor, featuresForMaterial } from '../../materialPhysicsTable.js';
export function refreshSubstrateMaterialSource(material) {
  const data = material.userData;
  if (data.sbAuthoredTree) return;
  const named = typeof data.__rswMatName === 'string';
  const physics = named ? physicsFor(data.__rswMatName) : null;
  const features = named ? featuresForMaterial(data.__rswMatName) : {};
  const signature = [data.__rswMatName, material.roughness, material.metalness, material.clearcoat, material.clearcoatRoughness, material.anisotropy, physics?.f0, physics?.rough, features.aniso, features.sheen, features.sheenRough, features.coat, features.coatRough].join('|');
  if (data.__rswSbSourceSignature === signature && data.sbSceneTree) return;
  const f0 = physics?.f0 ?? 0.04;
  const slab = sanitizeSlabParameters({
    albedo: [1, 1, 1], f0: [f0, f0, f0], roughness: material.roughness ?? physics?.rough ?? 0.5,
    anisotropy: features.aniso ?? material.anisotropy ?? 0,
    fuzzAmount: features.sheen ?? 0, fuzzRoughness: features.sheenRough ?? 0.4,
    opacity: 1, emissive: [0, 0, 0],
  });
  const coat = material.clearcoat ?? features.coat ?? 0;
  data.sbSlab = slab;
  data.sbSceneTree = coat > 0 ? createLayeredMaterialTree({
    top: sanitizeSlabParameters({ albedo: [0, 0, 0], f0: [0.04, 0.04, 0.04], roughness: material.clearcoatRoughness ?? features.coatRough ?? 0.15, opacity: 1 }),
    bottom: slab, coverage: coat, thickness: 0, transmittanceColor: [1, 1, 1],
  }, material.uuid) : createSlabNode(slab, { label: material.uuid });
  data.__rswSbSourceSignature = signature;
}
