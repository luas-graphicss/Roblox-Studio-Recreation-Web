function closureOpacity(closure) {
  if (closure.kind === 'volume') {
    const extinction = Array.isArray(closure.parameters?.extinction) ? closure.parameters.extinction : [0.5, 0.5, 0.5];
    const mean = extinction.reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0) / 3;
    return 1 - Math.exp(-mean);
  }
  return closure.parameters?.opacity ?? 1;
}
export function applyClosureRenderState(material, {enabled, closures = [], weights, legacy}) {
  const opacity = Math.min(1, Math.max(0, closures.reduce((sum, closure, index) => {
    const weight = Math.max(0, weights?.[index] ?? closure.weight ?? 1);
    return sum + closureOpacity(closure) * weight;
  }, 0)));
  const transparent = enabled ? legacy.transparent || opacity < 1 - 1e-6 : legacy.transparent;
  const depthWrite = enabled && transparent ? false : legacy.depthWrite;
  if (material.transparent !== transparent) material.needsUpdate = true;
  material.transparent = transparent;
  material.depthWrite = depthWrite;
  return {opacity: enabled ? opacity : material.opacity, transparent, depthWrite, mode: transparent ? 'sorted-alpha' : 'opaque'};
}
