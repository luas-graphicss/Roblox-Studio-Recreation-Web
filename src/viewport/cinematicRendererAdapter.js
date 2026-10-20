import { createFullscreenTriangle, FULLSCREEN_VERTEX } from "../postprocess/cinematic/render/fullscreenTriangle.js";
import { withRendererState } from "../postprocess/cinematic/render/rendererState.js";

const MAX_SHADER_ERRORS = 8;

export function createCinematicRendererAdapter({ THREE, renderer, scene, camera }) {
  const context = renderer.getContext();
  const webgl2 = typeof WebGL2RenderingContext !== "undefined" && context instanceof WebGL2RenderingContext;
  const floatColorBuffer = webgl2 && Boolean(context.getExtension("EXT_color_buffer_float"));
  const triangle = createFullscreenTriangle(THREE);
  const shaderErrors = [];
  const debug = renderer.debug || null;
  const previousShaderError = debug ? debug.onShaderError : null;
  if (debug) {
    debug.onShaderError = (gl, program, vertex, fragment) => {
      shaderErrors.push({
        program: gl.getProgramInfoLog(program),
        vertex: gl.getShaderInfoLog(vertex),
        fragment: gl.getShaderInfoLog(fragment),
      });
      if (shaderErrors.length > MAX_SHADER_ERRORS) shaderErrors.shift();
      if (typeof previousShaderError === "function") previousShaderError(gl, program, vertex, fragment);
    };
  }

  const capabilities = Object.freeze({
    webgl2,
    floatColorBuffer,
    maxTextureSize: context.getParameter(context.MAX_TEXTURE_SIZE),
    maxTextureUnits: context.getParameter(context.MAX_TEXTURE_IMAGE_UNITS),
    maxColorAttachments: webgl2 ? context.getParameter(context.MAX_COLOR_ATTACHMENTS) : 1,
    timerQuery: webgl2 && Boolean(context.getExtension("EXT_disjoint_timer_query_webgl2")),
    hdrDisplayVerified: false,
    rendererRevision: THREE.REVISION,
    geometryCoverage: "engine-scene",
  });

  function createTarget(descriptor) {
    const format = descriptor.format === "r16f" || descriptor.format === "r32f"
      ? THREE.RedFormat
      : descriptor.format === "rg16f" ? THREE.RGFormat : THREE.RGBAFormat;
    const type = descriptor.format === "rgba8"
      ? THREE.UnsignedByteType
      : descriptor.format === "r32f" ? THREE.FloatType : THREE.HalfFloatType;
    const filter = descriptor.filter === "linear" ? THREE.LinearFilter : THREE.NearestFilter;
    const target = new THREE.WebGLRenderTarget(descriptor.width, descriptor.height, {
      format,
      type,
      minFilter: filter,
      magFilter: filter,
      depthBuffer: descriptor.depth === true,
      stencilBuffer: false,
      generateMipmaps: false,
    });
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
    return new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      toneMapped: false,
    });
  }

  function draw(material, target) {
    return withRendererState(THREE, renderer, () => {
      const before = shaderErrors.length;
      renderer.setRenderTarget(target);
      renderer.setScissorTest(false);
      if (target) renderer.setViewport(0, 0, target.width, target.height);
      renderer.setClearColor(0, 0);
      renderer.clear();
      triangle.render(renderer, material);
      if (shaderErrors.length > before) {
        throw new Error(`Shader compilation failed: ${JSON.stringify(shaderErrors.at(-1))}`);
      }
    });
  }

  function readTarget(target) {
    return withRendererState(THREE, renderer, () => {
      renderer.setRenderTarget(target);
      const isByte = target.userData.format === "rgba8";
      const pixels = isByte
        ? new Uint8Array(target.width * target.height * 4)
        : new Float32Array(target.width * target.height * 4);
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
    host: Object.freeze({ scene, camera }),
    createTarget,
    createMaterial,
    draw,
    readTarget,
    errors: () => [...shaderErrors],
    clearErrors: () => { shaderErrors.length = 0; },
    dispose() {
      triangle.dispose();
      if (debug) debug.onShaderError = previousShaderError;
    },
  });
}
