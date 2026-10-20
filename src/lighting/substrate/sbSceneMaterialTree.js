import { createSlabNode, createOperatorNode } from "./sbMaterialTreeCore.js";
export function createLayeredMaterialTree(layered, label = null) {
  return createOperatorNode({
    operator: "verticalLayering",
    label,
    parameters: {
      coverage: layered.coverage ?? 1,
      thickness: layered.thickness ?? 0,
      transmittanceColor: layered.transmittanceColor ?? [1, 1, 1],
    },
    children: [
      createSlabNode(layered.top, { label: label ? `${label}:top` : null }),
      createSlabNode(layered.bottom, { label: label ? `${label}:base` : null }),
    ],
  });
}
export function resolveSceneMaterialTree(material) {
  const data = material.userData;
  const label = data.sbSlabId ?? material.uuid;
  if (data.sbAuthoredTree) return data.sbAuthoredTree;
  if (data.sbSceneTree) return data.sbSceneTree;
  if (data.sbLayeredSlab)
    return createLayeredMaterialTree(data.sbLayeredSlab, label);
  return createSlabNode(data.sbSlab, { label });
}
