import {
  FAR_HF_DIM,
  FAR_SDF_DIM,
  buildHeightfieldFromBoxes,
  buildSdfFromBoxes,
  buildFarShadowGlsl,
  buildFarVertexMain,
  farLiteProfile,
  parseLightsBeginAnchor,
  patchLightsBeginChunk,
} from "../lighting/farShadowCore.js";
import { parseGetShadowSignature } from "../lighting/pcssCore.js";

const ANCHOR_LIGHTS = "#include <lights_fragment_begin>";
const ANCHOR_WORLDPOS = "#include <worldpos_vertex>";

export function createFarShadows({ THREE, renderer, weakGpu }) {
  const caps = renderer && renderer.capabilities ? renderer.capabilities : null;
  const sdfCapable = !!(THREE && THREE.Data3DTexture && caps && caps.isWebGL2 !== false);


  const prof = farLiteProfile({ weak: weakGpu === true, sdfCapable });
  const sdfOn = prof.withSdf;                                                  
  const shadowChunk =
    THREE && THREE.ShaderChunk ? THREE.ShaderChunk.shadowmap_pars_fragment : null;
  const lightsChunk =
    THREE && THREE.ShaderChunk ? THREE.ShaderChunk.lights_fragment_begin : null;
  const sig = parseGetShadowSignature(shadowChunk);
  const anchor = parseLightsBeginAnchor(lightsChunk);


  const supported = !!(
    sig.ok &&
    sig.samplerType === "sampler2D" &&
    !sig.hasIntensity &&
    anchor.ok &&
    THREE &&
    THREE.DataTexture
  );

  let hfTex = null;
  let hfData = null;
  let sdfTex = null;
  let sdfData = null;
  if (supported) {
    hfData = new Uint8Array(FAR_HF_DIM * FAR_HF_DIM * 4);
    hfTex = new THREE.DataTexture(hfData, FAR_HF_DIM, FAR_HF_DIM);
    hfTex.format = THREE.RGBAFormat;
    hfTex.type = THREE.UnsignedByteType;
    hfTex.minFilter = THREE.LinearFilter;
    hfTex.magFilter = THREE.LinearFilter;
    hfTex.wrapS = THREE.ClampToEdgeWrapping;
    hfTex.wrapT = THREE.ClampToEdgeWrapping;
    hfTex.generateMipmaps = false;
    hfTex.flipY = false;
    hfTex.unpackAlignment = 1;
    hfTex.needsUpdate = true;
    if (sdfOn) {
      sdfData = new Uint8Array(FAR_SDF_DIM * FAR_SDF_DIM * FAR_SDF_DIM * 4);
      sdfTex = new THREE.Data3DTexture(sdfData, FAR_SDF_DIM, FAR_SDF_DIM, FAR_SDF_DIM);
      sdfTex.format = THREE.RGBAFormat;
      sdfTex.type = THREE.UnsignedByteType;
      sdfTex.minFilter = THREE.LinearFilter;
      sdfTex.magFilter = THREE.LinearFilter;
      sdfTex.generateMipmaps = false;
      sdfTex.unpackAlignment = 1;
      sdfTex.needsUpdate = true;
    }
  }


  const uniforms = {
    uRswFarOn: { value: 0 },
    uRswFarHfOn: { value: 0 },
    uRswFarSdfOn: { value: 0 },
    uRswFarSunDir: { value: supported ? new THREE.Vector3(0, 1, 0) : null },
    uRswFarWinCenter: { value: supported ? new THREE.Vector3(0, 0, 0) : null },
    uRswFarWinHalf: { value: 0 },
    uRswFarDist: { value: 8192 },
    uRswFarSoft: { value: 30 },                                                  
    uRswFarHfTex: { value: hfTex },
    uRswFarHfMin: { value: supported ? new THREE.Vector3(0, 0, 0) : null },
    uRswFarHfInv: { value: supported ? new THREE.Vector3(1, 1, 1) : null },
    uRswFarSdfTex: { value: sdfTex },
    uRswFarSdfMin: { value: supported ? new THREE.Vector3(0, 0, 0) : null },
    uRswFarSdfInvSpan: { value: 1 },
    uRswFarSdfCell: { value: 1 },
  };

  let patchGen = 0;
  let enabled = false;
  let disposed = false;


  let lastHf = null;

  const fragPars = supported
    ? buildFarShadowGlsl({ withSdf: sdfOn, steps: prof.steps, dither: prof.dither })
    : "";
  const patchedLights = supported ? patchLightsBeginChunk(lightsChunk) : null;
  const vertMain = buildFarVertexMain();


  function patchMaterial(mat) {
    if (!supported || disposed || !mat || (mat.userData && mat.userData.__rswFar)) return;
    if (!mat.userData) mat.userData = {};
    mat.userData.__rswFar = true;
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = function (shader, rendererArg) {
      if (typeof prev === "function") prev.call(this, shader, rendererArg);
      if (
        shader.fragmentShader.indexOf(ANCHOR_LIGHTS) === -1 ||
        shader.vertexShader.indexOf(ANCHOR_WORLDPOS) === -1
      ) {
        return;                                                           
      }
      shader.uniforms.uRswFarOn = uniforms.uRswFarOn;
      shader.uniforms.uRswFarHfOn = uniforms.uRswFarHfOn;
      shader.uniforms.uRswFarSunDir = uniforms.uRswFarSunDir;
      shader.uniforms.uRswFarWinCenter = uniforms.uRswFarWinCenter;
      shader.uniforms.uRswFarWinHalf = uniforms.uRswFarWinHalf;
      shader.uniforms.uRswFarDist = uniforms.uRswFarDist;
      shader.uniforms.uRswFarSoft = uniforms.uRswFarSoft;
      shader.uniforms.uRswFarHfTex = uniforms.uRswFarHfTex;
      shader.uniforms.uRswFarHfMin = uniforms.uRswFarHfMin;
      shader.uniforms.uRswFarHfInv = uniforms.uRswFarHfInv;
      if (sdfOn) {
        shader.uniforms.uRswFarSdfOn = uniforms.uRswFarSdfOn;
        shader.uniforms.uRswFarSdfTex = uniforms.uRswFarSdfTex;
        shader.uniforms.uRswFarSdfMin = uniforms.uRswFarSdfMin;
        shader.uniforms.uRswFarSdfInvSpan = uniforms.uRswFarSdfInvSpan;
        shader.uniforms.uRswFarSdfCell = uniforms.uRswFarSdfCell;
      }
      shader.fragmentShader =
        fragPars + shader.fragmentShader.replace(ANCHOR_LIGHTS, patchedLights);
      shader.vertexShader =
        "varying vec3 vRswFarPos;\n" +
        shader.vertexShader.replace(ANCHOR_WORLDPOS, ANCHOR_WORLDPOS + vertMain);
    };
    const prevKey = mat.customProgramCacheKey;
    const gen = patchGen;
    mat.customProgramCacheKey = function () {
      const base = typeof prevKey === "function" ? prevKey.call(this) : "";


      return base + "|rswFar1" + (prof.lite ? "l8" : sdfCapable ? "s" : "h") + "g" + gen;
    };
    mat.needsUpdate = true;
  }


  function bake(boxes) {
    if (!supported || disposed) return false;
    const hf = buildHeightfieldFromBoxes(boxes, { dim: FAR_HF_DIM });
    lastHf = hf.empty ? null : hf;                                     
    if (hf.empty) {
      uniforms.uRswFarHfOn.value = 0;
    } else {
      const src = hf.data;
      for (let i = 0; i < src.length; i++) {
        const q = i * 4;
        const v = src[i];
        hfData[q] = v;
        hfData[q + 1] = v;
        hfData[q + 2] = v;
        hfData[q + 3] = 255;
      }
      hfTex.needsUpdate = true;
      uniforms.uRswFarHfMin.value.set(hf.minX, hf.minY, hf.minZ);
      uniforms.uRswFarHfInv.value.set(1 / hf.sizeX, hf.rangeY / 254, 1 / hf.sizeZ);
      uniforms.uRswFarDist.value = Math.min(8192, Math.max(hf.sizeX, hf.sizeZ) * 1.25);
      uniforms.uRswFarHfOn.value = 1;
    }
    if (sdfOn) {
      const sdf = buildSdfFromBoxes(boxes, { dim: FAR_SDF_DIM });
      if (sdf.empty) {
        uniforms.uRswFarSdfOn.value = 0;
      } else {
        const src3 = sdf.data;
        for (let i = 0; i < src3.length; i++) {
          const q = i * 4;
          const v = src3[i];
          sdfData[q] = v;
          sdfData[q + 1] = v;
          sdfData[q + 2] = v;
          sdfData[q + 3] = 255;
        }
        sdfTex.needsUpdate = true;
        uniforms.uRswFarSdfMin.value.set(sdf.minX, sdf.minY, sdf.minZ);
        uniforms.uRswFarSdfInvSpan.value = 1 / sdf.span;
        uniforms.uRswFarSdfCell.value = sdf.cell;
        uniforms.uRswFarSdfOn.value = 1;
      }
    }
    return uniforms.uRswFarHfOn.value === 1 || uniforms.uRswFarSdfOn.value === 1;
  }

  function setEnabled(on) {
    enabled = !!on && supported;
    uniforms.uRswFarOn.value = enabled ? 1 : 0;
  }

  function isEnabled() {
    return enabled;
  }


  function setSun(args) {
    if (!supported) return;
    const a = args || {};
    const x = Number.isFinite(a.x) ? a.x : 0;
    const y = Number.isFinite(a.y) ? a.y : 1;
    const z = Number.isFinite(a.z) ? a.z : 0;
    const len = Math.hypot(x, y, z);
    if (len > 1e-6) uniforms.uRswFarSunDir.value.set(x / len, y / len, z / len);
    const soft = Number.isFinite(a.softness) ? Math.min(1, Math.max(0, a.softness)) : 0.2;


    uniforms.uRswFarSoft.value = 10 + (1 - soft) * 38;
  }


  function setWindow(center, half) {
    if (!supported) return;
    if (
      center &&
      Number.isFinite(center[0]) &&
      Number.isFinite(center[1]) &&
      Number.isFinite(center[2])
    ) {
      uniforms.uRswFarWinCenter.value.set(center[0], center[1], center[2]);
    }
    uniforms.uRswFarWinHalf.value = Number.isFinite(half) && half > 0 ? half : 0;
  }


  function bumpGeneration() {
    patchGen += 1;
  }

  function dispose() {
    disposed = true;
    enabled = false;
    lastHf = null;       

    uniforms.uRswFarOn.value = 0;
    uniforms.uRswFarHfOn.value = 0;
    uniforms.uRswFarSdfOn.value = 0;
    uniforms.uRswFarHfTex.value = null;
    uniforms.uRswFarSdfTex.value = null;
    if (hfTex) {
      hfTex.dispose();
      hfTex = null;
    }
    if (sdfTex) {
      sdfTex.dispose();
      sdfTex = null;
    }
  }

  return {
    supported,
    sdfCapable,


    lite: prof.lite,
    texUnits: prof.texUnits,


    getHeightfield: () => lastHf,
    patchMaterial,
    bake,
    setEnabled,
    isEnabled,
    setSun,
    setWindow,
    bumpGeneration,
    dispose,
  };
}
