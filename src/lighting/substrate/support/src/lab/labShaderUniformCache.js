export function retainMaterialUniforms(material, nextUniforms) {
  const retained = material.userData.sbShaderUniforms ?? {};
  Object.assign(retained, nextUniforms);
  material.userData.sbShaderUniforms = retained;
  return retained;
}
