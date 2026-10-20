export function createMegaLightsDebugTextureReader({ THREE, renderer }) {
  let target = null;
  let material = null;
  let geometry = null;
  let scene = null;
  let camera = null;
  const viewport = new THREE.Vector4();
  const scissor = new THREE.Vector4();
  const clearColor = new THREE.Color();

  function ensure(width, height) {
    if (
      !renderer.capabilities?.isWebGL2 ||
      !renderer.extensions.has("EXT_color_buffer_float")
    )
      throw new Error(
        "Float readback requires WebGL2 and EXT_color_buffer_float",
      );
    if (!target) {
      target = new THREE.WebGLRenderTarget(width, height, {
        type: THREE.FloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: false,
        stencilBuffer: false,
      });
      material = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: {
          sourceTexture: { value: null },
          outputSize: { value: new THREE.Vector2() },
          sourceOrigin: { value: new THREE.Vector2() },
          sourceExtent: { value: new THREE.Vector2() },
        },
        vertexShader:
          "in vec3 position; void main() { gl_Position = vec4(position, 1.0); }",
        fragmentShader:
          "precision highp float; precision highp sampler2D; uniform sampler2D sourceTexture; uniform vec2 outputSize; uniform vec2 sourceOrigin; uniform vec2 sourceExtent; out vec4 fragmentColor; void main() { ivec2 size = textureSize(sourceTexture, 0); ivec2 coordinate = ivec2(floor(sourceOrigin + gl_FragCoord.xy / outputSize * sourceExtent)); fragmentColor = texelFetch(sourceTexture, clamp(coordinate, ivec2(0), size - 1), 0); }",
        depthTest: false,
        depthWrite: false,
        blending: THREE.NoBlending,
      });
      geometry = new THREE.PlaneGeometry(2, 2);
      scene = new THREE.Scene();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      scene.add(mesh);
      camera = new THREE.Camera();
    }
    if (target.width !== width || target.height !== height)
      target.setSize(width, height);
  }

  function read(texture, size, region = null) {
    if (!texture?.isTexture) throw new Error("No texture was produced");
    if (
      texture.isData3DTexture ||
      texture.isDataArrayTexture ||
      texture.isCubeTexture
    )
      throw new Error(
        "This texture requires an explicit layer adapter; a 2D image would be misleading",
      );
    if (
      texture.format === THREE.RedIntegerFormat ||
      texture.format === THREE.RGIntegerFormat ||
      texture.format === THREE.RGBAIntegerFormat
    )
      throw new Error("Integer textures require an integer sampler adapter");
    const width = region ? 1 : Math.max(1, Math.min(128, size.width));
    const height = region
      ? 1
      : Math.max(
          1,
          Math.min(96, Math.round((width * size.height) / size.width)),
        );
    ensure(width, height);
    const previousTarget = renderer.getRenderTarget();
    const previousCubeFace = renderer.getActiveCubeFace?.() || 0;
    const previousMipmap = renderer.getActiveMipmapLevel?.() || 0;
    const previousScissorTest = renderer.getScissorTest();
    const previousAutoClear = renderer.autoClear;
    const previousAlpha = renderer.getClearAlpha();
    const previousRenderInfo = { ...renderer.info.render };
    const previousXr = renderer.xr?.enabled;
    renderer.getViewport(viewport);
    renderer.getScissor(scissor);
    renderer.getClearColor(clearColor);
    try {
      if (renderer.xr) renderer.xr.enabled = false;
      renderer.autoClear = false;
      renderer.setRenderTarget(target);
      renderer.setViewport(0, 0, width, height);
      renderer.setScissorTest(false);
      renderer.setClearColor(0xff00ff, 0);
      renderer.clear();
      material.uniforms.sourceTexture.value = texture;
      material.uniforms.outputSize.value.set(width, height);
      material.uniforms.sourceOrigin.value.set(region?.x || 0, region?.y || 0);
      material.uniforms.sourceExtent.value.set(
        region ? 1 : size.width,
        region ? 1 : size.height,
      );
      material.uniformsNeedUpdate = true;
      const context = renderer.getContext();
      if (
        context.checkFramebufferStatus(context.FRAMEBUFFER) !==
        context.FRAMEBUFFER_COMPLETE
      )
        throw new Error("Debug framebuffer is incomplete");
      renderer.render(scene, camera);
      const pixels = new Float32Array(width * height * 4);
      pixels.fill(NaN);
      renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
      if (pixels.every((value) => !Number.isFinite(value)))
        throw new Error("GPU readback wrote no finite texels");
      return {
        width,
        height,
        pixels,
        sourceWidth: size.width,
        sourceHeight: size.height,
      };
    } finally {
      material.uniforms.sourceTexture.value = null;
      renderer.setRenderTarget(
        previousTarget,
        previousCubeFace,
        previousMipmap,
      );
      renderer.setViewport(viewport);
      renderer.setScissor(scissor);
      renderer.setScissorTest(previousScissorTest);
      renderer.setClearColor(clearColor, previousAlpha);
      renderer.autoClear = previousAutoClear;
      Object.assign(renderer.info.render, previousRenderInfo);
      if (renderer.xr) renderer.xr.enabled = previousXr;
    }
  }

  return {
    read,
    dispose() {
      target?.dispose();
      material?.dispose();
      geometry?.dispose();
      target = material = geometry = scene = camera = null;
    },
  };
}
