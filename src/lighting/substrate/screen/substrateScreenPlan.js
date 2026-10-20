export const SUBSTRATE_SCREEN_LIMITS = Object.freeze({
  medio: Object.freeze({ diffusionPixels: 524288, peelLayers: 4, diffusionSamples: 32, bytes: 192 * 1024 * 1024 }),
  forte: Object.freeze({ diffusionPixels: 1048576, peelLayers: 8, diffusionSamples: 48, bytes: 320 * 1024 * 1024 }),
});

export function createSubstrateScreenPlan({ width, height, tier, subsurfaceSlots = [], translucency = false, maxTextureSize = 4096 }) {
  const limits = SUBSTRATE_SCREEN_LIMITS[tier];
  if (!limits) return { accepted: false, reason: 'Screen materials require an eligible Future tier' };
  if (![width, height, maxTextureSize].every(value => Number.isInteger(value) && value > 0)) return { accepted: false, reason: 'Invalid screen dimensions' };
  if (width > maxTextureSize || height > maxTextureSize) return { accepted: false, reason: 'Screen dimensions exceed the texture limit' };
  const slots = [...new Set(subsurfaceSlots)].filter(slot => Number.isInteger(slot) && slot >= 0 && slot < 3).sort();
  const atlasSlots = slots.length ? Math.max(...slots) + 1 : 0;
  const scale = Math.min(1, Math.sqrt(limits.diffusionPixels / (width * height)), atlasSlots ? maxTextureSize / (height * atlasSlots) : 1);
  const diffusionWidth = Math.max(1, Math.floor(width * scale));
  const diffusionHeight = Math.max(1, Math.floor(height * scale));
  const diffusionBytes = slots.length ? diffusionWidth * diffusionHeight * (68 + 16 * atlasSlots) : 0;
  const translucencyBytes = translucency ? width * height * 96 : 0;
  const bytes = diffusionBytes + translucencyBytes + 12;
  return {
    accepted: bytes <= limits.bytes, reason: bytes <= limits.bytes ? null : 'Screen material resources exceed the tier budget',
    width, height, diffusionWidth, diffusionHeight, subsurfaceSlots: slots, atlasSlots,
    diffusionSamples: limits.diffusionSamples, peelLayers: limits.peelLayers, translucency,
    bytes, byteCeiling: limits.bytes,
  };
}

export function collectSubstrateScreenDemand(entries, { subsurface, translucency }) {
  const subsurfaceSlots = new Set();
  const transparentMaterials = new Set();
  for (const entry of entries ?? []) {
    if (!entry.enabled || !entry.material?.userData?.sbRuntime?.enabled) continue;
    const count = entry.uniforms?.uSbClosureCount?.value ?? entry.result?.closures?.length ?? 0;
    if (translucency && entry.material.transparent) transparentMaterials.add(entry.material);
    if (!subsurface || entry.material.transparent) continue;
    for (let slot = 0; slot < count; slot++) {
      const closure = entry.result?.closures?.[slot];
      if (closure?.kind === 'slab' && closure.parameters?.subsurfaceMeanFreePath?.some(value => value > 0)) subsurfaceSlots.add(slot);
    }
  }
  return { subsurfaceSlots: [...subsurfaceSlots], transparentMaterials, active: subsurfaceSlots.size > 0 || transparentMaterials.size > 0 };
}
