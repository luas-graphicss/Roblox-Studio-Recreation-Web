export function createSubstrateSmBindingUniformBridge(material) {
  let renderer = null;
  let hostUniforms = null;
  let activeUniforms = null;

  function rememberRenderer(nextRenderer) {
    if (!nextRenderer?.properties?.get) throw new TypeError('SSM_RENDERER_PROPERTIES_REQUIRED');
    if (renderer && renderer !== nextRenderer) throw new Error('SSM_RENDERER_CONTEXT_CHANGED');
    renderer = nextRenderer;
    const properties = renderer.properties.get(material);
    if (properties.uniforms && !Object.hasOwn(properties.uniforms, 'uSsmRecipe')) hostUniforms = properties.uniforms;
    return properties;
  }

  function record(uniforms, nextRenderer) {
    rememberRenderer(nextRenderer);
    activeUniforms = uniforms;
  }

  function activate() {
    if (!renderer) return;
    const properties = rememberRenderer(renderer);
    if (!activeUniforms) return;
    properties.uniforms = activeUniforms;
    properties.uniformsList = null;
  }

  function deactivate() {
    if (!renderer) return;
    const properties = renderer.properties.get(material);
    if (hostUniforms && properties.uniforms === activeUniforms) {
      properties.uniforms = hostUniforms;
      properties.uniformsList = null;
    }
  }

  function clear() {
    deactivate();
    renderer = null;
    hostUniforms = null;
    activeUniforms = null;
  }

  function getRenderer() { return renderer; }
  return Object.freeze({ rememberRenderer, record, activate, deactivate, clear, getRenderer });
}
