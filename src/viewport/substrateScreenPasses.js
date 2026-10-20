import { buildSeparableKernel } from "../lighting/substrate/sbDiffusionProfileCore.js";
import { maximumMeanFreePathMillimeters } from "../lighting/substrate/sbSubsurfaceMfpCore.js";
import { RUNTIME_SCREEN_UNIFORMS } from "../lighting/substrate/sbRuntimeClosureShader.js";

const ISOLATION_LAYER = 31;
const KERNEL_TAPS = 9;
const MAXIMUM_MFP = maximumMeanFreePathMillimeters() > 0 ? maximumMeanFreePathMillimeters() : 64;
const MILLIMETERS_PER_WORLD_UNIT = 1000;
const FLAGS = Object.freeze({ subsurface: "SubstrateSubsurface", translucency: "SubstrateOrderedTranslucency", decal: "SubstrateDecalBuffer", water: "SubstrateSingleLayerWater" });

const COPY_VERTEX = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const MASK_VERTEX = `#include <common>
#include <skinning_pars_vertex>
#include <morphtarget_pars_vertex>
void main() {
 #include <skinbase_vertex>
 #include <begin_vertex>
 #include <morphtarget_vertex>
 #include <skinning_vertex>
 #include <project_vertex>
}`;

const MASK_FRAGMENT = `uniform vec3 uSbMaskMfp;
void main() { gl_FragColor = vec4(uSbMaskMfp / ${MAXIMUM_MFP.toFixed(1)}, 1.0); }`;

function kernelOffsets() {
  const kernel = buildSeparableKernel({ meanFreePathMillimeters: 1, sampleCount: KERNEL_TAPS });
  const offsets = new Float32Array(KERNEL_TAPS);
  for (let index = 0; index < KERNEL_TAPS; index += 1) offsets[index] = kernel.offsetsMillimeters[index] ?? 0;
  return offsets;
}

const BLUR_FRAGMENT = `#include <packing>
uniform sampler2D tDiffuse;
uniform sampler2D tMask;
uniform sampler2D tDepth;
uniform vec2 uDirection;
uniform vec2 uTexel;
uniform float uNear;
uniform float uFar;
uniform float uOrthographic;
uniform float uProjectionScale;
uniform float uMillimetersPerWorldUnit;
uniform float uOffsets[${KERNEL_TAPS}];
varying vec2 vUv;
float sbViewDepth(vec2 uv) {
 float depth = unpackRGBAToDepth(texture2D(tDepth, uv));
 return uOrthographic > 0.5 ? -orthographicDepthToViewZ(depth, uNear, uFar) : -perspectiveDepthToViewZ(depth, uNear, uFar);
}
void main() {
 vec4 scene = texture2D(tDiffuse, vUv);
 vec4 mask = texture2D(tMask, vUv);
 if (mask.a < 0.5) { gl_FragColor = scene; return; }
 vec3 mfp = mask.rgb * ${MAXIMUM_MFP.toFixed(1)};
 float depth = max(sbViewDepth(vUv), 1e-4);
 float scale = uOrthographic > 0.5 ? uProjectionScale : uProjectionScale / depth;
 vec3 radiusPixels = (mfp / uMillimetersPerWorldUnit) * scale;
 vec3 sum = vec3(0.0);
 for (int tap = 0; tap < ${KERNEL_TAPS}; tap++) {
  for (int sign = 0; sign < 2; sign++) {
   float direction = sign == 0 ? 1.0 : -1.0;
   for (int channel = 0; channel < 3; channel++) {
    vec2 offset = uDirection * uTexel * direction * uOffsets[tap] * radiusPixels[channel];
    vec2 uv = clamp(vUv + offset, vec2(0.0), vec2(1.0));
    vec4 neighborMask = texture2D(tMask, uv);
    float neighborDepth = sbViewDepth(uv);
    float tolerance = max(mfp[channel] / uMillimetersPerWorldUnit, 1e-3) * 2.0;
    bool continuous = neighborMask.a > 0.5 && abs(neighborDepth - depth) < tolerance;
    float value = continuous ? texture2D(tDiffuse, uv)[channel] : scene[channel];
    sum[channel] += value;
   }
  }
 }
 vec3 blurred = sum / float(${KERNEL_TAPS} * 2);
 vec3 strength = clamp(mfp / ${MAXIMUM_MFP.toFixed(1)} * 8.0, 0.0, 1.0);
 gl_FragColor = vec4(mix(scene.rgb, blurred, strength), scene.a);
}`;

const COPY_FRAGMENT = `uniform sampler2D tDiffuse;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(tDiffuse, vUv); }`;

const OIT_RESOLVE_FRAGMENT = `uniform sampler2D tDiffuse;
uniform sampler2D tAccumulation;
varying vec2 vUv;
void main() {
 vec4 scene = texture2D(tDiffuse, vUv);
 vec4 accumulation = texture2D(tAccumulation, vUv);
 float weightSum = max(accumulation.a, 1e-5);
 vec3 averageColor = accumulation.rgb / weightSum;
 float coverage = clamp(1.0 - exp(-accumulation.a), 0.0, 1.0);
 gl_FragColor = vec4(mix(scene.rgb, averageColor, coverage), scene.a);
}`;

export function createSubstrateScreenPasses({ THREE, renderer, scene, camera, sharedDepth, getSubstrateScreen, FullScreenQuad }) {
  if (!sharedDepth) throw new Error("createSubstrateScreenPasses: sharedDepth é obrigatório");
  const quad = new FullScreenQuad(null);
  const hidden = [];
  const lights = [];
  const isolated = [];
  const maskMaterials = new Map();
  const savedBlend = new Map();
  const savedColor = new THREE.Color();
  let maskTarget = null;
  let blurTarget = null;
  let accumulationTarget = null;
  let decalTarget = null;
  let decalNormalTarget = null;
  let waterTarget = null;
  const decalNormalMaterial = new THREE.MeshNormalMaterial({ blending: THREE.NoBlending });
  const copyMaterial = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: COPY_VERTEX, fragmentShader: COPY_FRAGMENT, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
  });
  const blurMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null }, tMask: { value: null }, tDepth: { value: null },
      uDirection: { value: new THREE.Vector2(1, 0) }, uTexel: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.1 }, uFar: { value: 1000 }, uOrthographic: { value: 0 }, uProjectionScale: { value: 1 },
      uMillimetersPerWorldUnit: { value: MILLIMETERS_PER_WORLD_UNIT }, uOffsets: { value: kernelOffsets() },
    },
    vertexShader: COPY_VERTEX, fragmentShader: BLUR_FRAGMENT, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
  });
  const resolveMaterial = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, tAccumulation: { value: null } },
    vertexShader: COPY_VERTEX, fragmentShader: OIT_RESOLVE_FRAGMENT, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
  });

  function screenSurface() {
    const screen = typeof getSubstrateScreen === "function" ? getSubstrateScreen() : null;
    return screen && screen.active() ? screen : null;
  }

  function ensureTarget(current, width, height, options, depthTexture) {
    if (current && current.width === width && current.height === height && current.depthTexture === depthTexture) return current;
    if (current) current.dispose();
    const target = new THREE.WebGLRenderTarget(width, height, options);
    if (depthTexture) target.depthTexture = depthTexture;
    return target;
  }

  function acquireSharedDepth(activeRenderer, width, height) {
    sharedDepth.requestDepthTexture();
    const packed = sharedDepth.acquire(activeRenderer, width, height);
    const depthTexture = sharedDepth.depthTexture();
    const size = sharedDepth.targetSize();
    return { packed, depthTexture, width: Math.max(1, size.width || width), height: Math.max(1, size.height || height) };
  }

  function collect(predicate) {
    const meshes = [];
    lights.length = 0;
    scene.traverse((object) => {
      if (object.isLight) lights.push(object);
      if (!object.visible || !object.isMesh || !object.material) return;
      if (predicate(object)) meshes.push(object);
    });
    return meshes;
  }

  function materialMatches(material, set) {
    if (Array.isArray(material)) return material.some((entry) => set.has(entry));
    return set.has(material);
  }

  function withIsolation(activeRenderer, meshes, includeLights, target, callback, overrideMaterial = null, clearColor = true) {
    const savedLayers = camera.layers.mask;
    const savedTarget = activeRenderer.getRenderTarget();
    const savedAutoClear = activeRenderer.autoClear;
    const savedShadow = activeRenderer.shadowMap.autoUpdate;
    const savedBackground = scene.background;
    const savedOverride = scene.overrideMaterial;
    activeRenderer.getClearColor(savedColor);
    const savedAlpha = activeRenderer.getClearAlpha();
    isolated.length = 0;
    for (const mesh of meshes) { mesh.layers.enable(ISOLATION_LAYER); isolated.push(mesh); }
    if (includeLights) for (const light of lights) { light.layers.enable(ISOLATION_LAYER); isolated.push(light); }
    try {
      camera.layers.set(ISOLATION_LAYER);
      scene.background = null;
      scene.overrideMaterial = overrideMaterial;
      activeRenderer.shadowMap.autoUpdate = false;
      activeRenderer.autoClear = false;
      activeRenderer.setRenderTarget(target);
      activeRenderer.setClearColor(0x000000, 0);
      if (clearColor) activeRenderer.clear(true, false, false);
      callback();
    } finally {
      for (const object of isolated) object.layers.disable(ISOLATION_LAYER);
      isolated.length = 0;
      camera.layers.mask = savedLayers;
      scene.background = savedBackground;
      scene.overrideMaterial = savedOverride;
      activeRenderer.shadowMap.autoUpdate = savedShadow;
      activeRenderer.autoClear = savedAutoClear;
      activeRenderer.setClearColor(savedColor, savedAlpha);
      activeRenderer.setRenderTarget(savedTarget);
    }
  }

  function drawQuad(activeRenderer, material, target) {
    quad.material = material;
    activeRenderer.setRenderTarget(target);
    quad.render(activeRenderer);
  }

  function restoreHidden() {
    for (const object of hidden) object.visible = true;
    hidden.length = 0;
  }

  function hide(meshes) {
    for (const mesh of meshes) { mesh.visible = false; hidden.push(mesh); }
  }

  function maskMaterialFor(mfp) {
    const key = mfp.map((value) => Number(value).toFixed(3)).join(",");
    let material = maskMaterials.get(key);
    if (!material) {
      material = new THREE.ShaderMaterial({
        uniforms: { uSbMaskMfp: { value: new THREE.Vector3(mfp[0], mfp[1], mfp[2]) } },
        vertexShader: MASK_VERTEX, fragmentShader: MASK_FRAGMENT, depthTest: true, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
      });
      maskMaterials.set(key, material);
    }
    return material;
  }

  const preparePass = {
    enabled: true, needsSwap: false, clear: false, renderToScreen: false,
    setSize() {},
    render(activeRenderer, writeBuffer, readBuffer) {
      restoreHidden();
      const screen = screenSurface();
      if (!screen) { return; }
      sharedDepth.requestDepthTexture();
      const translucent = new Set(screen.flag(FLAGS.translucency) ? screen.translucentHosts() : []);
      const water = new Set(screen.flag(FLAGS.water) ? screen.waterHosts() : []);
      const decalWanted = screen.flag(FLAGS.decal);
      const pools = [];
      const oitMeshes = [];
      const waterMeshes = [];
      collect((mesh) => {
        if (decalWanted && mesh.userData && mesh.userData.__rswDecalPool) pools.push(mesh);
        if (translucent.size && materialMatches(mesh.material, translucent)) oitMeshes.push(mesh);
        else if (water.size && materialMatches(mesh.material, water)) waterMeshes.push(mesh);
        return false;
      });
      if (pools.length) {
        const depth = acquireSharedDepth(activeRenderer, readBuffer.width, readBuffer.height);
        decalTarget = ensureTarget(decalTarget, depth.width, depth.height, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, stencilBuffer: false, generateMipmaps: false }, depth.depthTexture);
        withIsolation(activeRenderer, pools, false, decalTarget, () => activeRenderer.render(scene, camera));
        decalNormalTarget = ensureTarget(decalNormalTarget, depth.width, depth.height, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, stencilBuffer: false, generateMipmaps: false }, depth.depthTexture);
        withIsolation(activeRenderer, pools, false, decalNormalTarget, () => activeRenderer.render(scene, camera), decalNormalMaterial);
        screen.setUniform(RUNTIME_SCREEN_UNIFORMS.dbuffer, decalTarget.texture);
        screen.setUniform(RUNTIME_SCREEN_UNIFORMS.dbufferNormal, decalNormalTarget.texture);
        screen.setUniform(RUNTIME_SCREEN_UNIFORMS.dbufferSize, [depth.width, depth.height]);
        screen.setUniform(RUNTIME_SCREEN_UNIFORMS.dbufferOn, 1);
        screen.reportEvidence("dbuffer", { pools: pools.length, width: depth.width, height: depth.height, channels: ["color", "roughness", "normal"] });
        hide(pools);
      } else {
        screen.setUniform(RUNTIME_SCREEN_UNIFORMS.dbufferOn, 0);
      }
      if (oitMeshes.length) hide(oitMeshes);
      if (waterMeshes.length) hide(waterMeshes);
    },
    dispose() { restoreHidden(); if (decalTarget) decalTarget.dispose(); decalTarget = null; if (decalNormalTarget) decalNormalTarget.dispose(); decalNormalTarget = null; },
  };

  const waterPass = {
    enabled: true, needsSwap: false, clear: false, renderToScreen: false,
    setSize() {},
    render(activeRenderer, writeBuffer, readBuffer) {
      this.needsSwap = false;
      const screen = screenSurface();
      if (!screen || !screen.flag(FLAGS.water)) return;
      const hosts = new Set(screen.waterHosts());
      if (!hosts.size) return;
      const meshes = hidden.filter((mesh) => materialMatches(mesh.material, hosts));
      if (!meshes.length) return;
      const depth = acquireSharedDepth(activeRenderer, readBuffer.width, readBuffer.height);
      waterTarget = ensureTarget(waterTarget, readBuffer.width, readBuffer.height, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type: readBuffer.texture.type, format: readBuffer.texture.format, depthBuffer: true, stencilBuffer: false, generateMipmaps: false }, depth.depthTexture);
      savedBlend.clear();
      for (const material of hosts) {
        savedBlend.set(material, { depthWrite: material.depthWrite, transparent: material.transparent });
        material.depthWrite = false;
      }
      for (const mesh of meshes) mesh.visible = true;
      screen.setUniform(RUNTIME_SCREEN_UNIFORMS.sceneColor, readBuffer.texture);
      screen.setUniform(RUNTIME_SCREEN_UNIFORMS.sceneDepth, depth.packed);
      screen.setUniform(RUNTIME_SCREEN_UNIFORMS.sceneSize, [readBuffer.width, readBuffer.height]);
      screen.setUniform(RUNTIME_SCREEN_UNIFORMS.sceneParams, [camera.near, camera.far, camera.isOrthographicCamera ? 1 : 0, 1]);
      copyMaterial.uniforms.tDiffuse.value = readBuffer.texture;
      try {
        withIsolation(activeRenderer, meshes, true, waterTarget, () => {
          quad.material = copyMaterial;
          quad.render(activeRenderer);
          activeRenderer.render(scene, camera);
        }, null, false);
      } finally {
        screen.setUniform(RUNTIME_SCREEN_UNIFORMS.sceneParams, [camera.near, camera.far, camera.isOrthographicCamera ? 1 : 0, 0]);
        for (const mesh of meshes) mesh.visible = false;
        for (const [material, saved] of savedBlend) Object.assign(material, saved);
        savedBlend.clear();
      }
      copyMaterial.uniforms.tDiffuse.value = waterTarget.texture;
      drawQuad(activeRenderer, copyMaterial, this.renderToScreen ? null : writeBuffer);
      this.needsSwap = true;
      screen.reportEvidence("water", { materials: hosts.size, meshes: meshes.length, sceneDepth: true, sceneRefraction: true, width: depth.width, height: depth.height });
    },
    dispose() { if (waterTarget) waterTarget.dispose(); waterTarget = null; },
  };

  const restorePass = {
    enabled: true, needsSwap: false, clear: false, renderToScreen: false,
    setSize() {},
    render() { restoreHidden(); },
    dispose() { restoreHidden(); },
  };

  const subsurfacePass = {
    enabled: true, needsSwap: false, clear: false, renderToScreen: false,
    setSize() {},
    render(activeRenderer, writeBuffer, readBuffer) {
      this.needsSwap = false;
      const screen = screenSurface();
      if (!screen || !screen.flag(FLAGS.subsurface)) return;
      const hosts = screen.subsurfaceHosts();
      if (!hosts.length) return;
      const mfpByMaterial = new Map(hosts.map((host) => [host.material, host.meanFreePathMillimeters]));
      const meshes = collect((mesh) => materialMatches(mesh.material, mfpByMaterial));
      if (!meshes.length) return;
      const depth = acquireSharedDepth(activeRenderer, readBuffer.width, readBuffer.height);
      maskTarget = ensureTarget(maskTarget, depth.width, depth.height, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, stencilBuffer: false, generateMipmaps: false }, depth.depthTexture);
      const swapped = [];
      for (const mesh of meshes) {
        const original = mesh.material;
        const replacement = Array.isArray(original)
          ? original.map((material) => (mfpByMaterial.has(material) ? maskMaterialFor(mfpByMaterial.get(material)) : null)).map((material) => material || maskMaterialFor([0, 0, 0]))
          : maskMaterialFor(mfpByMaterial.get(original));
        swapped.push([mesh, original]);
        mesh.material = replacement;
      }
      try {
        withIsolation(activeRenderer, meshes, false, maskTarget, () => activeRenderer.render(scene, camera));
      } finally {
        for (const [mesh, original] of swapped) mesh.material = original;
      }
      blurTarget = ensureTarget(blurTarget, readBuffer.width, readBuffer.height, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type: readBuffer.texture.type, format: readBuffer.texture.format, depthBuffer: false, stencilBuffer: false, generateMipmaps: false }, null);
      const uniforms = blurMaterial.uniforms;
      uniforms.tMask.value = maskTarget.texture;
      uniforms.tDepth.value = depth.packed;
      uniforms.uTexel.value.set(1 / readBuffer.width, 1 / readBuffer.height);
      uniforms.uNear.value = camera.near;
      uniforms.uFar.value = camera.far;
      uniforms.uOrthographic.value = camera.isOrthographicCamera ? 1 : 0;
      uniforms.uProjectionScale.value = camera.projectionMatrix.elements[5] * 0.5 * readBuffer.height;
      uniforms.tDiffuse.value = readBuffer.texture;
      uniforms.uDirection.value.set(1, 0);
      drawQuad(activeRenderer, blurMaterial, blurTarget);
      uniforms.tDiffuse.value = blurTarget.texture;
      uniforms.uDirection.value.set(0, 1);
      drawQuad(activeRenderer, blurMaterial, this.renderToScreen ? null : writeBuffer);
      this.needsSwap = true;
      screen.reportEvidence("subsurface", { hosts: hosts.length, meshes: meshes.length, taps: KERNEL_TAPS * 2, width: depth.width, height: depth.height });
    },
    dispose() {
      if (maskTarget) maskTarget.dispose();
      if (blurTarget) blurTarget.dispose();
      maskTarget = null; blurTarget = null;
      for (const material of maskMaterials.values()) material.dispose();
      maskMaterials.clear();
    },
  };

  const oitPass = {
    enabled: true, needsSwap: false, clear: false, renderToScreen: false,
    setSize() {},
    render(activeRenderer, writeBuffer, readBuffer) {
      this.needsSwap = false;
      const screen = screenSurface();
      if (!screen || !screen.flag(FLAGS.translucency)) return;
      const hosts = new Set(screen.translucentHosts());
      if (!hosts.size) return;
      const meshes = collect((mesh) => materialMatches(mesh.material, hosts));
      const visibleMeshes = meshes.length ? meshes : hidden.filter((mesh) => materialMatches(mesh.material, hosts));
      if (!visibleMeshes.length) return;
      const depth = acquireSharedDepth(activeRenderer, readBuffer.width, readBuffer.height);
      accumulationTarget = ensureTarget(accumulationTarget, depth.width, depth.height, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, stencilBuffer: false, generateMipmaps: false }, depth.depthTexture);
      savedBlend.clear();
      for (const material of hosts) {
        savedBlend.set(material, { blending: material.blending, blendEquation: material.blendEquation, blendSrc: material.blendSrc, blendDst: material.blendDst, blendEquationAlpha: material.blendEquationAlpha, blendSrcAlpha: material.blendSrcAlpha, blendDstAlpha: material.blendDstAlpha, depthWrite: material.depthWrite });
        material.blending = THREE.CustomBlending;
        material.blendEquation = THREE.AddEquation;
        material.blendSrc = THREE.OneFactor;
        material.blendDst = THREE.OneFactor;
        material.blendEquationAlpha = THREE.AddEquation;
        material.blendSrcAlpha = THREE.OneFactor;
        material.blendDstAlpha = THREE.OneFactor;
        material.depthWrite = false;
      }
      const wasHidden = visibleMeshes.filter((mesh) => !mesh.visible);
      for (const mesh of wasHidden) mesh.visible = true;
      screen.setUniform(RUNTIME_SCREEN_UNIFORMS.oitAccumulate, 1);
      try {
        withIsolation(activeRenderer, visibleMeshes, true, accumulationTarget, () => activeRenderer.render(scene, camera));
      } finally {
        screen.setUniform(RUNTIME_SCREEN_UNIFORMS.oitAccumulate, 0);
        for (const mesh of wasHidden) mesh.visible = false;
        for (const [material, saved] of savedBlend) Object.assign(material, saved);
        savedBlend.clear();
      }
      resolveMaterial.uniforms.tDiffuse.value = readBuffer.texture;
      resolveMaterial.uniforms.tAccumulation.value = accumulationTarget.texture;
      drawQuad(activeRenderer, resolveMaterial, this.renderToScreen ? null : writeBuffer);
      this.needsSwap = true;
      screen.reportEvidence("oit", { materials: hosts.size, meshes: visibleMeshes.length, mode: "weightedBlended", width: depth.width, height: depth.height });
    },
    dispose() { if (accumulationTarget) accumulationTarget.dispose(); accumulationTarget = null; },
  };

  return {
    preparePass, restorePass, waterPass, subsurfacePass, oitPass,
    dispose() {
      preparePass.dispose(); restorePass.dispose(); waterPass.dispose(); subsurfacePass.dispose(); oitPass.dispose();
      blurMaterial.dispose(); resolveMaterial.dispose(); copyMaterial.dispose(); decalNormalMaterial.dispose(); quad.dispose();
    },
  };
}
