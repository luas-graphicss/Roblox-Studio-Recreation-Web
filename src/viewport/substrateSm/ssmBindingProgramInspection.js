export function inspectSubstrateSmBindingProgram({ renderer, material, expectedKey, recipeUniform, requireSelected }) {
  const properties = renderer.properties.get(material);
  const context = renderer.getContext();
  const program = properties.currentProgram;
  if (context.isContextLost()) throw new Error('SSM_BINDING_CONTEXT_LOST');
  if (!program?.program || typeof program.cacheKey !== 'string' || !program.cacheKey.endsWith(expectedKey)) {
    throw new Error('SSM_BINDING_PROGRAM_KEY_MISMATCH');
  }
  if (context.getProgramParameter(program.program, context.LINK_STATUS) !== true) throw new Error('SSM_BINDING_PROGRAM_LINK_FAILED');
  const shaders = context.getAttachedShaders(program.program) ?? [];
  if (shaders.length !== 2 || shaders.some(shader => context.getShaderParameter(shader, context.COMPILE_STATUS) !== true)) {
    throw new Error('SSM_BINDING_PROGRAM_SHADER_FAILED');
  }
  const fragment = shaders.find(shader => context.getShaderParameter(shader, context.SHADER_TYPE) === context.FRAGMENT_SHADER);
  if (!fragment || !context.getShaderSource(fragment)?.includes('#define SSM_RESPONSE_READY 1')
    || properties.uniforms?.uSsmRecipe !== recipeUniform
    || context.getUniformLocation(program.program, 'uSsmRecipe[0]') === null) throw new Error('SSM_BINDING_PROGRAM_LAYOUT_MISMATCH');
  const selected = context.getParameter(context.CURRENT_PROGRAM) === program.program;
  if (requireSelected && !selected) throw new Error('SSM_BINDING_PROGRAM_NOT_SELECTED');
  return Object.freeze({ selected, linked: true, layoutMatches: true });
}
