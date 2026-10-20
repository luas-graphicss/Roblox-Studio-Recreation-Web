import { createFullscreenTriangle, FULLSCREEN_VERTEX } from "./fullscreenTriangle.js";
import { withRendererState } from "./rendererState.js";

export function createRendererAdapter(THREE, canvas) {
  const context = canvas.getContext("webgl2", { alpha: false, antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false });
  if (!context) throw new Error("WebGL2 is required for the cinematic foundation");
  if (!context.getExtension("EXT_color_buffer_float")) throw new Error("FP16 color rendering is unavailable; the HDR foundation cannot silently use RGBA8");
  const renderer = new THREE.WebGLRenderer({ canvas, context, alpha: false, antialias: false, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setPixelRatio(1);
  renderer.autoClear = true;
  renderer.debug.checkShaderErrors = true;
  const shaderErrors = [];
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    shaderErrors.push({ program: gl.getProgramInfoLog(program), vertex: gl.getShaderInfoLog(vertex), fragment: gl.getShaderInfoLog(fragment) });
  };
  const triangle = createFullscreenTriangle(THREE);
  const capabilities = Object.freeze({
    webgl2: true,
    floatColorBuffer: true,
    maxTextureSize: context.getParameter(context.MAX_TEXTURE_SIZE),
    maxTextureUnits: context.getParameter(context.MAX_TEXTURE_IMAGE_UNITS),
    maxColorAttachments: context.getParameter(context.MAX_COLOR_ATTACHMENTS),
    timerQuery: Boolean(context.getExtension("EXT_disjoint_timer_query_webgl2")),
    hdrDisplayVerified: false,
    rendererRevision: THREE.REVISION,
    geometryCoverage: "opaque-rigid-foundation"
  });

  function createTarget(descriptor) {
    const format = descriptor.format === "r16f" || descriptor.format === "r32f" ? THREE.RedFormat : descriptor.format === "rg16f" ? THREE.RGFormat : THREE.RGBAFormat;
    const type = descriptor.format === "rgba8" ? THREE.UnsignedByteType : descriptor.format === "r32f" ? THREE.FloatType : THREE.HalfFloatType;
    const filter = descriptor.filter === "linear" ? THREE.LinearFilter : THREE.NearestFilter;
    const target = new THREE.WebGLRenderTarget(descriptor.width, descriptor.height, { format, type, minFilter: filter, magFilter: filter, depthBuffer: descriptor.depth === true, stencilBuffer: false, generateMipmaps: false });
    target.texture.colorSpace = THREE.LinearSRGBColorSpace;
    target.userData = { format: descriptor.format };
    if (descriptor.depth) {
      target.depthTexture = new THREE.DepthTexture(descriptor.width, descriptor.height, THREE.UnsignedIntType);
      target.depthTexture.format = THREE.DepthFormat;
      target.depthTexture.minFilter = THREE.NearestFilter;
      target.depthTexture.magFilter = THREE.NearestFilter;
    }
    return target;
  }

  function createMaterial(fragmentShader, uniforms = {}) {
    return new THREE.ShaderMaterial({ vertexShader: FULLSCREEN_VERTEX, fragmentShader, uniforms, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false });
  }

  function draw(material, target) {
    return withRendererState(THREE, renderer, () => {
      renderer.setRenderTarget(target);
      renderer.setScissorTest(false);
      renderer.setClearColor(0, 0);
      renderer.clear();
      triangle.render(renderer, material);
      if (shaderErrors.length) throw new Error(`Shader compilation failed: ${JSON.stringify(shaderErrors.at(-1))}`);
    });
  }

  function readTarget(target) {
    return withRendererState(THREE, renderer, () => {
      renderer.setRenderTarget(target);
      const isByte = target.userData.format === "rgba8";
      const pixels = isByte ? new Uint8Array(target.width * target.height * 4) : new Float32Array(target.width * target.height * 4);
      context.readBuffer(context.COLOR_ATTACHMENT0);
      context.readPixels(0, 0, target.width, target.height, context.RGBA, isByte ? context.UNSIGNED_BYTE : context.FLOAT, pixels);
      const error = context.getError();
      if (error !== context.NO_ERROR) throw new Error(`GPU readback failed with WebGL error ${error}`);
      return pixels;
    });
  }

  return Object.freeze({
    THREE,
    renderer,
    context,
    capabilities,
    createTarget,
    createMaterial,
    draw,
    readTarget,
    errors: () => [...shaderErrors],
    clearErrors: () => { shaderErrors.length = 0; },
    dispose() { triangle.dispose(); renderer.dispose(); }
  });
}
