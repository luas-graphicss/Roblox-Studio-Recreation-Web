import { selectSceneAntialiasingSamples } from "./sceneAntialiasingPolicy.js";

function readSupportedSamples(renderer) {
  if (!renderer.capabilities?.isWebGL2) return [];
  try {
    const context = renderer.getContext();
    if (context.isContextLost()) return [];
    if (!context.getExtension("EXT_color_buffer_float")) return [];
    const colorSamples = context.getInternalformatParameter(context.RENDERBUFFER, context.RGBA16F, context.SAMPLES);
    const depthSamples = context.getInternalformatParameter(context.RENDERBUFFER, context.DEPTH_COMPONENT24, context.SAMPLES);
    const depthSampleSet = new Set(depthSamples || []);
    return Array.from(colorSamples || []).filter(samples => samples >= 2 && depthSampleSet.has(samples) && samples <= renderer.capabilities.maxSamples);
  } catch {
    return [];
  }
}

export function createAntialiasedScenePass({ THREE, renderer, scene, camera, RenderPass, FullScreenQuad, requestRender }) {
  const pass = new RenderPass(scene, camera);
  const renderScene = pass.render.bind(pass);
  const disposeScene = pass.dispose.bind(pass);
  let supportedSamples = readSupportedSamples(renderer);
  let width = 1;
  let height = 1;
  let temporalEnabled = false;
  let target = null;
  let copyMaterial = null;
  let copyQuad = null;
  let disposed = false;

  function selectedSamples() {
    if (temporalEnabled) return 0;
    return selectSceneAntialiasingSamples({ supportedSamples, width, height });
  }

  function releaseTarget() {
    if (target) target.dispose();
    target = null;
    if (copyMaterial) copyMaterial.uniforms.tDiffuse.value = null;
  }

  function prepareTarget(samples) {
    if (target && target.samples !== samples) releaseTarget();
    if (!target) {
      target = new THREE.WebGLRenderTarget(width, height, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: false,
        depthBuffer: true,
        stencilBuffer: false,
        samples,
      });
      target.texture.name = "Viewport.SceneAntialiasing";
    }
    if (!copyMaterial) {
      copyMaterial = new THREE.ShaderMaterial({
        name: "SceneAntialiasingResolve",
        uniforms: { tDiffuse: { value: null } },
        vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
        fragmentShader: "uniform sampler2D tDiffuse; varying vec2 vUv; void main() { gl_FragColor = texture2D(tDiffuse, vUv); }",
        depthTest: false,
        depthWrite: false,
        blending: THREE.NoBlending,
        toneMapped: false,
      });
      copyQuad = new FullScreenQuad(copyMaterial);
    }
    copyMaterial.uniforms.tDiffuse.value = target.texture;
  }

  pass.setSize = (pixelWidth, pixelHeight) => {
    width = Math.max(1, Math.floor(pixelWidth));
    height = Math.max(1, Math.floor(pixelHeight));
    const samples = selectedSamples();
    if (target && target.samples !== samples) releaseTarget();
    if (target) target.setSize(width, height);
  };

  pass.setTemporalEnabled = enabled => {
    temporalEnabled = !!enabled;
    if (temporalEnabled) releaseTarget();
  };

  pass.getAntialiasingState = () => {
    const samples = selectedSamples();
    return {
      mode: temporalEnabled ? "temporal" : samples > 0 ? "msaa" : "spatial",
      samples,
      width,
      height,
      reason: temporalEnabled ? "temporal-enabled" : samples > 0 ? "supported-hdr-msaa" : supportedSamples.length ? "memory-budget" : "hdr-msaa-unavailable",
    };
  };

  pass.render = (activeRenderer, writeBuffer, readBuffer, deltaTime, maskActive) => {
    if (disposed) return;
    const samples = selectedSamples();
    if (!samples || pass.renderToScreen) {
      releaseTarget();
      renderScene(activeRenderer, writeBuffer, readBuffer, deltaTime, maskActive);
      return;
    }
    prepareTarget(samples);
    renderScene(activeRenderer, writeBuffer, target, deltaTime, maskActive);
    activeRenderer.setRenderTarget(readBuffer);
    copyQuad.render(activeRenderer);
  };

  function handleContextRestored() {
    if (disposed) return;
    releaseTarget();
    supportedSamples = readSupportedSamples(renderer);
    if (requestRender) requestRender();
  }

  renderer.domElement.addEventListener("webglcontextrestored", handleContextRestored);

  pass.dispose = () => {
    if (disposed) return;
    disposed = true;
    renderer.domElement.removeEventListener("webglcontextrestored", handleContextRestored);
    releaseTarget();
    if (copyMaterial) copyMaterial.dispose();
    if (copyQuad) copyQuad.dispose();
    copyMaterial = null;
    copyQuad = null;
    disposeScene();
  };

  return pass;
}
