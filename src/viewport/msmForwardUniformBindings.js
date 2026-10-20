export function refreshMsmForwardUniformBindings(renderer, material, sharedUniforms) {
  const properties = renderer?.properties?.get?.(material);
  const uniforms = properties?.uniforms;
  if (!uniforms) return false;
  let changed = false;
  for (const name of Object.keys(sharedUniforms)) {
    if (uniforms[name] === sharedUniforms[name]) continue;
    uniforms[name] = sharedUniforms[name];
    changed = true;
  }
  if (changed) properties.uniformsList = null;
  return changed;
}
