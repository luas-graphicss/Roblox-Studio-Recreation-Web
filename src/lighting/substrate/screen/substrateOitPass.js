import { withSubstratePeelOrder } from './substratePeelOrder.js';
import { SUBSTRATE_SCREEN_VERTEX } from './substrateScreenQuad.js';
import { withSubstrateMaterialSelection } from './substrateScreenState.js';

export function createSubstrateOitPass({ THREE, renderer, scene, targets, captures, quad, drawScene }) {
  const uniforms = {
    uSbPeelOpaqueDepth: { value: null }, uSbPeelPreviousRank: { value: null },
    uSbPeelInverseSize: { value: new THREE.Vector2(1, 1) }, uSbPeelLayer: { value: 0 },
  };
  let multiply = null;
  let addition = null;
  let output = null;
  let frames = 0;
  let overflowTexture = null;
  function initialize() {
    if (multiply) return;
    const common = { vertexShader: SUBSTRATE_SCREEN_VERTEX, depthTest: false, depthWrite: false, toneMapped: false };
    const layerUniforms = { uSbLayerColor: { value: null }, uSbLayerTransmission: { value: null } };
    multiply = new THREE.ShaderMaterial({ ...common, name: 'Substrate OIT colored throughput', uniforms: layerUniforms,
      transparent: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor, blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.SrcAlphaFactor,
      fragmentShader: `varying vec2 vSbScreenUv; uniform sampler2D uSbLayerColor; uniform sampler2D uSbLayerTransmission;
void main() { vec4 color = texture2D(uSbLayerColor, vSbScreenUv); gl_FragColor = color.a > 0.0 ? texture2D(uSbLayerTransmission, vSbScreenUv) : vec4(1.0); }` });
    addition = new THREE.ShaderMaterial({ ...common, name: 'Substrate OIT premultiplied radiance', uniforms: layerUniforms,
      transparent: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
      fragmentShader: `varying vec2 vSbScreenUv; uniform sampler2D uSbLayerColor;
void main() { gl_FragColor = texture2D(uSbLayerColor, vSbScreenUv); }` });
    output = new THREE.ShaderMaterial({ ...common, name: 'Substrate OIT output', toneMapped: true, depthWrite: true, depthTest: true, depthFunc: THREE.AlwaysDepth,
      uniforms: { uSbComposite: { value: null }, uSbFallback: { value: null }, uSbOverflow: { value: null }, uSbDepth: { value: null } },
      fragmentShader: `varying vec2 vSbScreenUv;
uniform sampler2D uSbComposite; uniform sampler2D uSbFallback; uniform sampler2D uSbOverflow; uniform sampler2D uSbDepth;
void main() {
 vec4 composite = texture2D(uSbComposite, vSbScreenUv);
 vec4 fallbackColor = texture2D(uSbFallback, vSbScreenUv);
 float overflow = step(0.000001, texture2D(uSbOverflow, vSbScreenUv).a);
 gl_FragColor = mix(composite, fallbackColor, overflow);
 gl_FragDepth = texture2D(uSbDepth, vSbScreenUv).r;
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}` });
  }
  function transmissionUniforms(material) {
    const authored = material.userData.sbOitTransmission;
    const color = authored?.color ?? [1, 1, 1];
    const thickness = authored?.thickness ?? 1;
    if (!Array.isArray(color) || color.length !== 3 || color.some(value => !Number.isFinite(value) || value < 0 || value > 1) || !Number.isFinite(thickness) || thickness < 0) throw new Error('Invalid OIT transmission authoring');
    return { ...uniforms, uSbPeelTransmission: { value: color }, uSbPeelThickness: { value: thickness } };
  }
  function render(camera, plan, transparentMaterials, destination, viewport) {
    initialize();
    const opaque = targets.acquire('oit opaque', plan.width, plan.height, { depth: true });
    const fallback = targets.acquire('oit native fallback', plan.width, plan.height, { depth: true });
    const peelTargets = [0, 1].map(index => targets.acquire('oit peel ' + index, plan.width, plan.height, { attachments: 3, depth: true, floatAttachments: [2] }));
    renderer.state.buffers.depth.setClear(1);
    renderer.setRenderTarget(fallback);
    renderer.clear(true, true, false);
    drawScene(scene, camera);
    renderer.setRenderTarget(opaque);
    renderer.clear(true, true, false);
    withSubstrateMaterialSelection(scene, (object, material) => transparentMaterials.has(material) ? captures.hidden : material, () => drawScene(scene, camera));
    const background = scene.background;
    scene.background = null;
    renderer.setClearColor(0, 0);
    uniforms.uSbPeelOpaqueDepth.value = opaque.depthTexture;
    uniforms.uSbPeelInverseSize.value.set(1 / plan.width, 1 / plan.height);
    let previous = opaque;
    for (let layer = 0; layer <= plan.peelLayers; layer++) {
      const peel = peelTargets[layer % 2];
      uniforms.uSbPeelPreviousRank.value = layer ? previous.texture[2] : opaque.texture;
      uniforms.uSbPeelLayer.value = layer;
      renderer.setRenderTarget(peel);
      renderer.state.buffers.depth.setClear(0);
      renderer.clear(true, true, false);
      withSubstratePeelOrder(scene, captures, () => withSubstrateMaterialSelection(scene, (object, material) => transparentMaterials.has(material) ? captures.acquire(object, material, 'peel', transmissionUniforms(material)) : captures.hidden, () => drawScene(scene, camera)));
      if (layer < plan.peelLayers) {
        multiply.uniforms.uSbLayerColor.value = peel.texture[0];
        multiply.uniforms.uSbLayerTransmission.value = peel.texture[1];
        quad.draw(multiply, opaque);
        quad.draw(addition, opaque);
      } else overflowTexture = peel.texture[0];
      previous = peel;
    }
    scene.background = background;
    output.uniforms.uSbComposite.value = opaque.texture;
    output.uniforms.uSbFallback.value = fallback.texture;
    output.uniforms.uSbOverflow.value = overflowTexture;
    output.uniforms.uSbDepth.value = opaque.depthTexture;
    renderer.state.buffers.depth.setClear(1);
    quad.draw(output, destination, viewport);
    frames++;
  }
  function reset() { multiply?.dispose(); addition?.dispose(); output?.dispose(); multiply = null; addition = null; output = null; overflowTexture = null; }
  return { render, reset, dispose: reset, overflow: () => overflowTexture,
    snapshot: () => ({ frames, mode: 'bounded-back-to-front-depth-peeling', overflow: 'native-alpha-per-pixel', overflowDetection: 'extra-raster-layer', physicalGpuCertified: false }) };
}
