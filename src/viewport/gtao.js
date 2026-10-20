import {
  AO_LITE_GOLDEN,
  AO_LITE_LUT_SIZE,
  AO_LITE_TAPS,
  AO_MAX_SLICES,
  AO_MAX_STEPS,
  IGN_MAGIC,
  aoLiteTargetSize,
  aoTargetSize,
  falloffLutValues,
  sanitizeAoSettings,
} from "../lighting/aoCore.js";
import {
  BYTE_HISTORY_RANGE,
  MAX_HISTORY_FRAMES,
  blendAlpha,
  buildTemporalGlsl,
} from "../lighting/shadowDenoiseCore.js";
import { geomSampleGlsl } from "../lighting/sharedGeomCore.js";
import { frameJitter, sanitizeSkyBentSettings } from "../lighting/skyVisCore.js";
import { contactLocalGlsl, contactShadowGlsl, glslFloat } from "./contactShadows.js";

import { sanitizeContactFuse } from "../lighting/contactFuseCore.js";

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const DIST_GLSL = `
float rswDist(vec2 uv) {
  float z = unpackRGBAToDepth(texture2D(tDepth, uv));
  return -perspectiveDepthToViewZ(z, uNear, uFar);
}
`;

export function createAoPass({ THREE, lib, camera, sharedDepth }) {


  if (!sharedDepth) throw new Error("createAoPass: sharedDepth é obrigatório");
  const cfg = sanitizeAoSettings({});
  const cfgSky = sanitizeSkyBentSettings({});
  const quad = new lib.FullScreenQuad(null);
  let state = null;                                                          
  let pw = 1;
  let ph = 1;
  let allocW = 0;
  let allocH = 0;
  let aoRT = null;
  let blurRT = null;


  let tsrA = null;
  let tsrB = null;
  let tsrW = 0;
  let tsrH = 0;
  let tsrFrames = 0;
  let tsrValid = false;
  let lastResetCount = null;


  let liteMat = null;
  let liteLut = null;
  let liteFrame = 0;
  let allocLite = false;

  function makeMat(fragmentShader, uniforms) {
    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
  }

  const copyMat = makeMat(
    `
uniform sampler2D tDiffuse;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(tDiffuse, vUv);
}
`,
    { tDiffuse: { value: null } },
  );


  const tsrMat = makeMat(buildTemporalGlsl(), {
    tCurrent: { value: null },
    tHistory: { value: null },
    tDepth: { value: null },
    uInvViewProj: { value: new THREE.Matrix4() },
    uPrevViewProj: { value: new THREE.Matrix4() },
    uTexel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
    uAlpha: { value: 1 },
    uHistoryValid: { value: 0 },


    uByteEnc: { value: 0 },
    uByteRange: { value: BYTE_HISTORY_RANGE },


    uTemporalAlpha: { value: 1 },
  });
  const curVP = new THREE.Matrix4();
  const prevVP = new THREE.Matrix4();
  const invVP = new THREE.Matrix4();


  const aoMat = makeMat(
    `
#include <packing>
varying vec2 vUv;
uniform sampler2D tDepth;
uniform float uNear;
uniform float uFar;
uniform vec2 uInvProj;
uniform vec2 uTexel;
uniform float uAoOn;
uniform float uCsOn;
uniform float uRadius;
uniform float uPower;
uniform float uBias;
uniform int uSlices;
uniform int uAoSteps;
uniform vec3 uCsDir;
uniform float uCsDistance;
uniform float uCsThickness;
uniform int uCsSteps;
uniform float uCsLocalOn;
uniform vec3 uCsLocalPos;
uniform float uCsLocalRange;
uniform int uCsLocalSteps;
uniform float uCsLocalSpread;
uniform float uCsSunScale;
uniform float uFrameJitter;
uniform vec3 uUpView;
uniform float uHemiFrac;
uniform float uBentStr;
uniform sampler2D tGeom;
uniform float uGeomOn;
${DIST_GLSL}
${geomSampleGlsl()}
vec3 rswViewPos(vec2 uv) {
  float d = rswDist(uv);
  vec2 ndc = uv * 2.0 - 1.0;
  return vec3(ndc * uInvProj * d, -d);
}
float rswIgn(vec2 px) {
  return fract(${glslFloat(IGN_MAGIC[0])} * fract(dot(px, vec2(${glslFloat(IGN_MAGIC[1])}, ${glslFloat(IGN_MAGIC[2])}))));
}
${contactShadowGlsl()}
${contactLocalGlsl()}
void main() {
  float dist = rswDist(vUv);
  if (dist >= uFar * 0.98) {
    gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);                                 
    return;
  }
  vec3 pc = rswViewPos(vUv);
  vec3 n = vec3(0.0);                                                                                                              
                                                                           
                                                                         
                                                                         
                                                                         
  if (uGeomOn > 0.5) {
    n = rswGeomNormal(vUv);
  } else {
    vec2 ex = vec2(uTexel.x, 0.0);
    vec2 ey = vec2(0.0, uTexel.y);
    vec3 pr = rswViewPos(vUv + ex);
    vec3 pl = rswViewPos(vUv - ex);
    vec3 pu = rswViewPos(vUv + ey);
    vec3 pd = rswViewPos(vUv - ey);
    vec3 dx = abs(pr.z - pc.z) < abs(pc.z - pl.z) ? pr - pc : pc - pl;
    vec3 dy = abs(pu.z - pc.z) < abs(pc.z - pd.z) ? pu - pc : pc - pd;
    n = normalize(cross(dy, dx));
    if (n.z < 0.0) n = -n;
  }
                                                                            
                                                                  
  float rnd = fract(rswIgn(gl_FragCoord.xy) + uFrameJitter);

  float ao = 1.0;
  vec3 rswBent = n;
  if (uAoOn > 0.5) {
    vec2 duv = min(vec2(0.5) * uRadius / (dist * uInvProj), vec2(0.2));
    float occ = 0.0;
    float taps = 0.0;
    for (int s = 0; s < ${AO_MAX_SLICES}; s++) {
      if (s >= uSlices) break;
      float ang = (float(s) + rnd) * ${glslFloat(Math.PI)} / float(uSlices);
      vec2 sdir = vec2(cos(ang), sin(ang));
      for (int i = 0; i < ${AO_MAX_STEPS}; i++) {
        if (i >= uAoSteps) break;
        float t = (float(i) + rnd) / float(uAoSteps);
        t = t * t;
        vec2 off = sdir * t * duv;
        vec2 uvA = vUv + off;
        vec3 pa = rswViewPos(uvA);
        vec3 va = pa - pc;
        float la = max(length(va), 1e-4);
        float wa = clamp(1.0 - la / uRadius, 0.0, 1.0)
          * step(abs(uvA.x - 0.5), 0.5) * step(abs(uvA.y - 0.5), 0.5);
        float ca = clamp(dot(n, va / la) - uBias, 0.0, 1.0) * wa;
        occ += ca;
        rswBent -= (va / la) * ca;
        vec2 uvB = vUv - off;
        vec3 pb = rswViewPos(uvB);
        vec3 vb = pb - pc;
        float lb = max(length(vb), 1e-4);
        float wb = clamp(1.0 - lb / uRadius, 0.0, 1.0)
          * step(abs(uvB.x - 0.5), 0.5) * step(abs(uvB.y - 0.5), 0.5);
        float cb = clamp(dot(n, vb / lb) - uBias, 0.0, 1.0) * wb;
        occ += cb;
        rswBent -= (vb / lb) * cb;
        taps += 2.0;
      }
    }
    ao = pow(clamp(1.0 - 1.7 * occ / max(taps, 1.0), 0.0, 1.0), uPower);
  }

  float cs = 1.0;
  if (uCsOn > 0.5) {
    cs = rswContactShadow(pc, rnd);
                                                                      
                                                                            
                                                                            
                                                                            
                                                                          
                                                                       
    cs = mix(1.0, cs, uCsSunScale);
                                                                         
                                                                         
                                                                            
    if (uCsLocalOn > 0.5) {
      cs = min(cs, rswContactLocal(pc, rnd));
    }
  }
                                                                        
                                                                           
                                                                           
                                                                 
  float bentTerm = 1.0;
  float specOcc = 1.0;
  if (uAoOn > 0.5 && uBentStr > 0.001) {
    vec3 bn = rswBent / max(length(rswBent), 1e-3);
    float skyN = 0.5 + 0.5 * dot(n, uUpView);
    float skyB = 0.5 + 0.5 * dot(bn, uUpView);
    float ratio = clamp(skyB / max(skyN, 0.05), 0.0, 1.0);
    bentTerm = mix(1.0, ratio, uHemiFrac * uBentStr);
                                                                        
                                                      
                                                                               
                                                                         
                                                                            
                                                                          
                                                                            
                                                                       
                                                                            
                                                                           
                                                 
                                                                
    float coneAlign = clamp(dot(bn, n), 0.0, 1.0);
    specOcc = mix(1.0, coneAlign, 1.0 - ao);
  }
                                                     
                                                             
                                                            
  gl_FragColor = vec4(ao, cs, bentTerm, specOcc);
}
`,
    {
      tDepth: { value: null },
      uNear: { value: 0.1 },
      uFar: { value: 1000 },
      uInvProj: { value: new THREE.Vector2(1, 1) },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uAoOn: { value: 0 },
      uCsOn: { value: 0 },
      uRadius: { value: cfg.aoRadius },
      uPower: { value: cfg.aoPower },
      uBias: { value: cfg.aoBias },
      uSlices: { value: cfg.slices },
      uAoSteps: { value: cfg.aoSteps },
      uCsDir: { value: new THREE.Vector3(0, 1, 0) },
      uCsDistance: { value: cfg.csDistance },
      uCsThickness: { value: cfg.csThickness },
      uCsSteps: { value: cfg.csSteps },


      uCsLocalOn: { value: 0 },
      uCsLocalPos: { value: new THREE.Vector3() },
      uCsLocalRange: { value: 0 },
      uCsLocalSteps: { value: 6 },


      uCsLocalSpread: { value: 0 },

      uCsSunScale: { value: 1 },
      uFrameJitter: { value: 0 },
      uUpView: { value: new THREE.Vector3(0, 1, 0) },
      uHemiFrac: { value: 0 },
      uBentStr: { value: 0 },

      tGeom: { value: null },
      uGeomOn: { value: 0 },
    },
  );


  const blurMat = makeMat(
    `
#include <packing>
varying vec2 vUv;
uniform sampler2D tAo;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uNear;
uniform float uFar;
${DIST_GLSL}
void main() {
  float dc = rswDist(vUv);
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  float accA = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      vec2 uv = vUv + vec2(float(x), float(y)) * uTexel;
      float w = (x == 0 && y == 0) ? 1.0 : 0.5;
      w *= exp(-2.0 * abs(rswDist(uv) - dc));
      vec4 s = texture2D(tAo, uv);
      acc += s.rgb * w;
                                                                    
      accA += s.a * w;
      wsum += w;
    }
  }
  float wn = max(wsum, 1e-4);
  gl_FragColor = vec4(acc / wn, accA / wn);
}
`,
    {
      tAo: { value: null },
      tDepth: { value: null },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.1 },
      uFar: { value: 1000 },
    },
  );


  const compMat = makeMat(
    `
#include <packing>
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tAo;
uniform sampler2D tDepth;
uniform vec2 uHalfTexel;
uniform float uNear;
uniform float uFar;
uniform float uAoIntensity;
uniform float uCsStrength;
                                                                              
uniform float uRswSpecOcc;
${DIST_GLSL}
void main() {
  vec4 base = texture2D(tDiffuse, vUv);
  float dc = rswDist(vUv);
  vec4 accV = vec4(0.0);
  float wsum = 0.0;
  for (int x = 0; x < 2; x++) {
    for (int y = 0; y < 2; y++) {
      vec2 uv = vUv + (vec2(float(x), float(y)) - 0.5) * uHalfTexel;
      float w = 1.0 / (0.001 + abs(rswDist(uv) - dc));
      accV += texture2D(tAo, uv) * w;
      wsum += w;
    }
  }
  vec4 aocs4 = wsum > 0.0 ? accV / wsum : vec4(1.0);
  vec3 aocs = aocs4.xyz;
  float ao = mix(1.0, aocs.x, uAoIntensity);
  float cs = mix(1.0, aocs.y, uCsStrength);
                                                                      
                                                 
                                                                    
                                                                  
  float specOcc = mix(1.0, aocs4.a, uRswSpecOcc);
  gl_FragColor = vec4(base.rgb * ao * cs * aocs.z * specOcc, base.a);
}
`,
    {
      tDiffuse: { value: null },
      tAo: { value: null },
      tDepth: { value: null },
      uHalfTexel: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.1 },
      uFar: { value: 1000 },
      uAoIntensity: { value: cfg.aoIntensity },
      uCsStrength: { value: cfg.csStrength },

      uRswSpecOcc: { value: 0 },
    },
  );

  function release() {
    if (aoRT) aoRT.dispose();
    if (blurRT) blurRT.dispose();
    aoRT = null;
    blurRT = null;
    allocW = 0;
    allocH = 0;
    tsrRelease();
  }



  function tsrRelease() {
    if (tsrA) tsrA.dispose();
    if (tsrB) tsrB.dispose();
    tsrA = null;
    tsrB = null;
    tsrW = 0;
    tsrH = 0;
    tsrFrames = 0;
    tsrValid = false;
  }

  function tsrEnsure(w, h) {
    if (tsrA && tsrW === w && tsrH === h) return;
    tsrRelease();
    tsrW = w;
    tsrH = h;

    const opts = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    };
    tsrA = new THREE.WebGLRenderTarget(w, h, opts);
    tsrB = new THREE.WebGLRenderTarget(w, h, opts);
  }






  function liteEnsure() {
    if (liteMat) return liteMat;
    const lutVals = falloffLutValues(AO_LITE_LUT_SIZE);
    const lutData = new Uint8Array(AO_LITE_LUT_SIZE * 4);
    for (let i = 0; i < AO_LITE_LUT_SIZE; i++) {
      const b = Math.round(Math.min(Math.max(lutVals[i], 0), 1) * 255);
      lutData[i * 4] = b;
      lutData[i * 4 + 1] = b;
      lutData[i * 4 + 2] = b;
      lutData[i * 4 + 3] = 255;
    }

    liteLut = new THREE.DataTexture(lutData, AO_LITE_LUT_SIZE, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    liteLut.minFilter = THREE.LinearFilter;
    liteLut.magFilter = THREE.LinearFilter;
    liteLut.wrapS = THREE.ClampToEdgeWrapping;
    liteLut.wrapT = THREE.ClampToEdgeWrapping;
    liteLut.needsUpdate = true;
    liteMat = makeMat(
      `
#include <packing>
varying vec2 vUv;
uniform sampler2D tDepth;
uniform sampler2D uFalloffLut;
uniform float uNear;
uniform float uFar;
uniform vec2 uInvProj;
uniform vec2 uTexel;
uniform float uAoOn;
uniform float uCsOn;
uniform float uRadius;
uniform float uPower;
uniform float uBias;
uniform vec3 uCsDir;
uniform float uCsDistance;
uniform float uCsThickness;
uniform int uCsSteps;
uniform float uCsLocalOn;
uniform vec3 uCsLocalPos;
uniform float uCsLocalRange;
uniform int uCsLocalSteps;
uniform float uCsLocalSpread;
uniform float uCsSunScale;
uniform float uFrameJitter;
uniform vec3 uUpView;
uniform float uHemiFrac;
uniform float uBentStr;
${DIST_GLSL}
vec3 rswViewPos(vec2 uv) {
  float d = rswDist(uv);
  vec2 ndc = uv * 2.0 - 1.0;
  return vec3(ndc * uInvProj * d, -d);
}
float rswIgn(vec2 px) {
  return fract(${glslFloat(IGN_MAGIC[0])} * fract(dot(px, vec2(${glslFloat(IGN_MAGIC[1])}, ${glslFloat(IGN_MAGIC[2])}))));
}
${contactShadowGlsl()}
${contactLocalGlsl()}
void main() {
  float dist = rswDist(vUv);
  if (dist >= uFar * 0.98) {
    gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);                             
    return;
  }
  vec3 pc = rswViewPos(vUv);
  vec2 ex = vec2(uTexel.x, 0.0);
  vec2 ey = vec2(0.0, uTexel.y);
  vec3 pr = rswViewPos(vUv + ex);
  vec3 pl = rswViewPos(vUv - ex);
  vec3 pu = rswViewPos(vUv + ey);
  vec3 pd = rswViewPos(vUv - ey);
  vec3 dx = abs(pr.z - pc.z) < abs(pc.z - pl.z) ? pr - pc : pc - pl;
  vec3 dy = abs(pu.z - pc.z) < abs(pc.z - pd.z) ? pu - pc : pc - pd;
  vec3 n = normalize(cross(dy, dx));
  if (n.z < 0.0) n = -n;
                                                                          
  float rnd = fract(rswIgn(gl_FragCoord.xy) + uFrameJitter);

  mediump float ao = 1.0;
  mediump vec3 rswBent = n;
  if (uAoOn > 0.5) {
    vec2 duv = min(vec2(0.5) * uRadius / (dist * uInvProj), vec2(0.2));
    mediump float occ = 0.0;
    for (int i = 0; i < ${AO_LITE_TAPS}; i++) {
                                                                       
      float ang = (float(i) + rnd) * ${glslFloat(AO_LITE_GOLDEN)};
      float t = sqrt((float(i) + 0.5) / ${glslFloat(AO_LITE_TAPS)});
      vec2 off = vec2(cos(ang), sin(ang)) * t * duv;
      vec2 uvA = vUv + off;
      vec3 pa = rswViewPos(uvA);
      vec3 va = pa - pc;
      float la = max(length(va), 1e-4);
                                                                      
                                                                          
                                                                         
                                                                          
                                                                   
                                                                     
                                                                           
                                                                            
      mediump float wa = texture2D(uFalloffLut, vec2((la / uRadius) * ${glslFloat((AO_LITE_LUT_SIZE - 1) / AO_LITE_LUT_SIZE)} + ${glslFloat(0.5 / AO_LITE_LUT_SIZE)}, 0.5)).r
        * step(abs(uvA.x - 0.5), 0.5) * step(abs(uvA.y - 0.5), 0.5);
      mediump float ca = clamp(dot(n, va / la) - uBias, 0.0, 1.0) * wa;
      occ += ca;
      rswBent -= (va / la) * ca;
    }
    ao = pow(clamp(1.0 - 1.7 * occ / ${glslFloat(AO_LITE_TAPS)}, 0.0, 1.0), uPower);
  }

  mediump float cs = 1.0;
  if (uCsOn > 0.5) {
    cs = rswContactShadow(pc, rnd);
                                                                       
                                                                          
    cs = mix(1.0, cs, uCsSunScale);
                                                                            
                                                                     
    if (uCsLocalOn > 0.5) {
      cs = min(cs, rswContactLocal(pc, rnd));
    }
  }
                                                                         
  mediump float bentTerm = 1.0;
  if (uAoOn > 0.5 && uBentStr > 0.001) {
    vec3 bn = rswBent / max(length(rswBent), 1e-3);
    mediump float skyN = 0.5 + 0.5 * dot(n, uUpView);
    mediump float skyB = 0.5 + 0.5 * dot(bn, uUpView);
    mediump float ratio = clamp(skyB / max(skyN, 0.05), 0.0, 1.0);
    bentTerm = mix(1.0, ratio, uHemiFrac * uBentStr);
  }
  gl_FragColor = vec4(ao, cs, bentTerm, 1.0);
}
`,
      {
        tDepth: { value: null },
        uFalloffLut: { value: liteLut },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uInvProj: { value: new THREE.Vector2(1, 1) },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uAoOn: { value: 0 },
        uCsOn: { value: 0 },
        uRadius: { value: cfg.aoRadius },
        uPower: { value: cfg.aoPower },
        uBias: { value: cfg.aoBias },
        uCsDir: { value: new THREE.Vector3(0, 1, 0) },
        uCsDistance: { value: cfg.csDistance },
        uCsThickness: { value: cfg.csThickness },
        uCsSteps: { value: cfg.csSteps },


        uCsLocalOn: { value: 0 },
        uCsLocalPos: { value: new THREE.Vector3() },
        uCsSunScale: { value: 1 },
        uCsLocalRange: { value: 0 },
        uCsLocalSteps: { value: 6 },
        uCsLocalSpread: { value: 0 },              
        uFrameJitter: { value: 0 },
        uUpView: { value: new THREE.Vector3(0, 1, 0) },
        uHemiFrac: { value: 0 },
        uBentStr: { value: 0 },
      },
    );
    return liteMat;
  }

  function ensure(liteOn) {
    if (allocW === pw && allocH === ph && allocLite === liteOn) return;
    release();
    allocW = pw;
    allocH = ph;
    allocLite = liteOn;

    const half = liteOn ? aoLiteTargetSize(pw, ph) : aoTargetSize(pw, ph);
    const opts = {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    };
    aoRT = new THREE.WebGLRenderTarget(half.w, half.h, opts);
    blurRT = new THREE.WebGLRenderTarget(half.w, half.h, opts);
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
    setParams(next) {
      state = next && typeof next === "object" ? next : null;
    },
    setSize(nw, nh) {
      pw = Math.max(1, nw | 0);
      ph = Math.max(1, nh | 0);
    },


    getMask() {
      if (!blurRT || !blurRT.texture) return null;
      return { texture: blurRT.texture, w: blurRT.width, h: blurRT.height, sw: pw, sh: ph };
    },
    render(r, writeBuffer, readBuffer) {
      const out = this.renderToScreen ? null : writeBuffer;
      const wantAo = !!(state && state.ao);
      const wantCs = !!(state && state.contact);
      const pe = camera.projectionMatrix.elements;
      const p00 = pe[0];
      const p11 = pe[5];

      const usable = (wantAo || wantCs) && Number.isFinite(p00) && p00 > 0 && Number.isFinite(p11) && p11 > 0;
      if (!usable) {


        if (tsrA) tsrRelease();
        copyMat.uniforms.tDiffuse.value = readBuffer.texture;
        blit(r, copyMat, out);
        return;
      }

      pw = Math.max(1, readBuffer.width | 0);
      ph = Math.max(1, readBuffer.height | 0);

      const liteOn = !!(state && state.lite);
      ensure(liteOn);







      const halfDepth = !!(state && state.halfDepth);
      const geomSize = halfDepth ? aoTargetSize(pw, ph) : null;
      const depthTex = halfDepth
        ? sharedDepth.acquire(r, geomSize.w, geomSize.h)
        : sharedDepth.acquire(r, pw, ph);
      const half = liteOn ? aoLiteTargetSize(pw, ph) : aoTargetSize(pw, ph);
      const mat = liteOn ? liteEnsure() : aoMat;
      const au = mat.uniforms;


      if (au.tGeom) {
        au.tGeom.value =
          halfDepth && typeof sharedDepth.acquireGeom === "function"
            ? sharedDepth.acquireGeom(r, geomSize.w, geomSize.h)
            : null;
        au.uGeomOn.value = au.tGeom.value ? 1 : 0;
      }
      au.tDepth.value = depthTex;
      au.uNear.value = camera.near;
      au.uFar.value = camera.far;
      au.uInvProj.value.set(1 / p00, 1 / p11);
      au.uTexel.value.set(1 / half.w, 1 / half.h);
      au.uAoOn.value = wantAo ? 1 : 0;
      au.uCsOn.value = wantCs ? 1 : 0;





      au.uCsSunScale.value = state && Number.isFinite(Number(state.csScale))
        ? Math.min(Math.max(Number(state.csScale), 0), 1)
        : 1;



      const csStepsIn = (state && state.csSteps) || 12;
      if (this.__csStepsIn !== csStepsIn) {
        this.__csStepsIn = csStepsIn;
        this.__csStepsOut = sanitizeAoSettings({ csSteps: csStepsIn }).csSteps;
      }
      au.uCsSteps.value = this.__csStepsOut;
      const sd = (state && state.sunDirView) || null;
      if (sd) au.uCsDir.value.set(sd.x || 0, sd.y || 0, sd.z || 0);



      const cl = (state && state.csLocal) || null;
      const clOn = !!(wantCs && cl && cl.on);
      au.uCsLocalOn.value = clOn ? 1 : 0;
      if (clOn) {
        const cp = cl.pos || null;
        if (cp) au.uCsLocalPos.value.set(cp.x || 0, cp.y || 0, cp.z || 0);
        au.uCsLocalRange.value = Math.max(Number(cl.range) || 0, 0.05);

        if (this.__clStepsIn !== cl.steps) {
          this.__clStepsIn = cl.steps;
          this.__clStepsOut = sanitizeContactFuse({ steps: cl.steps }).steps;
        }
        au.uCsLocalSteps.value = this.__clStepsOut;



        if (au.uCsLocalSpread) au.uCsLocalSpread.value = Math.max(Number(cl.spread) || 0, 0);
      }

      const up = (state && state.upView) || null;
      if (up) au.uUpView.value.set(up.x || 0, up.y || 0, up.z || 0);
      const hf = state && Number.isFinite(Number(state.hemiFrac)) ? Number(state.hemiFrac) : 0;
      au.uHemiFrac.value = Math.min(Math.max(hf, 0), 1);
      au.uBentStr.value = wantAo && state && state.bent ? cfgSky.bentStrength : 0;







      const tsrOn = (liteOn || !!(state && state.temporal)) && !(state && state.noTemporal);
      const rc = state ? state.resetCount : undefined;
      if (rc !== undefined && rc !== lastResetCount) {


        if (lastResetCount !== null) {
          tsrFrames = 0;
          tsrValid = false;
        }
        lastResetCount = rc;
      }


      if (liteOn) liteFrame = (liteFrame + 1) % 8192;
      au.uFrameJitter.value = tsrOn ? frameJitter(liteOn ? liteFrame : state.frame) : 0;
      blit(r, mat, aoRT);
      let maskRT = aoRT;
      if (tsrOn) {
        tsrEnsure(half.w, half.h);
        curVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        invVP.copy(curVP).invert();
        const tu = tsrMat.uniforms;
        tu.tCurrent.value = aoRT.texture;
        tu.tHistory.value = tsrA.texture;
        tu.tDepth.value = depthTex;
        tu.uInvViewProj.value.copy(invVP);
        tu.uPrevViewProj.value.copy(tsrValid ? prevVP : curVP);
        tu.uTexel.value.set(1 / half.w, 1 / half.h);
        tu.uAlpha.value = blendAlpha(tsrFrames);
        tu.uHistoryValid.value = tsrValid ? 1 : 0;
        blit(r, tsrMat, tsrB);
        const sw = tsrA;
        tsrA = tsrB;
        tsrB = sw;
        prevVP.copy(curVP);
        tsrFrames = Math.min(tsrFrames + 1, MAX_HISTORY_FRAMES);
        tsrValid = true;
        maskRT = tsrA;
      } else if (tsrA) {
        tsrRelease();
      }
      const bu = blurMat.uniforms;
      bu.tAo.value = maskRT.texture;
      bu.tDepth.value = depthTex;
      bu.uTexel.value.set(1 / half.w, 1 / half.h);
      bu.uNear.value = camera.near;
      bu.uFar.value = camera.far;
      blit(r, blurMat, blurRT);
      const cu = compMat.uniforms;
      cu.tDiffuse.value = readBuffer.texture;
      cu.tAo.value = blurRT.texture;
      cu.tDepth.value = depthTex;
      cu.uHalfTexel.value.set(1 / half.w, 1 / half.h);
      cu.uNear.value = camera.near;
      cu.uFar.value = camera.far;
      cu.uAoIntensity.value = wantAo ? cfg.aoIntensity : 0;


      cu.uCsStrength.value = wantCs ? cfg.csStrength : 0;


      cu.uRswSpecOcc.value = wantAo && state && state.bent && !state.specOccExternal ? 1 : 0;
      blit(r, compMat, out);
    },
    dispose() {
      release();
      copyMat.dispose();
      aoMat.dispose();
      if (liteMat) liteMat.dispose();
      if (liteLut) liteLut.dispose();
      liteMat = null;
      liteLut = null;
      blurMat.dispose();
      compMat.dispose();
      tsrMat.dispose();
      quad.dispose();
    },
  };
}
