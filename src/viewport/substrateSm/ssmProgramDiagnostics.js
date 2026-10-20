import { readSubstrateSmProgramDescriptor } from './ssmDiagnosticData.js';

const samplerTargets = new Map([
  [0x8b5e, 0x8069], [0x8b60, 0x8514], [0x8b5f, 0x806a], [0x8dc1, 0x8c1d],
  [0x8b62, 0x8069], [0x8dc4, 0x8c1d], [0x8dc5, 0x8514],
  [0x8dca, 0x8069], [0x8dcb, 0x806a], [0x8dcc, 0x8514], [0x8dcf, 0x8c1d],
  [0x8dd2, 0x8069], [0x8dd3, 0x806a], [0x8dd4, 0x8514], [0x8dd7, 0x8c1d],
]);

function activeEntries(context, program, countName, readName) {
  const count = context.getProgramParameter(program, context[countName]);
  if (!Number.isSafeInteger(count) || count < 0 || count > 2048) throw new Error('SSM_QA_PROGRAM_RESOURCE_LIMIT');
  return Array.from({ length: count }, (_, index) => {
    const item = context[readName](program, index);
    if (!item) throw new Error('SSM_QA_PROGRAM_RESOURCE_UNAVAILABLE');
    return { name: item.name, size: item.size, type: item.type };
  });
}

export function inspectSubstrateSmDrawProgram({ renderer, material, state, contextGeneration, resourceId, sourceCache }) {
  const context = renderer.getContext();
  if (context.isContextLost()) throw new Error('SSM_QA_CONTEXT_LOST');
  const selected = context.getParameter(context.CURRENT_PROGRAM);
  const properties = renderer.properties.get(material);
  const host = properties?.currentProgram;
  const matchesMaterial = Boolean(selected && selected === host?.program);
  if (!matchesMaterial) return { verified: false, reason: 'SSM_QA_MATERIAL_PROGRAM_NOT_SELECTED' };
  const linked = context.getProgramParameter(selected, context.LINK_STATUS) === true;
  if (!linked) return { verified: false, reason: 'SSM_QA_PROGRAM_NOT_LINKED' };
  let shaders = sourceCache.get(selected);
  if (!shaders) {
    if (sourceCache.size >= 32) throw new Error('SSM_QA_PROGRAM_CAPTURE_LIMIT');
    const attached = context.getAttachedShaders(selected) ?? [];
    shaders = attached.map(shader => ({ type: context.getShaderParameter(shader, context.SHADER_TYPE),
      compiled: context.getShaderParameter(shader, context.COMPILE_STATUS) === true,
      source: context.getShaderSource(shader) ?? '' }));
    if (shaders.some(shader => shader.source.length > 262144)) throw new Error('SSM_QA_SHADER_SOURCE_LIMIT');
    sourceCache.set(selected, shaders);
  }
  const uniforms = activeEntries(context, selected, 'ACTIVE_UNIFORMS', 'getActiveUniform');
  const attributes = activeEntries(context, selected, 'ACTIVE_ATTRIBUTES', 'getActiveAttrib');
  const samplers = [];
  const savedTexture = context.getParameter(context.ACTIVE_TEXTURE);
  const maxUnits = context.getParameter(context.MAX_COMBINED_TEXTURE_IMAGE_UNITS);
  try {
    for (const uniform of uniforms) {
      const target = samplerTargets.get(uniform.type);
      if (!target) continue;
      const location = context.getUniformLocation(selected, uniform.name);
      const value = context.getUniform(selected, location);
      const units = ArrayBuffer.isView(value) ? [...value] : [value];
      const bindings = units.map(unit => {
        if (!Number.isSafeInteger(unit) || unit < 0 || unit >= maxUnits) throw new Error('SSM_QA_SAMPLER_UNIT_INVALID');
        context.activeTexture(context.TEXTURE0 + unit);
        const texture = context.getParameter(target);
        return { unit, bound: texture !== null, textureId: resourceId(texture), bindingTarget: target };
      });
      samplers.push({ ...uniform, bindings });
    }
  } finally { context.activeTexture(savedTexture); }
  const descriptor = readSubstrateSmProgramDescriptor(state?.programKey);
  const fragment = shaders.find(shader => shader.type === context.FRAGMENT_SHADER);
  const recipe = uniforms.find(uniform => uniform.name === 'uSsmRecipe[0]' && uniform.type === context.FLOAT_VEC4 && uniform.size >= 7);
  const hasSignature = typeof state?.programKey?.signature === 'string'
    && typeof host.cacheKey === 'string' && host.cacheKey.endsWith('|' + state.programKey.signature);
  const verified = (state?.shaderCommitted ?? state?.applied) === true && state?.disposed !== true && state?.contextGeneration === contextGeneration
    && descriptor !== null && shaders.length === 2 && shaders.every(shader => shader.compiled)
    && fragment?.source.includes('#define SSM_RESPONSE_READY 1') === true
    && Boolean(recipe) && Boolean(properties.uniforms?.uSsmRecipe) && hasSignature;
  return { verified, reason: verified ? null : 'SSM_QA_SSM_PROGRAM_UNCONFIRMED', programId: resourceId(selected),
    programCacheKey: host.cacheKey, programHash: state?.programKey?.hash ?? null, descriptor,
    selected: true, linked, shaders, resources: { activeUniforms: uniforms, activeAttributes: attributes,
      activeSamplerCount: samplers.reduce((sum, item) => sum + item.size, 0), samplers,
      uniformStageSplit: 'unavailable-in-webgl', gpuBytes: null } };
}
