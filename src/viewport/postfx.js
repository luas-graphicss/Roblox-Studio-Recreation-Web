import { createAntialiasedScenePass } from "./antialiasedScenePass.js";
import { createSpatialAntialiasingPass } from "./spatialAntialiasingPass.js";
import { logger } from "../core/logger.js";
import { store } from "../core/state.js";
import { bus } from "../core/eventBus.js";
import { getService, Events } from "../datamodel/index.js";
import { clampNumber } from "../utils/validate.js";


import { createShadowDenoisePass } from "./shadowDenoise.js";
import { createMegaLightsPass } from "./megaLights.js";          
import { createSubstrateScreenPasses } from "./substrateScreenPasses.js";
import { createMegaLightsSmScreenCompositePass, isMegaLightsSmChainWanted } from "./megaLightsSmScreenComposite.js";                    


import { createVolumetricFogPass } from "./volumetricFog.js";


import { createSsrPass } from "./ssr.js";
import {
  BLOOM_MIP_SLOTS,
  BLUR_TAP_SLOTS,
  DOF_LEVEL_SIGMA,
  SUNRAYS_TAPS,
  bloomKnee,
  bloomLevelWeights,
  bloomMipCount,
  blurPlan,
  dofBands,
  energyBloomPlan,
  energyLevelWeights,
  gaussianTaps,
  sanitizeBloomParams,
  sunRaysPlan,
  sunRaysTapWeights,
} from "./postfxCore.js";

import { bloomDietMips, ditherAmpFor, fuseTrailingCcIndex } from "../lighting/postfxDietCore.js";

const MAX_PER_TYPE = 10;
const EFFECT_CLASSES = Object.freeze({
  BlurEffect: 1,
  BloomEffect: 1,
  ColorCorrectionEffect: 1,
  DepthOfFieldEffect: 1,
  SunRaysEffect: 1,
});

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;


import { createAoPass } from "./gtao.js";


import { createSharedDepth } from "./sharedDepth.js";


import { createShaderDiet } from "./shaderDiet.js";


import { SHARPEN_PEAK_MAX, buildCasGlsl } from "../lighting/upscaleSharpenCore.js";

import { createAutoExposurePass } from "./autoExposure.js";


import { tonemapGlslChunk } from "../lighting/tonemapCore.js";





import { gradingGlslChunk } from "../lighting/gradingCore.js";


import { LE_GUIDE_DIV, LE_RANGE_SIGMA, buildLeApplyGlsl, buildLeBlurGlsl, buildLeDownsampleGlsl, leRangeInvEnc } from "../lighting/localExposureCore.js";


import { LF_GHOST_SLOTS, LF_SRC_R0, LF_SRC_R1, buildLfCompositeGlsl, buildLfPrefilterGlsl } from "../lighting/lensFlareCore.js";






import { GRAIN_FRAME_WRAP, buildFilmFinalGlsl, buildMotionBlurGlsl } from "../lighting/filmFxCore.js";
import { BYTE_HISTORY_RANGE, MAX_HISTORY_FRAMES, blendAlpha, buildTemporalGlsl } from "../lighting/shadowDenoiseCore.js";

import {
  buildMotionBlurVelocityGlsl,
  TSR_JITTER_COUNT, jitterForFrame, jitterToNdc,
} from "../lighting/tsrCore.js";

import { buildTemporalVelocityGlsl } from "../lighting/motionVectorsCore.js";

export function createPostFX({ THREE, renderer, scene, camera, getGrade, getSunInfo, getShadowTemporal, getMegaLights, getVolumetricFog, getSsr, getAoState, setAoMask, getPostfxDiet,


  getLocalLightPatchRegistry, setLocalVolumetricPassExtension, getHdrPipeline, getUpscaleSharpen, getAutoExposure, getLocalExposure, getLensFlare, getFilmFx, getSmLiteFx, getPassTiming, requestRender,

  getTsrState, getMotionVectors, getSubstrateScreen }) {

  isMegaLightsSmChainWanted(null, requestRender);


  const sharedDepth = createSharedDepth({ THREE, scene, camera });


  const shaderDiet = createShaderDiet({ renderer });
  let lib = null;
  let composer = null;
  let renderPass = null;
  let spatialAntialiasingPass = null;
  const drawingBufferSize = new THREE.Vector2();
  let gradePass = null;
  let denoisePass = null;                                                      
  let substrateScreen = null;
  let mlPass = null;                                                    
  let msmPass = null;                                                             
  let vfPass = null;                                                 
  let ssrPass = null;                                                        
  let aoPass = null;                                                       
  let signature = null;
  let effectPasses = [];


  let fusedPass = null;
  let fusedInst = null;
  let dietState = null;
  let markerPass = null;


  let sharpenPass = null;
  let sharpenOn = false;
  let aePass = null;                                                    


  let lePass = null;
  let leOnNow = false;                                                    


  let lfPass = null;


  let taaPass = null;
  let mbPass = null;
  let filmFxNow = null;
  let fxFrame = 0;

  let tsrJitterFrame = 0;


  const vpNoJit = new THREE.Matrix4();
  let vpNoJitValid = false;
  let disposed = false;
  let failed = false;
  const size = { w: 1, h: 1 };

  function makeRT(rw, rh) {


    return new THREE.WebGLRenderTarget(Math.max(1, rw | 0), Math.max(1, rh | 0), {
      type: shaderDiet.active() ? THREE.UnsignedByteType : THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  function makeShaderMaterial(fragmentShader, uniforms) {
    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
  }

  function makeCopyMaterial() {
    return makeShaderMaterial(
      `
uniform sampler2D tDiffuse;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(tDiffuse, vUv);
}
`,
      { tDiffuse: { value: null } },
    );
  }

  function makeTapBlurMaterial() {
    return makeShaderMaterial(
      `
uniform sampler2D tDiffuse;
uniform vec2 uDir;
uniform vec2 uTexel;
uniform float uOffsets[${BLUR_TAP_SLOTS}];
uniform float uWeights[${BLUR_TAP_SLOTS}];
uniform int uCount;
varying vec2 vUv;
void main() {
  vec4 acc = texture2D(tDiffuse, vUv) * uWeights[0];
  for (int i = 1; i < ${BLUR_TAP_SLOTS}; i++) {
    if (i >= uCount) break;
    vec2 off = uDir * uTexel * uOffsets[i];
    acc += (texture2D(tDiffuse, vUv + off) + texture2D(tDiffuse, vUv - off)) * uWeights[i];
  }
  gl_FragColor = acc;
}
`,
      {
        tDiffuse: { value: null },
        uDir: { value: new THREE.Vector2(1, 0) },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uOffsets: { value: new Array(BLUR_TAP_SLOTS).fill(0) },
        uWeights: { value: new Array(BLUR_TAP_SLOTS).fill(0) },
        uCount: { value: 1 },
      },
    );
  }

  function setTapUniforms(mat, taps) {
    mat.uniforms.uOffsets.value = taps.offsets;
    mat.uniforms.uWeights.value = taps.weights;
    mat.uniforms.uCount.value = taps.count;
  }

  function createBloomPass() {
    const quad = new lib.FullScreenQuad(null);
    const levelTaps = gaussianTaps(2);
    let params = sanitizeBloomParams({});


    let energy = energyBloomPlan(null);
    let lastKey = "";

    let diet = null;
    let pw = Math.max(1, size.w);
    let ph = Math.max(1, size.h);
    let allocW = 0;
    let allocH = 0;
    let allocMips = 0;
    let allocDiv = 0;
    let down = [];
    let tmp = [];

    const prefilterMat = makeShaderMaterial(
      `
uniform sampler2D tDiffuse;
uniform vec3 uCurve;
uniform float uThreshold;
uniform float uEnergyOn;
uniform float uEnergyKnee;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(tDiffuse, vUv);
  float br = max(t.r, max(t.g, t.b));
  float rq = clamp(br - uCurve.x, 0.0, uCurve.y);
  rq = uCurve.z * rq * rq;
  float f = max(rq, br - uThreshold) / max(br, 1e-4);
                                                                          
                                                                          
                                                              
  float fe = br / (br + max(uEnergyKnee, 1e-4));
  gl_FragColor = vec4(t.rgb * mix(max(f, 0.0), fe, uEnergyOn), t.a);
}
`,
      {
        tDiffuse: { value: null },
        uCurve: { value: new THREE.Vector3(0.5, 1, 0.5) },
        uThreshold: { value: 1 },
        uEnergyOn: { value: 0 },          
        uEnergyKnee: { value: 0.5 },          
      },
    );

    const downMat = makeShaderMaterial(
      `
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec4 s = texture2D(tDiffuse, vUv + uTexel * vec2(-1.0, -1.0))
         + texture2D(tDiffuse, vUv + uTexel * vec2(1.0, -1.0))
         + texture2D(tDiffuse, vUv + uTexel * vec2(-1.0, 1.0))
         + texture2D(tDiffuse, vUv + uTexel * vec2(1.0, 1.0));
  gl_FragColor = s * 0.25;
}
`,
      {
        tDiffuse: { value: null },
        uTexel: { value: new THREE.Vector2(1, 1) },
      },
    );

    const blurMat = makeTapBlurMaterial();

    const compMat = makeShaderMaterial(
      `
uniform sampler2D tDiffuse;
uniform sampler2D tMip0;
uniform sampler2D tMip1;
uniform sampler2D tMip2;
uniform sampler2D tMip3;
uniform sampler2D tMip4;
uniform sampler2D tMip5;
uniform float uW[${BLOOM_MIP_SLOTS}];
uniform float uIntensity;
uniform float uDitherAmp;
uniform float uEnergyOn;
uniform float uScatter;
uniform float uDirt;
varying vec2 vUv;
                                                                           
                                                                        
float rswDirtHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float rswDirtNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(rswDirtHash(i), rswDirtHash(i + vec2(1.0, 0.0)), u.x),
             mix(rswDirtHash(i + vec2(0.0, 1.0)), rswDirtHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float rswDirtMask(vec2 uv) {
  float n = 0.65 * rswDirtNoise(uv * 11.0) + 0.35 * rswDirtNoise(uv * 29.0 + vec2(17.3, 9.1));
  return clamp((n - 0.55) * 2.2, 0.0, 1.0);
}
void main() {
  vec4 base = texture2D(tDiffuse, vUv);
  vec3 b = texture2D(tMip0, vUv).rgb * uW[0]
         + texture2D(tMip1, vUv).rgb * uW[1]
         + texture2D(tMip2, vUv).rgb * uW[2]
         + texture2D(tMip3, vUv).rgb * uW[3]
         + texture2D(tMip4, vUv).rgb * uW[4]
         + texture2D(tMip5, vUv).rgb * uW[5];
  vec3 bsum = max(b, vec3(0.0));
  vec3 bloom = bsum * uIntensity;
                                                                     
                                                                          
                                                                        
                                                                      
                                                                               
  float dn = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;
  float dmask = clamp(dot(bloom, vec3(255.0)), 0.0, 1.0);
                                                                              
                                                                             
                                                                        
                                                                        
  vec3 classicC = base.rgb + bloom;
  vec3 energyC = base.rgb * (1.0 - uScatter) + bsum * (1.0 + uDirt * rswDirtMask(vUv)) * uScatter;
  gl_FragColor = vec4(mix(classicC, energyC, uEnergyOn) + dn * uDitherAmp * dmask, base.a);
}
`,
      {
        tDiffuse: { value: null },
        tMip0: { value: null },
        tMip1: { value: null },
        tMip2: { value: null },
        tMip3: { value: null },
        tMip4: { value: null },
        tMip5: { value: null },
        uW: { value: new Array(BLOOM_MIP_SLOTS).fill(0) },
        uIntensity: { value: 0 },
        uDitherAmp: { value: 0 },
        uEnergyOn: { value: 0 },          
        uScatter: { value: 0 },          
        uDirt: { value: 0 },          
      },
    );

    function releaseTargets() {
      for (const rt of down) rt.dispose();
      for (const rt of tmp) rt.dispose();
      down = [];
      tmp = [];
      allocW = 0;
      allocH = 0;
      allocMips = 0;
      allocDiv = 0;
    }


    function ensureTargets(mips, startDiv) {
      if (allocW === pw && allocH === ph && allocMips === mips && allocDiv === startDiv) return;
      releaseTargets();
      allocW = pw;
      allocH = ph;
      allocMips = mips;
      allocDiv = startDiv;
      let lw = Math.max(1, Math.floor(pw / startDiv));
      let lh = Math.max(1, Math.floor(ph / startDiv));
      for (let i = 0; i < mips; i++) {
        down.push(makeRT(lw, lh));
        tmp.push(makeRT(lw, lh));
        lw = Math.max(1, Math.floor(lw / 2));
        lh = Math.max(1, Math.floor(lh / 2));
      }
    }

    function blit(r, material, target) {
      quad.material = material;
      r.setRenderTarget(target);
      quad.render(r);
    }

    return {
      enabled: true,
      needsSwap: true,
      clear: false,
      renderToScreen: false,
      setParams(raw) {
        const key = String(raw && raw.intensity) + "|" + String(raw && raw.size) + "|" + String(raw && raw.threshold) +
          "|" + String(raw && raw.mode) + "|" + String(raw && raw.anamorphic) + "|" + String(raw && raw.dirt);          
        if (key === lastKey) return;
        lastKey = key;
        params = sanitizeBloomParams(raw);
        energy = energyBloomPlan(raw);                                        
      },


      setDiet(d) {
        diet = d || null;
      },
      setSize(nw, nh) {
        pw = Math.max(1, nw | 0);
        ph = Math.max(1, nh | 0);
      },
      render(r, writeBuffer, readBuffer) {
        const active = params.intensity > 0.001 && params.size > 0.001;


        const en = active && energy.on;


        const dietOn = !!(diet && diet.active);
        const startDiv = dietOn ? diet.bloomStartDiv : 2;
        const maxMips = dietOn ? diet.bloomMaxMips : BLOOM_MIP_SLOTS;
        const mips = active ? bloomDietMips(bloomMipCount(params.size, pw, ph), maxMips) : 1;
        ensureTargets(mips, startDiv);
        if (active) {
          const knee = bloomKnee(params.threshold);
          prefilterMat.uniforms.tDiffuse.value = readBuffer.texture;
          prefilterMat.uniforms.uThreshold.value = knee.threshold;
          prefilterMat.uniforms.uCurve.value.set(knee.curve[0], knee.curve[1], knee.curve[2]);

          prefilterMat.uniforms.uEnergyOn.value = en ? 1 : 0;
          prefilterMat.uniforms.uEnergyKnee.value = energy.knee;
          blit(r, prefilterMat, down[0]);
          for (let i = 1; i < mips; i++) {
            downMat.uniforms.tDiffuse.value = down[i - 1].texture;
            downMat.uniforms.uTexel.value.set(1 / down[i - 1].width, 1 / down[i - 1].height);
            blit(r, downMat, down[i]);
          }
          setTapUniforms(blurMat, levelTaps);


          const anamX = en ? energy.anamorphic : 1;
          for (let i = 0; i < mips; i++) {
            blurMat.uniforms.tDiffuse.value = down[i].texture;
            blurMat.uniforms.uTexel.value.set(anamX / down[i].width, 1 / down[i].height);
            blurMat.uniforms.uDir.value.set(1, 0);
            blit(r, blurMat, tmp[i]);
            blurMat.uniforms.tDiffuse.value = tmp[i].texture;
            blurMat.uniforms.uTexel.value.set(1 / down[i].width, 1 / down[i].height);
            blurMat.uniforms.uDir.value.set(0, 1);
            blit(r, blurMat, down[i]);
          }
        }


        const weights = en ? energyLevelWeights(params.size, mips) : bloomLevelWeights(params.size, mips);
        const uW = compMat.uniforms.uW.value;
        for (let i = 0; i < BLOOM_MIP_SLOTS; i++) uW[i] = active ? weights[i] || 0 : 0;
        const mipTex = (i) => (down[Math.min(i, down.length - 1)] || down[0]).texture;
        compMat.uniforms.tDiffuse.value = readBuffer.texture;
        compMat.uniforms.tMip0.value = mipTex(0);
        compMat.uniforms.tMip1.value = mipTex(1);
        compMat.uniforms.tMip2.value = mipTex(2);
        compMat.uniforms.tMip3.value = mipTex(3);
        compMat.uniforms.tMip4.value = mipTex(4);
        compMat.uniforms.tMip5.value = mipTex(5);
        compMat.uniforms.uIntensity.value = active ? params.intensity : 0;

        compMat.uniforms.uEnergyOn.value = en ? 1 : 0;
        compMat.uniforms.uScatter.value = en ? energy.scatter : 0;
        compMat.uniforms.uDirt.value = en ? energy.dirt : 0;


        compMat.uniforms.uDitherAmp.value = active && dietOn ? ditherAmpFor(params.intensity, diet.ditherAmp) : 0;
        blit(r, compMat, this.renderToScreen ? null : writeBuffer);
      },
      dispose() {
        releaseTargets();
        prefilterMat.dispose();
        downMat.dispose();
        blurMat.dispose();
        compMat.dispose();
        quad.dispose();
      },
    };
  }

  function createBlurPass() {
    const quad = new lib.FullScreenQuad(null);
    let plan = blurPlan(0);
    let taps = null;
    let lastSize = null;
    let pw = Math.max(1, size.w);
    let ph = Math.max(1, size.h);
    let allocW = 0;
    let allocH = 0;
    let allocSteps = -1;
    let pyr = [];
    let ping = null;
    let pong = null;
    const copyMat = makeCopyMaterial();
    const blurMat = makeTapBlurMaterial();

    function release() {
      for (const rt of pyr) rt.dispose();
      pyr = [];
      if (ping) ping.dispose();
      if (pong) pong.dispose();
      ping = null;
      pong = null;
      allocW = 0;
      allocH = 0;
      allocSteps = -1;
    }

    function ensure() {
      if (allocW === pw && allocH === ph && allocSteps === plan.steps) return;
      release();
      allocW = pw;
      allocH = ph;
      allocSteps = plan.steps;
      let lw = Math.max(1, pw | 0);
      let lh = Math.max(1, ph | 0);
      for (let i = 0; i < plan.steps; i++) {
        lw = Math.max(1, Math.floor(lw / 2));
        lh = Math.max(1, Math.floor(lh / 2));
        pyr.push(makeRT(lw, lh));
      }
      ping = makeRT(lw, lh);
      pong = makeRT(lw, lh);
    }

    function blit(r, material, target) {
      quad.material = material;
      r.setRenderTarget(target);
      quad.render(r);
    }

    return {
      enabled: true,
      needsSwap: true,
      clear: false,
      renderToScreen: false,
      setParams(rawSize) {


        const key = String(rawSize);
        if (key === lastSize) return;
        lastSize = key;
        plan = blurPlan(rawSize);
        taps = plan.enabled ? gaussianTaps(plan.sigma) : null;
      },
      setSize(nw, nh) {
        pw = Math.max(1, nw | 0);
        ph = Math.max(1, nh | 0);
      },
      render(r, writeBuffer, readBuffer) {
        const out = this.renderToScreen ? null : writeBuffer;
        if (!plan.enabled || !taps) {
          copyMat.uniforms.tDiffuse.value = readBuffer.texture;
          blit(r, copyMat, out);
          return;
        }
        pw = Math.max(1, readBuffer.width | 0);
        ph = Math.max(1, readBuffer.height | 0);
        ensure();
        let srcTex = readBuffer.texture;
        for (const rt of pyr) {
          copyMat.uniforms.tDiffuse.value = srcTex;
          blit(r, copyMat, rt);
          srcTex = rt.texture;
        }
        setTapUniforms(blurMat, taps);
        blurMat.uniforms.tDiffuse.value = srcTex;
        blurMat.uniforms.uTexel.value.set(1 / ping.width, 1 / ping.height);
        blurMat.uniforms.uDir.value.set(1, 0);
        blit(r, blurMat, ping);
        blurMat.uniforms.tDiffuse.value = ping.texture;
        blurMat.uniforms.uDir.value.set(0, 1);
        blit(r, blurMat, pong);
        copyMat.uniforms.tDiffuse.value = pong.texture;
        blit(r, copyMat, out);
      },
      dispose() {
        release();
        copyMat.dispose();
        blurMat.dispose();
        quad.dispose();
      },
    };
  }

  function makeDofPrefilterMaterial() {
    return makeShaderMaterial(
      `
#include <packing>
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform float uCameraNear;
uniform float uCameraFar;
uniform float uNearEdge;
uniform float uNearIntensity;
varying vec2 vUv;
void main() {
  float fragZ = unpackRGBAToDepth(texture2D(tDepth, vUv));
  float dist = -perspectiveDepthToViewZ(fragZ, uCameraNear, uCameraFar);
  float nearCoc = uNearIntensity * clamp((uNearEdge - dist) / max(uNearEdge, 1e-4), 0.0, 1.0);
  gl_FragColor = vec4(texture2D(tDiffuse, vUv).rgb, nearCoc);
}
`,
      {
        tDiffuse: { value: null },
        tDepth: { value: null },
        uCameraNear: { value: 0.1 },
        uCameraFar: { value: 1000 },
        uNearEdge: { value: 40 },
        uNearIntensity: { value: 0.75 },
      },
    );
  }

  function makeDofCompositeMaterial() {
    return makeShaderMaterial(
      `
#include <packing>
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform sampler2D tBlurA;
uniform sampler2D tBlurB;
uniform float uCameraNear;
uniform float uCameraFar;
uniform float uNearEdge;
uniform float uFarEdge;
uniform float uNearIntensity;
uniform float uFarIntensity;
varying vec2 vUv;
void main() {
  vec4 sharp = texture2D(tDiffuse, vUv);
  vec4 blurA = texture2D(tBlurA, vUv);
  vec4 blurB = texture2D(tBlurB, vUv);
  float fragZ = unpackRGBAToDepth(texture2D(tDepth, vUv));
  float dist = -perspectiveDepthToViewZ(fragZ, uCameraNear, uCameraFar);
  float farCoc = uFarIntensity * clamp((dist - uFarEdge) / max(dist, 1e-4), 0.0, 1.0);
  float nearCoc = uNearIntensity * clamp((uNearEdge - dist) / max(uNearEdge, 1e-4), 0.0, 1.0);
  float nearSpread = max(nearCoc, blurA.a);
  float t = clamp(max(farCoc, nearSpread), 0.0, 1.0);
  vec3 col = t < 0.5 ? mix(sharp.rgb, blurA.rgb, t * 2.0) : mix(blurA.rgb, blurB.rgb, t * 2.0 - 1.0);
  gl_FragColor = vec4(col, sharp.a);
}
`,
      {
        tDiffuse: { value: null },
        tDepth: { value: null },
        tBlurA: { value: null },
        tBlurB: { value: null },
        uCameraNear: { value: 0.1 },
        uCameraFar: { value: 1000 },
        uNearEdge: { value: 40 },
        uFarEdge: { value: 60 },
        uNearIntensity: { value: 0.75 },
        uFarIntensity: { value: 0.75 },
      },
    );
  }

  function createDofPass() {
    const quad = new lib.FullScreenQuad(null);
    const taps = gaussianTaps(DOF_LEVEL_SIGMA);
    let bands = dofBands({ nearIntensity: 0, farIntensity: 0 });
    let lastKey = null;
    let pw = Math.max(1, size.w);
    let ph = Math.max(1, size.h);
    let allocW = 0;
    let allocH = 0;
    let halfA = null;
    let halfB = null;
    let quarterA = null;
    let quarterB = null;
    const copyMat = makeCopyMaterial();
    const blurMat = makeTapBlurMaterial();
    const prefilterMat = makeDofPrefilterMaterial();
    const compositeMat = makeDofCompositeMaterial();

    function release() {
      if (halfA) halfA.dispose();
      if (halfB) halfB.dispose();
      if (quarterA) quarterA.dispose();
      if (quarterB) quarterB.dispose();
      halfA = null;
      halfB = null;
      quarterA = null;
      quarterB = null;
      allocW = 0;
      allocH = 0;
    }

    function ensure() {
      if (allocW === pw && allocH === ph) return;
      release();
      allocW = pw;
      allocH = ph;
      const hw = Math.max(1, pw >> 1);
      const hh = Math.max(1, ph >> 1);
      halfA = makeRT(hw, hh);
      halfB = makeRT(hw, hh);
      quarterA = makeRT(Math.max(1, hw >> 1), Math.max(1, hh >> 1));
      quarterB = makeRT(Math.max(1, hw >> 1), Math.max(1, hh >> 1));
    }

    function blit(r, material, target) {
      quad.material = material;
      r.setRenderTarget(target);
      quad.render(r);
    }

    function blurPair(r, a, b) {
      setTapUniforms(blurMat, taps);
      blurMat.uniforms.uTexel.value.set(1 / a.width, 1 / a.height);
      blurMat.uniforms.tDiffuse.value = a.texture;
      blurMat.uniforms.uDir.value.set(1, 0);
      blit(r, blurMat, b);
      blurMat.uniforms.tDiffuse.value = b.texture;
      blurMat.uniforms.uDir.value.set(0, 1);
      blit(r, blurMat, a);
    }

    return {
      enabled: true,
      needsSwap: true,
      clear: false,
      renderToScreen: false,
      setParams(raw) {
        const src = raw && typeof raw === "object" ? raw : {};
        const key =
          String(src.focusDistance) + "|" + String(src.inFocusRadius) + "|" +
          String(src.nearIntensity) + "|" + String(src.farIntensity);
        if (key === lastKey) return;
        lastKey = key;
        bands = dofBands(src);
      },
      setSize(nw, nh) {
        pw = Math.max(1, nw | 0);
        ph = Math.max(1, nh | 0);
      },
      render(r, writeBuffer, readBuffer) {
        const out = this.renderToScreen ? null : writeBuffer;
        if (!bands.active) {
          copyMat.uniforms.tDiffuse.value = readBuffer.texture;
          blit(r, copyMat, out);
          return;
        }


        pw = Math.max(1, readBuffer.width | 0);
        ph = Math.max(1, readBuffer.height | 0);
        ensure();


        const depthTex = sharedDepth.acquire(r, pw, ph);
        const pu = prefilterMat.uniforms;
        pu.tDiffuse.value = readBuffer.texture;
        pu.tDepth.value = depthTex;
        pu.uCameraNear.value = camera.near;
        pu.uCameraFar.value = camera.far;
        pu.uNearEdge.value = bands.nearEdge;
        pu.uNearIntensity.value = bands.nearIntensity;
        blit(r, prefilterMat, halfA);
        blurPair(r, halfA, halfB);
        copyMat.uniforms.tDiffuse.value = halfA.texture;
        blit(r, copyMat, quarterA);
        blurPair(r, quarterA, quarterB);
        const cu = compositeMat.uniforms;
        cu.tDiffuse.value = readBuffer.texture;
        cu.tDepth.value = depthTex;
        cu.tBlurA.value = halfA.texture;
        cu.tBlurB.value = quarterA.texture;
        cu.uCameraNear.value = camera.near;
        cu.uCameraFar.value = camera.far;
        cu.uNearEdge.value = bands.nearEdge;
        cu.uFarEdge.value = bands.farEdge;
        cu.uNearIntensity.value = bands.nearIntensity;
        cu.uFarIntensity.value = bands.farIntensity;
        blit(r, compositeMat, out);
      },
      dispose() {
        release();
        copyMat.dispose();
        blurMat.dispose();
        prefilterMat.dispose();
        compositeMat.dispose();
        quad.dispose();
      },
    };
  }

  function makeGradeShader() {
    return {
      uniforms: {
        tDiffuse: { value: null },
        uExposure: { value: 1 },
        uBright: { value: 1 },
        uTint: { value: new THREE.Vector3(1, 1, 1) },
        uPunch: { value: 1 },
        uLift: { value: 0 },
        uAutoExposure: { value: 1 },                                       
        uTonemap: { value: 0 },


        tLeGuide: { value: null },
        uLeGuideTexel: { value: new THREE.Vector2(0, 0) },
        uLeOn: { value: 0 },
        uLeStrength: { value: 0 },
        uLeMidLog: { value: 0 },
        uLeMaxStops: { value: 0 },


        uWbOn: { value: 0 },
        uWbMat: { value: new THREE.Matrix3() },
        uGradeOn: { value: 0 },
        uGradeLift: { value: new THREE.Vector3(0, 0, 0) },
        uGradeGamma: { value: new THREE.Vector3(1, 1, 1) },
        uGradeGain: { value: new THREE.Vector3(1, 1, 1) },
        uGradeSatZone: { value: new THREE.Vector3(1, 1, 1) },
        uGradeConZone: { value: new THREE.Vector3(1, 1, 1) },
        tLut: { value: null },
        uLutOn: { value: 0 },
        uLutSize: { value: 0 },
        uLutAmount: { value: 0 },
        uLutDomainMul: { value: new THREE.Vector3(1, 1, 1) },
        uLutDomainAdd: { value: new THREE.Vector3(0, 0, 0) },


        uFxCa: { value: 0 },
        uFxGrain: { value: 0 },
        uFxFrame: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: `
uniform sampler2D tDiffuse;
uniform float uExposure;
uniform float uBright;
uniform vec3 uTint;
uniform float uPunch;
uniform float uLift;
uniform float uAutoExposure;
uniform int uTonemap;
uniform float uFxCa;
uniform float uFxGrain;
uniform float uFxFrame;
uniform int uWbOn;
uniform mat3 uWbMat;
uniform int uGradeOn;
uniform vec3 uGradeLift;
uniform vec3 uGradeGamma;
uniform vec3 uGradeGain;
uniform vec3 uGradeSatZone;
uniform vec3 uGradeConZone;
uniform sampler2D tLut;
uniform int uLutOn;
uniform float uLutSize;
uniform float uLutAmount;
uniform vec3 uLutDomainMul;
uniform vec3 uLutDomainAdd;
${gradingGlslChunk()}
${tonemapGlslChunk()}
${buildLeApplyGlsl()}
${buildFilmFinalGlsl()}
varying vec2 vUv;
void main() {
  vec4 t = texture2D(tDiffuse, vUv);
                                                                       
                                                                  
  if (uFxCa > 0.0001) { t = vec4(rswFxCaFetch(tDiffuse, vUv, uFxCa), t.a); }
                                                                             
                                                                          
  vec3 c = rswLeApply(t.rgb, vUv);
                                                                       
                                                                             
  if (uWbOn == 1) { c = uWbMat * c; }
  c = c * uExposure * uAutoExposure * uBright * uTint + uLift;
  c = (c - 0.5) * uPunch + 0.5;
  c = max(c, 0.0);
                                                                         
                                                                          
  c = rswApplyTonemap(c, uTonemap);
                                                                         
                                                                 
  if (uGradeOn == 1) {
    c = rswGrWheels(c, uGradeLift, uGradeGamma, uGradeGain);
    c = rswGrZones(c, uGradeSatZone, uGradeConZone);
  }
                                                                      
                                                                          
                                
  if (uFxGrain > 0.0001) { c = rswFxGrainApply(c, gl_FragCoord.xy, uFxGrain, uFxFrame); }
                                                                       
                                                                             
                                                                             
                                                                          
                                                                 
                                                                   
  vec3 srgb = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
                                                                      
                                                                           
                                                              
  if (uLutOn == 1) {
    vec3 cl = clamp(srgb * uLutDomainMul + uLutDomainAdd, 0.0, 1.0);
    srgb = mix(srgb, rswLutSample(tLut, cl, uLutSize), uLutAmount);
  }
  gl_FragColor = vec4(srgb, t.a);
}
`,
    };
  }

  function makeColorCorrectionShader() {
    return {
      uniforms: {
        tDiffuse: { value: null },
        uBrightness: { value: 0 },
        uContrast: { value: 0 },
        uSaturation: { value: 0 },
        uTint: { value: new THREE.Vector3(1, 1, 1) },


        uCcClampMax: { value: 4 },
      },
      vertexShader: VERT,
      fragmentShader: `
uniform sampler2D tDiffuse;
uniform float uBrightness;
uniform float uContrast;
uniform float uSaturation;
uniform vec3 uTint;
uniform float uCcClampMax;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(tDiffuse, vUv);
  vec3 c = t.rgb + uBrightness;
  c = (c - 0.5) * (1.0 + uContrast) + 0.5;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 1.0 + uSaturation);
  c *= uTint;
  gl_FragColor = vec4(clamp(c, 0.0, uCcClampMax), t.a);
}
`,
    };
  }


  function makeFusedFinalShader() {
    return {
      uniforms: {
        tDiffuse: { value: null },
        uExposure: { value: 1 },
        uBright: { value: 1 },
        uTint: { value: new THREE.Vector3(1, 1, 1) },
        uPunch: { value: 1 },
        uLift: { value: 0 },
        uAutoExposure: { value: 1 },                                       
        uCcOn: { value: 0 },
        uCcBrightness: { value: 0 },
        uCcContrast: { value: 0 },
        uCcSaturation: { value: 0 },
        uCcTint: { value: new THREE.Vector3(1, 1, 1) },

        uCcClampMax: { value: 4 },
        uVignette: { value: 0 },
        uTonemap: { value: 0 },

        tLeGuide: { value: null },
        uLeGuideTexel: { value: new THREE.Vector2(0, 0) },
        uLeOn: { value: 0 },
        uLeStrength: { value: 0 },
        uLeMidLog: { value: 0 },
        uLeMaxStops: { value: 0 },

        uWbOn: { value: 0 },
        uWbMat: { value: new THREE.Matrix3() },
        uGradeOn: { value: 0 },
        uGradeLift: { value: new THREE.Vector3(0, 0, 0) },
        uGradeGamma: { value: new THREE.Vector3(1, 1, 1) },
        uGradeGain: { value: new THREE.Vector3(1, 1, 1) },
        uGradeSatZone: { value: new THREE.Vector3(1, 1, 1) },
        uGradeConZone: { value: new THREE.Vector3(1, 1, 1) },
        tLut: { value: null },
        uLutOn: { value: 0 },
        uLutSize: { value: 0 },
        uLutAmount: { value: 0 },
        uLutDomainMul: { value: new THREE.Vector3(1, 1, 1) },
        uLutDomainAdd: { value: new THREE.Vector3(0, 0, 0) },


        uFxCa: { value: 0 },
        uFxGrain: { value: 0 },
        uFxFrame: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: `
uniform sampler2D tDiffuse;
uniform float uExposure;
uniform float uBright;
uniform vec3 uTint;
uniform float uPunch;
uniform float uLift;
uniform float uAutoExposure;
uniform float uFxCa;
uniform float uFxGrain;
uniform float uFxFrame;
uniform float uCcOn;
uniform float uCcBrightness;
uniform float uCcContrast;
uniform float uCcSaturation;
uniform vec3 uCcTint;
uniform float uCcClampMax;
uniform float uVignette;
uniform int uTonemap;
uniform int uWbOn;
uniform mat3 uWbMat;
uniform int uGradeOn;
uniform vec3 uGradeLift;
uniform vec3 uGradeGamma;
uniform vec3 uGradeGain;
uniform vec3 uGradeSatZone;
uniform vec3 uGradeConZone;
uniform sampler2D tLut;
uniform int uLutOn;
uniform float uLutSize;
uniform float uLutAmount;
uniform vec3 uLutDomainMul;
uniform vec3 uLutDomainAdd;
${gradingGlslChunk()}
${tonemapGlslChunk()}
${buildLeApplyGlsl()}
${buildFilmFinalGlsl()}
varying vec2 vUv;
void main() {
  vec4 t = texture2D(tDiffuse, vUv);
                                                                          
  if (uFxCa > 0.0001) { t = vec4(rswFxCaFetch(tDiffuse, vUv, uFxCa), t.a); }
                                                                          
                                                                        
  vec3 c = rswLeApply(t.rgb, vUv);
                                                                             
  if (uCcOn > 0.5) {
    c = c + uCcBrightness;
    c = (c - 0.5) * (1.0 + uCcContrast) + 0.5;
    float lcc = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(lcc), c, 1.0 + uCcSaturation);
    c *= uCcTint;
    c = clamp(c, 0.0, uCcClampMax);
  }
                                                                       
                                                                  
  if (uWbOn == 1) { c = uWbMat * c; }
                                                 
  c = c * uExposure * uAutoExposure * uBright * uTint + uLift;
  c = (c - 0.5) * uPunch + 0.5;
  c = max(c, 0.0);
                                                                           
                                                  
  if (uVignette > 0.001) {
    c *= 1.0 - uVignette * smoothstep(0.35, 0.75, distance(vUv, vec2(0.5)));
  }
                                                                            
                                                                       
                                                                   
  c = rswApplyTonemap(c, uTonemap);
                                                                       
  if (uGradeOn == 1) {
    c = rswGrWheels(c, uGradeLift, uGradeGamma, uGradeGain);
    c = rswGrZones(c, uGradeSatZone, uGradeConZone);
  }
                                                                        
  if (uFxGrain > 0.0001) { c = rswFxGrainApply(c, gl_FragCoord.xy, uFxGrain, uFxFrame); }
                                                                    
  vec3 srgb = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
                                                                        
  if (uLutOn == 1) {
    vec3 cl = clamp(srgb * uLutDomainMul + uLutDomainAdd, 0.0, 1.0);
    srgb = mix(srgb, rswLutSample(tLut, cl, uLutSize), uLutAmount);
  }
  gl_FragColor = vec4(srgb, t.a);
}
`,
    };
  }

  function makeSunSourceMaterial() {
    return makeShaderMaterial(
      `
uniform sampler2D tMask;
uniform sampler2D tScene;
uniform vec2 uSunPos;
uniform float uAspect;
uniform float uRadius;
uniform float uSoftness;
varying vec2 vUv;
void main() {
  vec2 d = (vUv - uSunPos) * vec2(uAspect, 1.0);
  float dist = length(d);
  float window = 1.0 - smoothstep(uRadius, uRadius * 2.5, dist);
  float core = 1.0 - smoothstep(uRadius * (1.0 - uSoftness), uRadius, dist);
  float sky = texture2D(tMask, vUv).r;
  vec3 s = texture2D(tScene, vUv).rgb;
  float lum = dot(s, vec3(0.299, 0.587, 0.114));
  float bright = smoothstep(0.55, 0.95, lum);
  gl_FragColor = vec4(vec3(max(bright * window, core * 0.85) * sky), 1.0);
}
`,
      {
        tMask: { value: null },
        tScene: { value: null },
        uSunPos: { value: new THREE.Vector2(0.5, 0.5) },
        uAspect: { value: 1 },
        uRadius: { value: 0.1 },
        uSoftness: { value: 0.6 },
      },
    );
  }

  function makeRadialBlurMaterial() {
    return makeShaderMaterial(
      `
uniform sampler2D tDiffuse;
uniform vec2 uSunPos;
uniform float uLength;
uniform float uWeights[${SUNRAYS_TAPS}];
varying vec2 vUv;
void main() {
  vec2 stepUv = (uSunPos - vUv) * uLength / float(${SUNRAYS_TAPS});
  vec2 uv = vUv;
  float acc = 0.0;
  for (int i = 0; i < ${SUNRAYS_TAPS}; i++) {
    acc += texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).r * uWeights[i];
    uv += stepUv;
  }
  gl_FragColor = vec4(vec3(acc), 1.0);
}
`,
      {
        tDiffuse: { value: null },
        uSunPos: { value: new THREE.Vector2(0.5, 0.5) },
        uLength: { value: 1 },
        uWeights: { value: new Array(SUNRAYS_TAPS).fill(0) },
      },
    );
  }

  function makeSunRaysCompositeMaterial() {
    return makeShaderMaterial(
      `
uniform sampler2D tDiffuse;
uniform sampler2D tRays;
uniform sampler2D tHalo;
uniform float uEnergy;
varying vec2 vUv;
void main() {
  vec4 base = texture2D(tDiffuse, vUv);
  float ray = texture2D(tRays, vUv).r;
  float halo = texture2D(tHalo, vUv).r;
  gl_FragColor = vec4(base.rgb + vec3(1.0, 0.95, 0.85) * (ray + halo * 0.35) * uEnergy, base.a);
}
`,
      {
        tDiffuse: { value: null },
        tRays: { value: null },
        tHalo: { value: null },
        uEnergy: { value: 0 },
      },
    );
  }

  function createSunRaysPass() {
    const quad = new lib.FullScreenQuad(null);
    let plan = sunRaysPlan({ intensity: 0 });
    let weights = null;
    let lastKey = null;


    const sun = { x: 0.5, y: 0.5, visible: false, strength: 1, visibility: 0 };


    let resolutionDivider = 1;
    let allocDiv = 0;
    let pw = Math.max(1, size.w);
    let ph = Math.max(1, size.h);
    let allocW = 0;
    let allocH = 0;
    let maskRT = null;
    let raysA = null;
    let raysB = null;
    const savedClear = new THREE.Color();
    const occMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const copyMat = makeCopyMaterial();
    const sourceMat = makeSunSourceMaterial();
    const radialMat = makeRadialBlurMaterial();
    const compositeMat = makeSunRaysCompositeMaterial();

    function release() {
      if (maskRT) maskRT.dispose();
      if (raysA) raysA.dispose();
      if (raysB) raysB.dispose();
      maskRT = null;
      raysA = null;
      raysB = null;
      allocW = 0;
      allocH = 0;
      allocDiv = 0;
    }

    function ensure() {
      if (allocW === pw && allocH === ph && allocDiv === resolutionDivider) return;
      release();
      allocW = pw;
      allocH = ph;
      allocDiv = resolutionDivider;


      const maskShift = resolutionDivider > 1 ? 2 : 1;
      const raysShift = resolutionDivider > 1 ? 3 : 2;
      const hw = Math.max(1, pw >> maskShift);
      const hh = Math.max(1, ph >> maskShift);
      const qw = Math.max(1, pw >> raysShift);
      const qh = Math.max(1, ph >> raysShift);
      maskRT = makeRT(hw, hh);
      raysA = makeRT(qw, qh);
      raysB = makeRT(qw, qh);
    }

    function blit(r, material, target) {
      quad.material = material;
      r.setRenderTarget(target);
      quad.render(r);
    }

    return {
      enabled: true,
      needsSwap: true,
      clear: false,
      renderToScreen: false,


      setDiet(diet) {
        const div = diet && Number.isFinite(diet.sunRaysResolutionDivider) ? diet.sunRaysResolutionDivider : 1;
        resolutionDivider = div >= 2 ? 2 : 1;
      },
      setParams(raw) {
        const src = raw && typeof raw === "object" ? raw : {};
        const key = String(src.intensity) + "|" + String(src.spread);
        if (key === lastKey) return;
        lastKey = key;
        plan = sunRaysPlan(src);
        weights = plan.active ? sunRaysTapWeights(plan.decay) : null;
      },
      setSun(info) {
        if (!info) {
          sun.visible = false;
          sun.visibility = 0;
          return;
        }
        sun.x = clampNumber(Number(info.x), -0.5, 1.5, 0.5);
        sun.y = clampNumber(Number(info.y), -0.5, 1.5, 0.5);
        sun.visible = !!info.visible;
        sun.strength = clampNumber(Number(info.strength), 0, 2, 1);

        sun.visibility = clampNumber(Number(info.visibility), 0, 1, sun.visible ? 1 : 0);
      },
      setSize(nw, nh) {
        pw = Math.max(1, nw | 0);
        ph = Math.max(1, nh | 0);
      },
      render(r, writeBuffer, readBuffer) {
        const out = this.renderToScreen ? null : writeBuffer;


        const energy = plan.intensity * sun.strength * sun.visibility;
        if (!plan.active || !weights || energy <= 0.001) {
          copyMat.uniforms.tDiffuse.value = readBuffer.texture;
          blit(r, copyMat, out);
          return;
        }
        pw = Math.max(1, readBuffer.width | 0);
        ph = Math.max(1, readBuffer.height | 0);
        ensure();
        r.getClearColor(savedClear);
        const savedAlpha = r.getClearAlpha();
        const savedOverride = scene.overrideMaterial;
        const savedBackground = scene.background;
        const savedShadowAuto = r.shadowMap.autoUpdate;
        try {
          scene.overrideMaterial = occMat;
          scene.background = null;
          r.shadowMap.autoUpdate = false;
          r.setClearColor(0xffffff, 1);
          r.setRenderTarget(maskRT);
          r.clear();
          r.render(scene, camera);
        } finally {
          scene.overrideMaterial = savedOverride;
          scene.background = savedBackground;
          r.shadowMap.autoUpdate = savedShadowAuto;
          r.setClearColor(savedClear, savedAlpha);
        }
        const su = sourceMat.uniforms;
        su.tMask.value = maskRT.texture;
        su.tScene.value = readBuffer.texture;
        su.uSunPos.value.set(sun.x, sun.y);
        su.uAspect.value = pw / ph;
        su.uRadius.value = plan.diskRadius;
        su.uSoftness.value = plan.diskSoftness;
        blit(r, sourceMat, raysA);
        const ru = radialMat.uniforms;
        ru.uSunPos.value.set(sun.x, sun.y);
        ru.uWeights.value = weights;
        ru.tDiffuse.value = raysA.texture;
        ru.uLength.value = plan.rayLength * plan.stageOneScale;
        blit(r, radialMat, raysB);
        ru.tDiffuse.value = raysB.texture;
        ru.uLength.value = plan.rayLength;
        blit(r, radialMat, raysA);
        const cu = compositeMat.uniforms;
        cu.tDiffuse.value = readBuffer.texture;
        cu.tRays.value = raysA.texture;
        cu.tHalo.value = raysB.texture;
        cu.uEnergy.value = energy * plan.energyScale;
        blit(r, compositeMat, out);
      },
      dispose() {
        release();
        occMat.dispose();
        copyMat.dispose();
        sourceMat.dispose();
        radialMat.dispose();
        compositeMat.dispose();
        quad.dispose();
      },
    };
  }










  function createLensFlarePass() {
    const quad = new lib.FullScreenQuad(null);
    const flareTaps = gaussianTaps(2);
    const blit = (r, mat, target) => {
      quad.material = mat;
      r.setRenderTarget(target);
      quad.render(r);
    };
    let plan = null;
    const sun = { x: 0.5, y: 0.5, visible: false, strength: 1, visibility: 0 };
    let brightA = null;
    let brightB = null;
    let bw = 0;
    let bh = 0;
    const copyMat = makeCopyMaterial();
    const prefMat = makeShaderMaterial(buildLfPrefilterGlsl(), {
      tDiffuse: { value: null },
      uThreshold: { value: 0.85 },
      uKnee: { value: 0.7 },



      uSunPos: { value: new THREE.Vector2(0.5, 0.5) },
      uAspect: { value: 1 },
      uSrcR0: { value: LF_SRC_R0 },
      uSrcR1: { value: LF_SRC_R1 },
    });
    const blurMat = makeTapBlurMaterial();
    const ghostOff = new Array(LF_GHOST_SLOTS).fill(0);
    const ghostW = new Array(LF_GHOST_SLOTS).fill(0);
    const ghostTint = Array.from({ length: LF_GHOST_SLOTS }, () => new THREE.Vector3(1, 1, 1));
    const compMat = makeShaderMaterial(buildLfCompositeGlsl(), {
      tDiffuse: { value: null },
      tBright: { value: null },
      tDepth: { value: null },
      uSunPos: { value: new THREE.Vector2(0.5, 0.5) },
      uAspect: { value: 1 },
      uIntensity: { value: 0 },
      uSunVis: { value: 0 },
      uDispersal: { value: 0.38 },
      uHaloRadius: { value: 0.24 },
      uHaloWidth: { value: 0.07 },
      uHaloGain: { value: 0.5 },
      uStarPoints: { value: 6 },
      uStarRot: { value: 0.4 },
      uStarGain: { value: 0.6 },
      uOccRadius: { value: 0.018 },
      uOccFar: { value: 0.9995 },
      uGhostOff: { value: ghostOff },
      uGhostW: { value: ghostW },
      uGhostTint: { value: ghostTint },
    });
    function ensureRts(pw, ph) {
      const w = Math.max(1, pw >> 3);
      const h = Math.max(1, ph >> 3);
      if (brightA && bw === w && bh === h) return;
      if (brightA) brightA.dispose();
      if (brightB) brightB.dispose();
      brightA = makeRT(w, h);
      brightB = makeRT(w, h);
      bw = w;
      bh = h;
    }
    return {
      enabled: true,
      needsSwap: true,
      clear: false,
      renderToScreen: false,
      applyState(st) {


        if (st === plan) return;
        plan = st || null;
        if (!plan) return;
        const u = compMat.uniforms;
        u.uIntensity.value = plan.intensity;
        u.uDispersal.value = plan.dispersal;
        u.uHaloRadius.value = plan.haloRadius;
        u.uHaloWidth.value = plan.haloWidth;
        u.uHaloGain.value = plan.haloGain;
        u.uStarPoints.value = plan.starPoints;
        u.uStarRot.value = plan.starRot;
        u.uStarGain.value = plan.starGain;
        u.uOccRadius.value = plan.occRadius;
        u.uOccFar.value = plan.occFar;
        const gs = plan.ghosts || [];
        for (let i = 0; i < LF_GHOST_SLOTS; i++) {
          const g = gs[i];
          ghostOff[i] = g ? g.offset : 0;
          ghostW[i] = g ? g.weight : 0;
          if (g) ghostTint[i].set(g.tint[0], g.tint[1], g.tint[2]);
          else ghostTint[i].set(0, 0, 0);
        }
        prefMat.uniforms.uThreshold.value = plan.brightThreshold;
        prefMat.uniforms.uKnee.value = plan.brightKnee;
      },
      setSun(info) {

        sun.visible = !!(info && info.visible);
        sun.x = clampNumber(info ? Number(info.x) : 0.5, -0.5, 1.5, 0.5);
        sun.y = clampNumber(info ? Number(info.y) : 0.5, -0.5, 1.5, 0.5);
        sun.strength = clampNumber(info ? Number(info.strength) : 1, 0, 2, 1);

        sun.visibility = clampNumber(info ? Number(info.visibility) : 0, 0, 1, sun.visible ? 1 : 0);
      },
      setSize() {                                                    },
      render(r, writeBuffer, readBuffer) {
        const out = this.renderToScreen ? null : writeBuffer;

        const sunEnergy = sun.strength * sun.visibility;
        const active = !!(plan && plan.active) && sunEnergy > 0.0005;
        if (!active || !readBuffer || !readBuffer.texture) {

          copyMat.uniforms.tDiffuse.value = readBuffer ? readBuffer.texture : null;
          blit(r, copyMat, out);
          return;
        }
        const pw = Math.max(1, readBuffer.width | 0);
        const ph = Math.max(1, readBuffer.height | 0);
        ensureRts(pw, ph);


        prefMat.uniforms.tDiffuse.value = readBuffer.texture;
        prefMat.uniforms.uSunPos.value.set(sun.x, sun.y);
        prefMat.uniforms.uAspect.value = pw / ph;
        blit(r, prefMat, brightA);

        setTapUniforms(blurMat, flareTaps);
        blurMat.uniforms.tDiffuse.value = brightA.texture;
        blurMat.uniforms.uTexel.value.set(1 / bw, 1 / bh);
        blurMat.uniforms.uDir.value.set(1, 0);
        blit(r, blurMat, brightB);
        blurMat.uniforms.tDiffuse.value = brightB.texture;
        blurMat.uniforms.uDir.value.set(0, 1);
        blit(r, blurMat, brightA);


        const depthTex = sharedDepth.acquire(r, Math.max(1, pw >> 1), Math.max(1, ph >> 1));
        const u = compMat.uniforms;
        u.tDiffuse.value = readBuffer.texture;
        u.tBright.value = brightA.texture;
        u.tDepth.value = depthTex;
        u.uSunPos.value.set(sun.x, sun.y);
        u.uAspect.value = pw / ph;
        u.uSunVis.value = sunEnergy;
        blit(r, compMat, out);
      },
      dispose() {
        try { copyMat.dispose(); } catch (_e) {                       }
        try { prefMat.dispose(); } catch (_e) {                       }
        try { blurMat.dispose(); } catch (_e) {                       }
        try { compMat.dispose(); } catch (_e) {                       }
        if (brightA) { brightA.dispose(); brightA = null; }
        if (brightB) { brightB.dispose(); brightB = null; }
        if (quad && quad.dispose) quad.dispose();
      },
    };
  }

  Promise.all([
    import("three/addons/postprocessing/EffectComposer.js"),
    import("three/addons/postprocessing/RenderPass.js"),
    import("three/addons/postprocessing/ShaderPass.js"),
    import("three/addons/postprocessing/Pass.js"),
  ])
    .then(([ec, rp, sp, ps]) => {
      if (disposed) return;
      lib = {
        EffectComposer: ec.EffectComposer,
        RenderPass: rp.RenderPass,
        ShaderPass: sp.ShaderPass,
        FullScreenQuad: ps.FullScreenQuad,
      };
      composer = new lib.EffectComposer(renderer);
      renderPass = createAntialiasedScenePass({
        THREE, renderer, scene, camera,
        RenderPass: lib.RenderPass,
        FullScreenQuad: lib.FullScreenQuad,
        requestRender,
      });
      spatialAntialiasingPass = createSpatialAntialiasingPass({ THREE, ShaderPass: lib.ShaderPass });
      gradePass = new lib.ShaderPass(makeGradeShader());


      denoisePass = createShadowDenoisePass({
        THREE,
        camera,
        FullScreenQuad: lib.FullScreenQuad,
        sharedDepth,


        getMotionVectors,
      });
      substrateScreen = createSubstrateScreenPasses({ THREE, renderer, scene, camera, sharedDepth, getSubstrateScreen, FullScreenQuad: lib.FullScreenQuad });
      composer.setPixelRatio(1);
      setSize(size.w, size.h);
      signature = null;
      requestRender();
    })
    .catch((err) => {
      failed = true;
      logger.warn(
        `[Iluminação] Pós-processamento indisponível (addons do Three.js não carregaram): ${err && err.message ? err.message : err}`,
      );
    });


  function createMotionBlurPass() {
    const quad = new lib.FullScreenQuad(null);
    const mat = makeShaderMaterial(buildMotionBlurVelocityGlsl(), {
      tDiffuse:      { value: null },
      tDepth:        { value: null },
      tVelocity:     { value: null },
      uInvViewProj:  { value: new THREE.Matrix4() },
      uPrevViewProj: { value: new THREE.Matrix4() },
      uShutter:      { value: 0 },
      uMaxUv:        { value: 0 },
      uHistoryValid: { value: 0 },
      uTsrMvOn:      { value: 0 },
    });
    const curVP = new THREE.Matrix4();
    const prevVP = new THREE.Matrix4();
    const invVP = new THREE.Matrix4();
    let prevValid = false;
    let shutter = 0;
    let maxUv = 0;
    return {
      enabled: true,
      needsSwap: true,
      clear: false,
      renderToScreen: false,
      setSize() {},
      applyState(st) {
        if (!st || !st.mbOn) {
          prevValid = false;
          shutter = 0;
          return;
        }
        shutter = Number.isFinite(st.shutter) ? st.shutter : 0;
        maxUv = Number.isFinite(st.maxUv) ? st.maxUv : 0;
      },
      render(rnd, writeBuffer, readBuffer) {
        const pw = Math.max(1, readBuffer.width | 0);
        const ph = Math.max(1, readBuffer.height | 0);
        const depthTex = sharedDepth.acquire(rnd, pw, ph);


        curVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        invVP.copy(curVP).invert();
        const mvTex = (getMotionVectors ? getMotionVectors() : null) || null;
        const tsrSt = (getTsrState ? getTsrState() : null);
        const mvOn = !!(tsrSt && tsrSt.mvOn && mvTex);
        const u = mat.uniforms;
        u.tDiffuse.value = readBuffer.texture;
        u.tDepth.value = depthTex;
        u.tVelocity.value = mvOn ? mvTex : null;
        u.uInvViewProj.value.copy(invVP);
        u.uPrevViewProj.value.copy(prevValid ? prevVP : curVP);
        u.uShutter.value = shutter;
        u.uMaxUv.value = maxUv;
        u.uHistoryValid.value = prevValid ? 1 : 0;
        u.uTsrMvOn.value = mvOn ? 1 : 0;
        quad.material = mat;
        rnd.setRenderTarget(this.renderToScreen ? null : writeBuffer);
        quad.render(rnd);


        prevVP.copy(vpNoJitValid ? vpNoJit : curVP);
        prevValid = true;
      },
      dispose() {
        try { mat.dispose(); } catch (_e) {                       }
        try { quad.dispose(); } catch (_e) {                       }
      },
    };
  }


  function createTaaLitePass() {
    const quad = new lib.FullScreenQuad(null);
    const accumMat = makeShaderMaterial(buildTemporalVelocityGlsl(), {
      tCurrent:      { value: null },
      tHistory:      { value: null },
      tDepth:        { value: null },
      tVelocity:     { value: null },
      uInvViewProj:  { value: new THREE.Matrix4() },
      uPrevViewProj: { value: new THREE.Matrix4() },
      uTexel:        { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
      uAlpha:        { value: 1 },
      uHistoryValid: { value: 0 },
      uByteEnc:      { value: 0 },
      uByteRange:    { value: BYTE_HISTORY_RANGE },
      uMvOn:         { value: 0 },


      uTemporalAlpha: { value: 0 },
    });
    const copyMat = makeShaderMaterial(
      ["uniform sampler2D tDiffuse;", "varying vec2 vUv;", "void main() { gl_FragColor = texture2D(tDiffuse, vUv); }"].join("\n"),
      { tDiffuse: { value: null } },
    );
    const curVP = new THREE.Matrix4();
    const prevVP = new THREE.Matrix4();
    const invVP = new THREE.Matrix4();
    let histA = null;
    let histB = null;
    let allocW = 0;
    let allocH = 0;
    let frames = 0;
    let historyValid = false;
    function makeHistRT(w, h) {


      return new THREE.WebGLRenderTarget(Math.max(1, w | 0), Math.max(1, h | 0), {
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
      });
    }
    function release() {
      if (histA) histA.dispose();
      if (histB) histB.dispose();
      histA = null;
      histB = null;
      allocW = 0;
      allocH = 0;
    }
    function reset() {
      frames = 0;
      historyValid = false;
    }
    function ensure(w, h) {
      if (allocW === w && allocH === h && histA) return;
      release();
      allocW = w;
      allocH = h;
      histA = makeHistRT(w, h);
      histB = makeHistRT(w, h);
      reset();
    }
    return {
      enabled: true,
      needsSwap: true,
      clear: false,
      renderToScreen: false,
      setSize() {

      },
      isConverged() {
        return frames >= MAX_HISTORY_FRAMES;
      },
      render(rnd, writeBuffer, readBuffer) {
        const pw = Math.max(1, readBuffer.width | 0);
        const ph = Math.max(1, readBuffer.height | 0);
        ensure(pw, ph);
        const depthTex = sharedDepth.acquire(rnd, pw, ph);
        curVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        invVP.copy(curVP).invert();
        const u = accumMat.uniforms;

        const mvTex = (getMotionVectors ? getMotionVectors() : null) || null;
        const tsrSt2 = (getTsrState ? getTsrState() : null);
        const mvOn2 = !!(tsrSt2 && tsrSt2.mvOn && mvTex);
        u.tCurrent.value = readBuffer.texture;
        u.tHistory.value = histA.texture;
        u.tDepth.value = depthTex;
        u.tVelocity.value = mvOn2 ? mvTex : null;
        u.uInvViewProj.value.copy(invVP);


        u.uPrevViewProj.value.copy(historyValid ? prevVP : curVP);
        u.uTexel.value.set(1 / pw, 1 / ph);
        u.uAlpha.value = blendAlpha(frames);
        u.uHistoryValid.value = historyValid ? 1 : 0;
        u.uMvOn.value = mvOn2 ? 1 : 0;


        quad.material = accumMat;
        rnd.setRenderTarget(histB);
        quad.render(rnd);
        copyMat.uniforms.tDiffuse.value = histB.texture;
        quad.material = copyMat;
        rnd.setRenderTarget(this.renderToScreen ? null : writeBuffer);
        quad.render(rnd);
        const swap = histA;
        histA = histB;
        histB = swap;


        prevVP.copy(vpNoJitValid ? vpNoJit : curVP);
        frames = Math.min(frames + 1, MAX_HISTORY_FRAMES);
        historyValid = true;
      },
      dispose() {
        release();
        try { accumMat.dispose(); } catch (_e) {                       }
        try { copyMat.dispose(); } catch (_e) {                       }
        try { quad.dispose(); } catch (_e) {                       }
      },
    };
  }


  function makeLedgerMarkerPass() {
    return {
      enabled: true,
      needsSwap: false,
      clear: false,
      renderToScreen: false,
      setSize() {},
      dispose() {},
      render() {
        const pt = getPassTiming ? getPassTiming() : null;
        if (pt && typeof pt.begin === "function") pt.begin("postfx");
      },
    };
  }


  function createSharpenPass() {
    const quad = new lib.FullScreenQuad(null);
    const mat = makeShaderMaterial(buildCasGlsl(), {
      tDiffuse: { value: null },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uPeak: { value: 0 },
    });


    mat.precision = "mediump";
    return {
      enabled: true,
      needsSwap: false,
      clear: false,
      renderToScreen: true,
      peak: 0,
      setParams(st) {
        const p = st && Number.isFinite(Number(st.peak)) ? Number(st.peak) : 0;


        this.peak = p < -SHARPEN_PEAK_MAX ? -SHARPEN_PEAK_MAX : p > 0 ? 0 : p;
      },
      setSize() {},
      render(rnd, writeBuffer, readBuffer) {
        const pt = getPassTiming ? getPassTiming() : null;
        if (pt && typeof pt.begin === "function") pt.begin("nitidez-upscale");
        const rb = readBuffer && readBuffer.texture ? readBuffer : null;
        mat.uniforms.tDiffuse.value = rb ? rb.texture : null;


        const fpr = rnd && typeof rnd.getPixelRatio === "function" ? rnd.getPixelRatio() : 1;
        const bw = rb && rb.width > 0 ? rb.width : Math.max(1, Math.round(size.w * fpr));
        const bh = rb && rb.height > 0 ? rb.height : Math.max(1, Math.round(size.h * fpr));
        mat.uniforms.uTexel.value.set(1 / Math.max(1, bw), 1 / Math.max(1, bh));
        mat.uniforms.uPeak.value = this.peak;
        quad.material = mat;
        rnd.setRenderTarget(this.renderToScreen ? null : writeBuffer);
        quad.render(rnd);
      },
      dispose() {
        try { mat.dispose(); } catch (_e) {                       }
        try { quad.dispose(); } catch (_e) {                       }
      },
    };
  }


  function createLocalExposurePass() {
    const quad = new lib.FullScreenQuad(null);


    const downMat = makeShaderMaterial(buildLeDownsampleGlsl(), {
      tDiffuse: { value: null },
      uSrcTexel: { value: new THREE.Vector2(0, 0) },
    });
    const blurMat = makeShaderMaterial(buildLeBlurGlsl(), {
      tGuide: { value: null },
      uStep: { value: new THREE.Vector2(0, 0) },
      uRangeInv: { value: leRangeInvEnc(LE_RANGE_SIGMA) },
    });
    let rtA = null;
    let rtB = null;
    let gw = 0;
    let gh = 0;


    let retireA = null;
    let retireB = null;
    let rangeInv = leRangeInvEnc(LE_RANGE_SIGMA);
    function ensure(w, h) {
      const tw = Math.max(1, Math.round(w / LE_GUIDE_DIV));
      const th = Math.max(1, Math.round(h / LE_GUIDE_DIV));
      if (rtA && tw === gw && th === gh) return;
      retireA = rtA;
      retireB = rtB;
      rtA = makeRT(tw, th);
      rtB = makeRT(tw, th);
      gw = tw;
      gh = th;
    }
    function blitTo(rnd, mat, target) {
      quad.material = mat;
      rnd.setRenderTarget(target);
      quad.render(rnd);
    }
    return {
      enabled: true,
      needsSwap: false,
      clear: false,
      renderToScreen: false,


      setParams(plan) {
        if (retireA) { retireA.dispose(); retireA = null; }
        if (retireB) { retireB.dispose(); retireB = null; }
        rangeInv = plan && Number.isFinite(plan.rangeInvEnc) ? plan.rangeInvEnc : leRangeInvEnc(LE_RANGE_SIGMA);
      },


      texture() {
        return rtA ? rtA.texture : null;
      },


      guideTexelX() {
        return rtA && rtA.width > 0 ? 1 / rtA.width : 0;
      },
      guideTexelY() {
        return rtA && rtA.height > 0 ? 1 / rtA.height : 0;
      },
      setSize() {

      },
      render(rnd, _writeBuffer, readBuffer) {
        if (retireA) { retireA.dispose(); retireA = null; }
        if (retireB) { retireB.dispose(); retireB = null; }
        const rb = readBuffer && readBuffer.texture ? readBuffer : null;
        if (!rb) return;
        ensure(rb.width, rb.height);
        downMat.uniforms.tDiffuse.value = rb.texture;

        downMat.uniforms.uSrcTexel.value.set(1 / Math.max(1, rb.width), 1 / Math.max(1, rb.height));
        blitTo(rnd, downMat, rtA);
        blurMat.uniforms.uRangeInv.value = rangeInv;
        blurMat.uniforms.tGuide.value = rtA.texture;
        blurMat.uniforms.uStep.value.set(1 / gw, 0);
        blitTo(rnd, blurMat, rtB);
        blurMat.uniforms.tGuide.value = rtB.texture;
        blurMat.uniforms.uStep.value.set(0, 1 / gh);
        blitTo(rnd, blurMat, rtA);
        rnd.setRenderTarget(null);
      },
      dispose() {
        if (retireA) { retireA.dispose(); retireA = null; }
        if (retireB) { retireB.dispose(); retireB = null; }
        if (rtA) rtA.dispose();
        if (rtB) rtB.dispose();
        rtA = null;
        rtB = null;
        gw = 0;
        gh = 0;
        downMat.dispose();
        blurMat.dispose();
        quad.dispose();
      },
    };
  }

  function lightingInst() {
    try {
      const dm = store.getDataModel && store.getDataModel();
      return dm ? getService(dm, "Lighting") : null;
    } catch (_e) {
      return null;
    }
  }


  let fxScanDirty = true;                                                    
  let fxParamsDirty = true;                                               
  let fxCache = [];
  let fxSigCache = "";
  let fxDmRef = null;                                                       
  const fxOnProp = (e) => {
    const inst = e && e.instance;
    if (!inst || !EFFECT_CLASSES[inst.className]) return;
    fxParamsDirty = true;
    if (e.property === "Enabled") fxScanDirty = true;
  };
  const fxOnTree = (e) => {


    const inst = (e && (e.child || e.instance)) || null;
    if (inst && inst.className && !EFFECT_CLASSES[inst.className]) return;
    fxScanDirty = true;
  };
  const fxSubs = [
    bus.on(Events.PropertyChanged, fxOnProp),
    bus.on(Events.ChildAdded, fxOnTree),
    bus.on(Events.ChildRemoved, fxOnTree),
    bus.on(Events.Destroying, fxOnTree),
  ];

  function activeEffects() {
    const li = lightingInst();
    if (!li || !li.getChildren) return [];
    const counts = {};
    const out = [];
    for (const child of li.getChildren()) {
      if (!EFFECT_CLASSES[child.className]) continue;
      if (child.getProperty("Enabled") === false) continue;
      counts[child.className] = (counts[child.className] || 0) + 1;
      if (counts[child.className] > MAX_PER_TYPE) continue;
      out.push(child);
    }
    return out;
  }

  function disposePass(p) {
    try {
      if (p && typeof p.dispose === "function") p.dispose();
    } catch (_e) {

    }
  }

  function makePassesFor(inst) {
    switch (inst.className) {
      case "BlurEffect":
        return [createBlurPass()];
      case "BloomEffect":
        return [createBloomPass()];
      case "ColorCorrectionEffect":
        return [new lib.ShaderPass(makeColorCorrectionShader())];
      case "DepthOfFieldEffect":
        return [createDofPass()];
      case "SunRaysEffect":
        return [createSunRaysPass()];
      default:
        return [];
    }
  }

  function rebuild() {


    const dmNow = (store.getDataModel && store.getDataModel()) || null;
    if (dmNow !== fxDmRef) {
      fxDmRef = dmNow;
      fxScanDirty = true;
    }
    if (fxScanDirty) {
      fxScanDirty = false;
      fxCache = activeEffects();
      let acc = "";
      for (const inst of fxCache) acc += inst.className + ":" + inst.id + "|";
      fxSigCache = acc;
    }
    const fx = fxCache;


    const aoSt = getAoState ? getAoState() : null;
    const aoOn = !!(aoSt && (aoSt.ao || aoSt.contact));

    const mlSt = getMegaLights ? getMegaLights() : null;


    const msmOn = isMegaLightsSmChainWanted(mlSt, requestRender);
    const mlOn = !msmOn && !!(mlSt && mlSt.active && mlSt.lights && mlSt.lights.length > 0);


    const diet = getPostfxDiet ? getPostfxDiet() : null;
    const dietOn = !!(diet && diet.active);
    const photoOn = !!(diet && diet.photo);
    dietState = diet;


    const shp = getUpscaleSharpen ? getUpscaleSharpen() : null;
    const shpOn = !!(shp && shp.active);
    const aeSt = getAutoExposure ? getAutoExposure() : null;         
    const aeOn = !!(aeSt && aeSt.active);


    const vfSt = getVolumetricFog ? getVolumetricFog() : null;
    const vfOn = !!(vfSt && vfSt.active);


    const ssrSt = getSsr ? getSsr() : null;
    const ssrOn = !!(ssrSt && ssrSt.active);


    const le = getLocalExposure ? getLocalExposure() : null;
    const leOn = !!(le && le.active);


    const lf = getLensFlare ? getLensFlare() : null;
    const lfOn = !!(lf && lf.active);


    filmFxNow = getFilmFx ? getFilmFx() : null;
    const taaOn = !!(filmFxNow && filmFxNow.taaOn);
    renderPass.setTemporalEnabled(taaOn);
    const antialiasing = renderPass.getAntialiasingState();
    const spatialAntialiasingOn = antialiasing.mode === "spatial";
    const mbOn = !!(filmFxNow && filmFxNow.mbOn);

    const tsrNow = getTsrState ? getTsrState() : null;
    const mvOn = !!(tsrNow && tsrNow.mvOn);
    const sig = "AA-" + antialiasing.mode + "|" + (taaOn ? "TAA|" : "") + (mbOn ? "MB|" : "") + (mvOn ? "TSR-MV|" : "") + (lfOn ? "FLARE|" : "") + (leOn ? "EXPLOCAL|" : "") + (aeOn ? "EXPO-AUTO|" : "") + (shpOn ? "NITIDEZ|" : "") + (dietOn ? (photoOn ? "DIETA-FOTO|" : "DIETA|") : "") + (ssrOn ? "SSR|" : "") + (vfOn ? "VF|" : "") + (msmOn ? "MSM|" : "") + (mlOn ? "ML|" : "") + (aoOn ? "AO|" : "") + fxSigCache;
    if (sig === signature) return;
    signature = sig;
    fxParamsDirty = true;                                                   
    for (const e of effectPasses) for (const p of e.passes) disposePass(p);
    effectPasses = [];
    fusedInst = null;
    composer.passes.length = 0;
    if (substrateScreen) composer.addPass(substrateScreen.preparePass);
    composer.addPass(renderPass);


    if (mlOn) {
      if (!mlPass) mlPass = createMegaLightsPass({ THREE, camera, FullScreenQuad: lib.FullScreenQuad, sharedDepth });
      mlPass.renderToScreen = false;
      composer.addPass(mlPass);
    } else if (mlPass) {
      disposePass(mlPass);
      mlPass = null;
    }


    if (msmOn) {
      if (!msmPass) msmPass = createMegaLightsSmScreenCompositePass({ THREE, renderer, camera, scene, FullScreenQuad: lib.FullScreenQuad, sharedDepth, getPassTiming, requestRender });
      msmPass.renderToScreen = false;
      composer.addPass(msmPass);
    } else if (msmPass) {
      disposePass(msmPass);
      msmPass = null;
    }
    if (denoisePass) composer.addPass(denoisePass);


    if (aoOn) {
      if (!aoPass) aoPass = createAoPass({ THREE, lib, camera, sharedDepth });
      aoPass.renderToScreen = false;
      composer.addPass(aoPass);
    } else if (aoPass) {
      disposePass(aoPass);
      aoPass = null;
    }
    if (substrateScreen) {
      composer.addPass(substrateScreen.waterPass);
      composer.addPass(substrateScreen.subsurfacePass);
      composer.addPass(substrateScreen.oitPass);
    }


    if (getPassTiming) {
      if (!markerPass) markerPass = makeLedgerMarkerPass();
      composer.addPass(markerPass);
    }


    if (ssrOn) {
      if (!ssrPass) ssrPass = createSsrPass({ THREE, camera, FullScreenQuad: lib.FullScreenQuad, sharedDepth });
      ssrPass.renderToScreen = false;
      composer.addPass(ssrPass);
    } else if (ssrPass) {
      disposePass(ssrPass);
      ssrPass = null;
    }


    if (taaOn) {
      if (!taaPass) taaPass = createTaaLitePass();
      taaPass.renderToScreen = false;
      composer.addPass(taaPass);
    } else if (taaPass) {
      disposePass(taaPass);
      taaPass = null;
    }
    if (mbOn) {
      if (!mbPass) mbPass = createMotionBlurPass();
      mbPass.renderToScreen = false;
      composer.addPass(mbPass);
    } else if (mbPass) {
      disposePass(mbPass);
      mbPass = null;
    }


    if (aeOn) {
      if (!aePass) aePass = createAutoExposurePass({ THREE, renderer, FullScreenQuad: lib.FullScreenQuad });
      composer.addPass(aePass);
    } else if (aePass) {
      disposePass(aePass);
      aePass = null;
    }


    leOnNow = leOn;
    if (leOn) {
      if (!lePass) lePass = createLocalExposurePass();
      composer.addPass(lePass);
    } else if (lePass) {
      disposePass(lePass);
      lePass = null;
    }


    if (vfOn) {
      if (!vfPass) {


        vfPass = createVolumetricFogPass({
          THREE,
          camera,
          FullScreenQuad: lib.FullScreenQuad,
          sharedDepth,
          localLightPatchRegistry: getLocalLightPatchRegistry ? getLocalLightPatchRegistry() : null,
        });
        if (setLocalVolumetricPassExtension) {
          setLocalVolumetricPassExtension(vfPass.getLocalVolumetricExtension());
        }
      }
      vfPass.renderToScreen = false;
      composer.addPass(vfPass);
    } else if (vfPass) {
      disposePass(vfPass);
      vfPass = null;


      if (setLocalVolumetricPassExtension) setLocalVolumetricPassExtension(null);
    }


    const renderList = [];
    const renderClasses = [];
    for (const inst of fx) {


      const drop = (dietOn && !photoOn && inst.className === "DepthOfFieldEffect") ||
        (vfOn && inst.className === "SunRaysEffect");
      if (drop) {
        effectPasses.push({ inst, className: inst.className, passes: [] });
        continue;
      }
      renderList.push(inst);
      renderClasses.push(inst.className);
    }
    const fuseIdx = fuseTrailingCcIndex(renderClasses, !!(diet && diet.fuseFinal));
    for (let i = 0; i < renderList.length; i++) {
      const inst = renderList[i];
      if (i === fuseIdx) {

        fusedInst = inst;
        effectPasses.push({ inst, className: inst.className, passes: [], fused: true });
        continue;
      }
      const passes = makePassesFor(inst);
      for (const p of passes) {
        p.renderToScreen = false;

        if (typeof p.setDiet === "function") p.setDiet(diet);
        composer.addPass(p);
      }
      effectPasses.push({ inst, className: inst.className, passes });
    }


    if (lfOn) {
      if (!lfPass) lfPass = createLensFlarePass();
      lfPass.renderToScreen = false;
      composer.addPass(lfPass);
    } else if (lfPass) {
      disposePass(lfPass);
      lfPass = null;
    }
    if (fusedInst) {
      if (!fusedPass) fusedPass = new lib.ShaderPass(makeFusedFinalShader());
      fusedPass.renderToScreen = !shpOn;
      composer.addPass(fusedPass);
    } else {
      gradePass.renderToScreen = !shpOn;
      composer.addPass(gradePass);
    }


    if (spatialAntialiasingOn) composer.addPass(spatialAntialiasingPass);
    sharpenOn = shpOn;
    if (shpOn) {
      if (!sharpenPass) sharpenPass = createSharpenPass();
      sharpenPass.renderToScreen = true;
      composer.addPass(sharpenPass);
    }
  }


  let hdrState = null;
  let ccClampFed = 4;


  let lutTex = null;
  let lutTexSig = "";
  function ensureLutTexture(lut) {
    if (!lut || !lut.data || !lut.width || !lut.height) return null;


    const maxTex = renderer && renderer.capabilities && renderer.capabilities.maxTextureSize ? renderer.capabilities.maxTextureSize : 0;
    if (maxTex && lut.width > maxTex) {
      if (lutTexSig !== "over|" + lut.signature) {
        lutTexSig = "over|" + lut.signature;
        if (lutTex) {
          try { lutTex.dispose(); } catch (_e) {                     }
          lutTex = null;
        }
        try { console.warn("[postfx IL-F31] LUT " + lut.size + "³ (" + lut.width + "px) excede MAX_TEXTURE_SIZE (" + maxTex + ") — LUT ignorada."); } catch (_e) {                            }
      }
      return null;
    }
    if (lutTex && lutTexSig === lut.signature) return lutTex;
    if (lutTex) {
      try { lutTex.dispose(); } catch (_e) {                             }
    }
    const tex = new THREE.DataTexture(lut.data, lut.width, lut.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.flipY = false;

    if ("colorSpace" in tex && THREE.NoColorSpace !== undefined) tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    lutTex = tex;
    lutTexSig = lut.signature;
    return lutTex;
  }


  let bloomEnergyQa = null;

  function updateParams() {

    if (aoPass) aoPass.setParams(getAoState ? getAoState() : null);


    if (setAoMask) setAoMask(aoPass && typeof aoPass.getMask === "function" ? aoPass.getMask() : null);


    if (fxParamsDirty) {
      fxParamsDirty = false;


      let sawBloomFx = false;


      if (fusedPass) {
        const fu = fusedPass.uniforms;
        if (fusedInst) {
          fu.uCcOn.value = 1;
          fu.uCcBrightness.value = clampNumber(Number(fusedInst.getProperty("Brightness")), -1, 1, 0);
          fu.uCcContrast.value = clampNumber(Number(fusedInst.getProperty("Contrast")), -1, 1, 0);
          fu.uCcSaturation.value = clampNumber(Number(fusedInst.getProperty("Saturation")), -1, 1, 0);
          const fTint = fusedInst.getProperty("TintColor") || { r: 1, g: 1, b: 1 };
          fu.uCcTint.value.set(fTint.r, fTint.g, fTint.b);
        } else {
          fu.uCcOn.value = 0;
        }
      }
      for (const e of effectPasses) {
        if (!e.passes.length) continue;                                          
        const inst = e.inst;
        if (e.className === "BlurEffect") {
          e.passes[0].setParams(Number(inst.getProperty("Size")));
        } else if (e.className === "BloomEffect") {


          const bloomRaw = {
            intensity: Number(inst.getProperty("Intensity")),
            size: Number(inst.getProperty("Size")),
            threshold: Number(inst.getProperty("Threshold")),
            mode: inst.getProperty("Mode"),
            anamorphic: Number(inst.getProperty("Anamorphic")),
            dirt: Number(inst.getProperty("Dirt")),
          };
          sawBloomFx = true;
          bloomEnergyQa = energyBloomPlan(bloomRaw);                     
          e.passes[0].setParams(bloomRaw);
        } else if (e.className === "ColorCorrectionEffect") {
          const u = e.passes[0].uniforms;
          u.uBrightness.value = clampNumber(Number(inst.getProperty("Brightness")), -1, 1, 0);
          u.uContrast.value = clampNumber(Number(inst.getProperty("Contrast")), -1, 1, 0);
          u.uSaturation.value = clampNumber(Number(inst.getProperty("Saturation")), -1, 1, 0);
          const tint = inst.getProperty("TintColor") || { r: 1, g: 1, b: 1 };
          u.uTint.value.set(tint.r, tint.g, tint.b);
        } else if (e.className === "DepthOfFieldEffect") {
          e.passes[0].setParams({
            focusDistance: Number(inst.getProperty("FocusDistance")),
            inFocusRadius: Number(inst.getProperty("InFocusRadius")),
            nearIntensity: Number(inst.getProperty("NearIntensity")),
            farIntensity: Number(inst.getProperty("FarIntensity")),
          });
        } else if (e.className === "SunRaysEffect") {
          e.passes[0].setParams({
            intensity: Number(inst.getProperty("Intensity")),
            spread: Number(inst.getProperty("Spread")),
          });
        }
      }


      if (!sawBloomFx) bloomEnergyQa = null;
    }


    for (const e of effectPasses) {
      if (e.className === "SunRaysEffect" && e.passes.length) {
        e.passes[0].setSun(getSunInfo ? getSunInfo() : null);
      }
    }
  }

  function updateGrade() {
    const g = getGrade ? getGrade() : null;
    if (!g) return;

    const u = (fusedInst && fusedPass ? fusedPass : gradePass).uniforms;
    u.uExposure.value = g.exposure;
    u.uBright.value = g.bright;
    u.uTint.value.set(g.tint.r, g.tint.g, g.tint.b);
    u.uPunch.value = g.punch;
    u.uLift.value = g.lift;
    if (u.uAutoExposure) u.uAutoExposure.value = aePass && typeof aePass.getScale === "function" ? aePass.getScale() : 1;         


    if (u.uTonemap) u.uTonemap.value = g.tonemap | 0;


    const grPlan = g.grading || null;
    if (u.uWbOn) {
      const wbOn = !!(grPlan && grPlan.wb && grPlan.wb.on && Array.isArray(grPlan.wb.mat));
      u.uWbOn.value = wbOn ? 1 : 0;
      if (wbOn) u.uWbMat.value.fromArray(grPlan.wb.mat);
      const wh = grPlan && grPlan.wheels && grPlan.wheels.on ? grPlan.wheels : null;
      u.uGradeOn.value = wh ? 1 : 0;
      if (wh) {
        u.uGradeLift.value.fromArray(wh.lift);
        u.uGradeGamma.value.fromArray(wh.gamma);
        u.uGradeGain.value.fromArray(wh.gain);
        u.uGradeSatZone.value.fromArray(wh.satZone);
        u.uGradeConZone.value.fromArray(wh.conZone);
      }
      const lutPlan = grPlan && grPlan.lut && grPlan.lut.on ? grPlan.lut : null;
      const lutTexNow = lutPlan ? ensureLutTexture(lutPlan) : null;
      u.uLutOn.value = lutTexNow ? 1 : 0;
      u.tLut.value = lutTexNow;
      if (lutTexNow) {
        u.uLutSize.value = lutPlan.size;
        u.uLutAmount.value = lutPlan.amount;
        u.uLutDomainMul.value.fromArray(lutPlan.domainMul);
        u.uLutDomainAdd.value.fromArray(lutPlan.domainAdd);
      }
    }


    const leNow = getLocalExposure ? getLocalExposure() : null;
    const leTex = lePass && typeof lePass.texture === "function" ? lePass.texture() : null;
    const leReady = !!(leOnNow && leNow && leNow.active && leTex);
    if (u.uLeOn) {
      u.uLeOn.value = leReady ? 1 : 0;
      u.tLeGuide.value = leReady ? leTex : null;
      if (leReady) {
        u.uLeStrength.value = leNow.strength;

        if (u.uLeGuideTexel && lePass && typeof lePass.guideTexelX === "function") {
          u.uLeGuideTexel.value.set(lePass.guideTexelX(), lePass.guideTexelY());
        }


        const leAe = u.uAutoExposure && Number.isFinite(u.uAutoExposure.value) ? u.uAutoExposure.value : 1;
        const leExp = (Number.isFinite(g.exposure) ? g.exposure : 1) * (Number.isFinite(g.bright) ? g.bright : 1) * leAe;
        u.uLeMidLog.value = leNow.midLog - Math.log2(Math.max(leExp, 1e-6));
        u.uLeMaxStops.value = leNow.maxStops;
      }
    }


    if (u.uFxCa) {
      const ff = filmFxNow;
      const caNow = ff && Number.isFinite(ff.ca) ? ff.ca : 0;
      const grainNow = ff && Number.isFinite(ff.grain) ? ff.grain : 0;
      u.uFxCa.value = caNow;
      u.uFxGrain.value = grainNow;
      if (grainNow > 0.0001) fxFrame = (fxFrame + 1) % GRAIN_FRAME_WRAP;
      u.uFxFrame.value = fxFrame;
    }


    const smLite = fusedInst && fusedPass && g.smLite && g.smLite.on === true ? g.smLite : null;
    if (u.uVignette) u.uVignette.value = smLite && Number.isFinite(smLite.vignette) ? smLite.vignette : 0;
    if (smLite && Array.isArray(smLite.gradeTint) && smLite.gradeTint.length === 3) {
      u.uTint.value.set(g.tint.r * smLite.gradeTint[0], g.tint.g * smLite.gradeTint[1], g.tint.b * smLite.gradeTint[2]);
      u.uPunch.value = g.punch * (Number.isFinite(smLite.gradePunch) ? smLite.gradePunch : 1);
    }
  }

  function render(w, h) {
    if (disposed || failed || !composer) return false;
    if (w !== size.w || h !== size.h || drawingBufferSize.x !== renderer.domElement.width || drawingBufferSize.y !== renderer.domElement.height) setSize(w, h);
    rebuild();
    updateParams();
    updateGrade();


    hdrState = getHdrPipeline ? getHdrPipeline() : null;
    const ccCap = hdrState && Number.isFinite(hdrState.ccClampMax) && hdrState.ccClampMax > 0 ? hdrState.ccClampMax : 4;
    ccClampFed = ccCap;
    if (fusedPass && fusedPass.uniforms.uCcClampMax) fusedPass.uniforms.uCcClampMax.value = ccCap;
    for (const e of effectPasses) {
      if (e.className !== "ColorCorrectionEffect" || !e.passes.length) continue;
      const u0 = e.passes[0].uniforms;
      if (u0 && u0.uCcClampMax) u0.uCcClampMax.value = ccCap;
    }


    if (sharpenOn && sharpenPass) sharpenPass.setParams(getUpscaleSharpen ? getUpscaleSharpen() : null);

    if (lePass) lePass.setParams(getLocalExposure ? getLocalExposure() : null);
    if (mlPass) mlPass.applyState(getMegaLights ? getMegaLights() : null);          
    if (msmPass) {
      msmPass.applyState(getMegaLights ? getMegaLights() : null);
      if (msmPass.enabled && !msmPass.isConverged() && requestRender) requestRender();
    }                                                             
    if (aePass) aePass.applyState(getAutoExposure ? getAutoExposure() : null);         
    if (ssrPass) ssrPass.applyState(getSsr ? getSsr() : null);          
    if (vfPass) vfPass.applyState(getVolumetricFog ? getVolumetricFog() : null);          

    if (lfPass) {
      lfPass.applyState(getLensFlare ? getLensFlare() : null);
      lfPass.setSun(getSunInfo ? getSunInfo() : null);
    }
    if (denoisePass) {
      denoisePass.applyState(getShadowTemporal ? getShadowTemporal() : null);


      if (denoisePass.enabled && !denoisePass.isConverged() && requestRender) requestRender();
    }


    if (mbPass) mbPass.applyState(filmFxNow);
    if (taaPass && !taaPass.isConverged() && requestRender) requestRender();
    if (filmFxNow && filmFxNow.grain > 0.0001 && requestRender) requestRender();

    sharedDepth.beginFrame();


    camera.updateMatrixWorld();
    vpNoJit.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    vpNoJitValid = true;
    let _jitApplied = false;
    let _jitE8 = 0;
    let _jitE9 = 0;
    if (taaPass && filmFxNow && filmFxNow.taaOn) {
      const _jit = jitterForFrame(tsrJitterFrame);


      const _ndc = jitterToNdc(_jit.x, _jit.y, drawingBufferSize.x, drawingBufferSize.y);
      _jitE8 = camera.projectionMatrix.elements[8];
      _jitE9 = camera.projectionMatrix.elements[9];
      camera.projectionMatrix.elements[8] += _ndc.x;
      camera.projectionMatrix.elements[9] += _ndc.y;
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      _jitApplied = true;
      tsrJitterFrame = (tsrJitterFrame + 1) % TSR_JITTER_COUNT;
    }


    try {
      composer.render();
    } finally {
      if (msmPass && msmPass.afterRender) msmPass.afterRender();
      if (substrateScreen) substrateScreen.restorePass.render();

      if (_jitApplied) {
        camera.projectionMatrix.elements[8] = _jitE8;
        camera.projectionMatrix.elements[9] = _jitE9;
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      }
    }
    return true;
  }

  function setSize(w, h) {
    size.w = Math.max(1, w | 0);
    size.h = Math.max(1, h | 0);
    fxParamsDirty = true;                                                      
    if (composer) {
      renderer.getDrawingBufferSize(drawingBufferSize);
      composer.setSize(drawingBufferSize.x, drawingBufferSize.y);
      renderPass.setSize(drawingBufferSize.x, drawingBufferSize.y);
    }
  }

  function dispose() {
    disposed = true;

    if (lutTex) {
      try { lutTex.dispose(); } catch (_e) {                        }
      lutTex = null;
      lutTexSig = "";
    }
    for (const off of fxSubs) {
      try {
        if (typeof off === "function") off();
      } catch (_e) {

      }
    }
    fxSubs.length = 0;
    shaderDiet.dispose();                                                                   
    for (const e of effectPasses) for (const p of e.passes) disposePass(p);
    effectPasses = [];
    disposePass(renderPass);
    renderPass = null;
    disposePass(spatialAntialiasingPass);
    spatialAntialiasingPass = null;
    disposePass(denoisePass);
    denoisePass = null;
    if (substrateScreen) substrateScreen.dispose();
    substrateScreen = null;
    disposePass(mlPass); mlPass = null;          
    disposePass(msmPass); msmPass = null;           
    disposePass(vfPass); vfPass = null;          
    disposePass(lfPass); lfPass = null;          
    disposePass(ssrPass); ssrPass = null;          
    disposePass(taaPass); taaPass = null;          
    disposePass(mbPass); mbPass = null;          
    disposePass(aoPass);
    aoPass = null;
    disposePass(gradePass);
    disposePass(fusedPass);       
    fusedPass = null;
    disposePass(sharpenPass);       
    disposePass(lePass);         
    lePass = null;
    sharpenPass = null;
    disposePass(aePass);         
    aePass = null;
    markerPass = null;
    sharedDepth.dispose();
    if (composer && typeof composer.dispose === "function") composer.dispose();
    composer = null;
  }


  if (typeof window !== "undefined") {
    window.__rswPostfxDiet = {
      get: () => ({
        plan: dietState || null,
        antialiasing: renderPass ? renderPass.getAntialiasingState() : null,
        fusedActive: !!fusedInst,
        fusedClassName: fusedInst ? fusedInst.className : null,
        dropped: effectPasses.filter((e) => !e.passes.length && !e.fused).map((e) => e.className),


        bloomEnergy: bloomEnergyQa,


        hdr: {
          renderStyle: hdrState ? hdrState.renderStyle : null,
          realistic: !!(hdrState && hdrState.realistic),
          ccClampMax: ccClampFed,
          byteFallback: !!(hdrState && hdrState.byteFallback),
          chainHalfFloat: !!(composer && composer.renderTarget1 && composer.renderTarget1.texture && composer.renderTarget1.texture.type === THREE.HalfFloatType),
          internalRtByte: shaderDiet.active(),
        },
        chain: composer
          ? composer.passes.map((p) => {
              if (p === renderPass) return "cena";
              if (p === spatialAntialiasingPass) return "spatial-antialiasing";
              if (p === markerPass) return "marcador-postfx";
              if (p === denoisePass) return "denoise";
              if (substrateScreen && p === substrateScreen.preparePass) return "substrate-prepare";
              if (substrateScreen && p === substrateScreen.waterPass) return "substrate-water";
              if (substrateScreen && p === substrateScreen.subsurfacePass) return "substrate-sss";
              if (substrateScreen && p === substrateScreen.oitPass) return "substrate-oit";
              if (p === mlPass) return "megaLights";
              if (p === msmPass) return "megaLightsSm";           
              if (p === vfPass) return "fogVolumetrico";          
              if (p === lfPass) return "lensFlare";          
              if (p === ssrPass) return "ssr";          
              if (p === aoPass) return "ao";
              if (p === taaPass) return "taa-lite";          
              if (p === mbPass) return "motion-blur";          
              if (p === gradePass) return "grade";
              if (p === fusedPass) return "grade-fundido";
              if (p === sharpenPass) return "nitidez-upscale";       
              if (p === lePass) return "exposicao-local";         
      if (p === aePass) return "auto-exposure";         
              return "efeito";
            })
          : [],
      }),
    };
  }

  return {
    render, setSize, dispose,
    getSceneRenderTarget: () => disposed || failed ? null : composer?.readBuffer ?? null,
    isPreparingForDisplay: () => !disposed && !failed && !composer,
  };
}
