function sortedEntries(input = {}) {
  return Object.keys(input)
    .sort()
    .map((name) => [name, input[name]]);
}

export function shaderStructureKey(material, output = {}) {
  if (typeof material?.fragmentShader !== "string")
    throw new TypeError("A fragment shader is required");
  return JSON.stringify([
    material.vertexShader ?? "",
    material.fragmentShader,
    sortedEntries(material.defines),
    material.glslVersion ?? null,
    material.precision ?? null,
    material.toneMapped === true,
    sortedEntries(material.extensions),
    output.colorSpace ?? null,
    output.toneMapping ?? null
  ]);
}

export function updateMaterialUniforms(material, values) {
  for (const name of Object.keys(values))
    if (!Object.hasOwn(material.uniforms, name)) throw new Error(`Unknown shader uniform: ${name}`);
  for (const [name, value] of Object.entries(values)) material.uniforms[name].value = value;
}

export function updateMaterialDefines(material, defines) {
  const normalized = Object.fromEntries(sortedEntries(defines));
  if (JSON.stringify(sortedEntries(material.defines)) === JSON.stringify(sortedEntries(normalized)))
    return false;
  material.defines = normalized;
  material.needsUpdate = true;
  return true;
}
