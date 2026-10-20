export function createSubstrateScreenDrawGuard(renderer, samplerCeiling = 16) {
  const verifiedPrograms = new WeakSet();
  return function drawScreenScene(scene, camera) {
    const gl = renderer.getContext();
    const framebuffer = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (framebuffer !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Substrate framebuffer is incomplete: ' + framebuffer.toString(16));
    renderer.render(scene, camera);
    const samplerTypes = new Set([gl.SAMPLER_2D, gl.SAMPLER_CUBE, gl.SAMPLER_3D, gl.SAMPLER_2D_ARRAY, gl.SAMPLER_2D_SHADOW, gl.SAMPLER_CUBE_SHADOW, gl.SAMPLER_2D_ARRAY_SHADOW, gl.INT_SAMPLER_2D, gl.INT_SAMPLER_3D, gl.INT_SAMPLER_CUBE, gl.INT_SAMPLER_2D_ARRAY, gl.UNSIGNED_INT_SAMPLER_2D, gl.UNSIGNED_INT_SAMPLER_3D, gl.UNSIGNED_INT_SAMPLER_CUBE, gl.UNSIGNED_INT_SAMPLER_2D_ARRAY]);
    for (const program of renderer.info.programs) {
      if (verifiedPrograms.has(program)) continue;
      if (!gl.getProgramParameter(program.program, gl.LINK_STATUS)) throw new Error('Substrate GPU program did not link: ' + gl.getProgramInfoLog(program.program));
      let samplers = 0;
      const uniformCount = gl.getProgramParameter(program.program, gl.ACTIVE_UNIFORMS);
      for (let index = 0; index < uniformCount; index++) {
        const uniform = gl.getActiveUniform(program.program, index);
        if (samplerTypes.has(uniform.type)) samplers += uniform.size;
      }
      if (samplers > samplerCeiling) throw new Error('Substrate linked sampler ceiling exceeded: ' + samplers + '/' + samplerCeiling);
      verifiedPrograms.add(program);
    }
  };
}
