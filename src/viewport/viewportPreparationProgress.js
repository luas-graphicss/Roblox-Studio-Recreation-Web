function fraction(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export function viewportPreparationProgress({
  lighting = {},
  terrainPending = false,
  postProcessingPending = false,
} = {}) {
  const environment = lighting.environmentPending ? fraction(lighting.environmentProgress) : 1;
  const shaders = lighting.shaderPending ? 0 : lighting.shaderCompiling
    ? 0.7 * fraction(lighting.slice?.pct) + 0.3 * fraction(lighting.programProgress)
    : 1;
  const stages = lighting.stages;
  const effects = lighting.initialFramesRemaining > 0 ? 0 : stages?.active
    ? fraction(stages.idx / stages.total)
    : 1;
  const completedWeight = (lighting.lightingDirty ? 0 : 1) +
    2 * environment + 4 * shaders + 2 * effects +
    (lighting.substrateWaiting ? 0 : 1) +
    (terrainPending ? 0 : 1) + (postProcessingPending ? 0 : 1);
  return completedWeight / 12;
}
