export function assertTextureInputs(material, target, pool) {
  const outputs = new Set(
    [target?.texture, target?.depthTexture, ...(target?.textures ?? [])].filter(Boolean)
  );
  const seen = new Set();
  function inspect(value) {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (outputs.has(value)) throw new Error("Read/write texture feedback is forbidden");
    if (pool?.textureStatus?.(value) === false)
      throw new Error("A shader samples a released texture");
    if (value.isTexture) return;
    if (Array.isArray(value)) {
      for (const item of value) inspect(item);
    } else if (
      Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null
    ) {
      for (const item of Object.values(value)) inspect(item);
    }
  }
  for (const uniform of Object.values(material?.uniforms ?? {})) inspect(uniform.value);
}
