import {
  PROBE_EXTRA_TEX_UNITS,
  PROBE_FACES,
  probeSignature,
  probeContains,
  probeBlendWeight,
  pickProbeForPoint,
  pickTopTwoProbes,
  selectActiveProbes,
  pickCaptureTarget,
  probeParallaxGlsl,
} from "../lighting/probeCore.js";


import {
  REFL_PROBE_FEATHER_DEFAULT,
  reflectionStackGlslChunk,
} from "../lighting/reflectionStackCore.js";
import { ssrStackShare } from "./ssr.js";

const CHUNK_NAME = "envmap_physical_pars_fragment";
const RADIANCE_CALL = "textureCubeUV( envMap, reflectVec, roughness )";
const RADIANCE_CALL_PATCHED = "textureCubeUV( envMap, rswPrbReflect( reflectVec, vRswPrbWorld ), roughness )";


const RADIANCE_CALL_STACKED = "rswStkRadiance( reflectVec, roughness )";
const VARY_DECL = "varying vec3 vRswPrbWorld;";


function stackComposeGlsl() {
  return [
    "uniform float uRswStkOn;",
    "uniform float uRswStkXf;",
    "uniform float uRswAlphaRoughOn;",                                           
    "uniform float uRswStkSsrOn;",
    "uniform float uRswPrbFeather;",
    "uniform vec2 uRswStkTexel;",
    "uniform sampler2D uRswStkSsr;",
    reflectionStackGlslChunk(),
    "#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )",
    "uniform sampler2D uRswPrbBase;",
    "// IL-F47 (a): 2º probe (bi-probe) — crossfade entre caixas vizinhas.",
    "uniform sampler2D uRswPrbCube2;",
    "uniform float uRswPrb2On;",
    "uniform float uRswPrb2Blend;",
    "uniform vec3 uRswPrb2BoxMin;",
    "uniform vec3 uRswPrb2BoxMax;",
    "uniform vec3 uRswPrb2Pos;",


    "float rswPrbConfPx( vec3 wp ) {",
    "\tvec3 rswPcC = ( uRswPrbBoxMin + uRswPrbBoxMax ) * 0.5;",
    "\tvec3 rswPcH = max( ( uRswPrbBoxMax - uRswPrbBoxMin ) * 0.5, vec3( 1e-5 ) );",
    "\tvec3 rswPcQ = abs( wp - rswPcC ) / rswPcH;",
    "\tfloat rswPcD = max( max( rswPcQ.x, rswPcQ.y ), rswPcQ.z );",
    "\tfloat rswPcF = clamp( uRswPrbFeather, 0.01, 0.5 );",
    "\tfloat rswPcT = clamp( ( 1.0 - rswPcD ) / rswPcF, 0.0, 1.0 );",
    "\tfloat rswPcS = rswPcT * rswPcT * ( 3.0 - 2.0 * rswPcT );",
    "\treturn rswPcD >= 1.0 ? 0.0 : ( rswPcD <= 1.0 - rswPcF ? 1.0 : rswPcS );",
    "}",
    "// IL-F47 (a): confiança do 2º probe — mesma Chebyshev + feather.",
    "float rswPrb2ConfPx( vec3 rswP2Wp ) {",
    "\tif ( uRswPrb2On < 0.5 ) { return 0.0; }",
    "\tvec3 rswP2Cc = ( uRswPrb2BoxMin + uRswPrb2BoxMax ) * 0.5;",
    "\tvec3 rswP2Hh = max( ( uRswPrb2BoxMax - uRswPrb2BoxMin ) * 0.5, vec3( 1e-4 ) );",
    "\tvec3 rswP2Qq = abs( rswP2Wp - rswP2Cc ) / rswP2Hh;",
    "\tfloat rswP2Dd = max( rswP2Qq.x, max( rswP2Qq.y, rswP2Qq.z ) );",
    "\tfloat rswP2Ff = clamp( uRswPrbFeather, 0.01, 0.5 );",
    "\tfloat rswP2Tt = clamp( ( 1.0 - rswP2Dd ) / rswP2Ff, 0.0, 1.0 );",
    "\tfloat rswP2Ss = rswP2Tt * rswP2Tt * ( 3.0 - 2.0 * rswP2Tt );",
    "\treturn rswP2Dd >= 1.0 ? 0.0 : ( rswP2Dd <= 1.0 - rswP2Ff ? 1.0 : rswP2Ss );",
    "}",
    "// IL-F47 (a): box-projection do 2º probe (espelho do principal).",
    "vec3 rswPrb2Reflect( vec3 rswP2Dv, vec3 rswP2Wp ) {",
    "\tvec3 rswP2L0 = rswP2Wp;",
    "\tvec3 rswP2Safe = sign( rswP2Dv ) * max( abs( rswP2Dv ), vec3( 1e-5 ) );",
    "\tvec3 rswP2T1 = ( uRswPrb2BoxMax - rswP2L0 ) / rswP2Safe;",
    "\tvec3 rswP2T2 = ( uRswPrb2BoxMin - rswP2L0 ) / rswP2Safe;",
    "\tvec3 rswP2Far = max( rswP2T1, rswP2T2 );",
    "\tfloat rswP2Tm = min( rswP2Far.x, min( rswP2Far.y, rswP2Far.z ) );",
    "\tvec3 rswP2Hit = rswP2L0 + rswP2Dv * max( rswP2Tm, 0.0 );",
    "\tvec3 rswP2Corr = rswP2Hit - uRswPrb2Pos;",
    "\tfloat rswP2CL = length( rswP2Corr );",
    "\treturn rswP2CL > 1e-5 ? rswP2Corr / rswP2CL : rswP2Dv;",
    "}",


    "vec4 rswStkRadiance( vec3 reflectVec, float roughness ) {",
    "\tvec4 rswStkProbeC = " + RADIANCE_CALL_PATCHED + ";",
    "\tif ( uRswStkOn <= 0.0 ) { return rswStkProbeC; }",
    "\tfloat rswStkPrbA = rswPrbConfPx( vRswPrbWorld ) * clamp( uRswPrbOn, 0.0, 1.0 ) * clamp( uRswPrbBlend, 0.0, 1.0 );",
    "\tvec4 rswStkSkyC = rswStkProbeC;",
    "\tif ( uRswStkXf > 0.5 ) { rswStkSkyC = textureCubeUV( uRswPrbBase, reflectVec, roughness ); }",
    "\t// IL-F47 (a): bi-probe — o 2º probe pesa só onde o 1º não domina.",
    "\tfloat rswStkPrb2A = 0.0;",
    "\tvec3 rswStkPrbCol = rswStkProbeC.rgb;",
    "\tif ( uRswPrb2On > 0.5 && uRswStkXf > 0.5 ) {",
    "\t\trswStkPrb2A = rswPrb2ConfPx( vRswPrbWorld ) * clamp( uRswPrb2Blend, 0.0, 1.0 ) * ( 1.0 - rswStkPrbA );",
    "\t\tif ( rswStkPrb2A > 0.001 ) {",
    "\t\t\tvec4 rswStkP2C = textureCubeUV( uRswPrbCube2, rswPrb2Reflect( reflectVec, vRswPrbWorld ), roughness );",
    "\t\t\trswStkPrbCol = ( rswStkProbeC.rgb * rswStkPrbA + rswStkP2C.rgb * rswStkPrb2A ) / max( rswStkPrbA + rswStkPrb2A, 1e-4 );",
    "\t\t}",
    "\t}",
    "\tvec2 rswStkUv = clamp( gl_FragCoord.xy * uRswStkTexel, vec2( 0.0 ), vec2( 1.0 ) );",
    "\tvec4 rswStkS = texture2D( uRswStkSsr, rswStkUv );",
    "\tfloat rswStkSsrA = clamp( rswStkS.a, 0.0, 1.0 ) * clamp( uRswStkSsrOn, 0.0, 1.0 );",
    "\tvec3 rswStkC = rswReflStackCompose( vec3( 0.0 ), 0.0, rswStkS.rgb, rswStkSsrA, rswStkPrbCol, min( rswStkPrbA + rswStkPrb2A, 1.0 ), rswStkSkyC.rgb, uRswStkOn );",

    "\tif ( !( rswStkC.x >= 0.0 ) ) { rswStkC.x = rswStkSkyC.x; }",
    "\tif ( !( rswStkC.y >= 0.0 ) ) { rswStkC.y = rswStkSkyC.y; }",
    "\tif ( !( rswStkC.z >= 0.0 ) ) { rswStkC.z = rswStkSkyC.z; }",
    "\treturn vec4( rswStkC, rswStkProbeC.a );",
    "}",
    "#endif",
  ].join("\n");
}
const IDLE_FRAMES = 12;
const EPS_CAM = 1e-4;

export function createReflectionProbes(deps) {
  const THREE = deps && deps.THREE;


  const supported = !!(
    THREE &&
    THREE.ShaderChunk &&
    typeof THREE.ShaderChunk[CHUNK_NAME] === "string" &&
    THREE.ShaderChunk[CHUNK_NAME].indexOf(RADIANCE_CALL) !== -1 &&
    typeof THREE.WebGLCubeRenderTarget === "function" &&
    typeof THREE.CubeCamera === "function" &&
    typeof THREE.PMREMGenerator === "function"
  );

  let generation = 0;
  let on = false;
  let budget = 0;
  let disposed = false;
  let warnedErr = false;



  const uniforms = supported
    ? {
        uRswPrbOn: { value: 0 },
        uRswPrbBlend: { value: 0 },
        uRswPrbBoxMin: { value: new THREE.Vector3(-1, -1, -1) },
        uRswPrbBoxMax: { value: new THREE.Vector3(1, 1, 1) },
        uRswPrbPos: { value: new THREE.Vector3(0, 0, 0) },

        uRswStkOn: { value: 0 },
        uRswStkXf: { value: 0 },
        uRswPrbFeather: { value: REFL_PROBE_FEATHER_DEFAULT },
        uRswPrbBase: { value: null },

        uRswPrb2On: { value: 0 },
        uRswPrb2Blend: { value: 0 },
        uRswPrb2BoxMin: { value: new THREE.Vector3(-1, -1, -1) },
        uRswPrb2BoxMax: { value: new THREE.Vector3(1, 1, 1) },
        uRswPrb2Pos: { value: new THREE.Vector3(0, 0, 0) },
        uRswPrbCube2: { value: null },
      }
    : null;



  const records = new Map();
  let list = [];

  const alphaRoughMats = new Set();

  let pmrem = null;
  let savedBaseEnv = null;
  let appliedKey = null;
  let appliedBlend = 0;

  let lastBi = 0;
  let biPick = null;


  let stackOn = false;
  let lastXf = 0;
  let appliedFeather = REFL_PROBE_FEATHER_DEFAULT;
  const appliedBoxMin = [0, 0, 0];
  const appliedBoxMax = [0, 0, 0];

  let lastCamX = NaN, lastCamY = NaN, lastCamZ = NaN;
  let lastQX = NaN, lastQY = NaN, lastQZ = NaN, lastQW = NaN;
  let stillFrames = 0;
  let capturesDone = 0;
  let lastCaptureMs = 0;

  function nowMs() {
    return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  }

  function disposeRec(rec) {
    if (!rec) return;
    try { if (rec.cubeRT) rec.cubeRT.dispose(); } catch (_e) {                   }
    try { if (rec.pmremRT) rec.pmremRT.dispose(); } catch (_e) {                   }
    rec.cubeRT = null;
    rec.cubeCam = null;
    rec.pmremRT = null;
    rec.ready = false;
    rec.facesDone = 0;
  }





  let touchSeq = 0;
  let lastScene = null;                                     
  function enforceGpuCap() {
    const cap = Math.max(1, budget + 2);
    const withGpu = [];
    for (const rec of records.values()) {
      if (rec.cubeRT || rec.pmremRT) withGpu.push(rec);
    }
    let excess = withGpu.length - cap;
    if (excess <= 0) return;
    withGpu.sort((a, b) => (a.lastTouch || 0) - (b.lastTouch || 0));
    for (const rec of withGpu) {
      if (excess <= 0) break;
      if (rec.key === appliedKey) continue;
      disposeRec(rec);
      rec.dirty = true;
      excess--;
    }
  }




  let cubeTypeCached = null;
  function hdrCaptureType(renderer) {
    if (cubeTypeCached !== null) return cubeTypeCached;
    let t = THREE.UnsignedByteType;
    try {
      const gl2 = !!(renderer.capabilities && renderer.capabilities.isWebGL2);
      const has = (n) => !!(renderer.extensions && typeof renderer.extensions.has === "function" && renderer.extensions.has(n));
      if ((gl2 && has("EXT_color_buffer_float")) || has("EXT_color_buffer_half_float")) t = THREE.HalfFloatType;
    } catch (_e) {                         }
    cubeTypeCached = t;
    return t;
  }

  function isProbeTex(tex) {
    if (!tex) return false;
    for (const rec of records.values()) {
      if (rec.pmremRT && rec.pmremRT.texture === tex) return true;
    }
    return false;
  }


  function patchMaterial(mat) {
    if (!supported || !mat || !mat.userData) return;
    const ud = mat.userData;
    if (ud.__rswPrb) return;
    ud.__rswPrb = true;
    const prevCompile = mat.onBeforeCompile;
    const prevKey = mat.customProgramCacheKey;
    mat.onBeforeCompile = function (shader, rendererArg) {
      if (typeof prevCompile === "function") prevCompile.call(this, shader, rendererArg);
      try {
        if (!shader || typeof shader.fragmentShader !== "string" || typeof shader.vertexShader !== "string") return;
        const incl = "#include <" + CHUNK_NAME + ">";
        if (shader.fragmentShader.indexOf(incl) === -1) return;
        if (shader.vertexShader.indexOf("#include <project_vertex>") === -1) return;
        if (shader.fragmentShader.indexOf(VARY_DECL) !== -1) return;
        shader.uniforms.uRswPrbOn = uniforms.uRswPrbOn;
        shader.uniforms.uRswPrbBlend = uniforms.uRswPrbBlend;
        shader.uniforms.uRswPrbBoxMin = uniforms.uRswPrbBoxMin;
        shader.uniforms.uRswPrbBoxMax = uniforms.uRswPrbBoxMax;
        shader.uniforms.uRswPrbPos = uniforms.uRswPrbPos;


        shader.uniforms.uRswStkOn = uniforms.uRswStkOn;
        shader.uniforms.uRswStkXf = uniforms.uRswStkXf;
        shader.uniforms.uRswPrbFeather = uniforms.uRswPrbFeather;
        shader.uniforms.uRswPrbBase = uniforms.uRswPrbBase;

        shader.uniforms.uRswPrbCube2 = uniforms.uRswPrbCube2;
        shader.uniforms.uRswPrb2On = uniforms.uRswPrb2On;
        shader.uniforms.uRswPrb2Blend = uniforms.uRswPrb2Blend;
        shader.uniforms.uRswPrb2BoxMin = uniforms.uRswPrb2BoxMin;
        shader.uniforms.uRswPrb2BoxMax = uniforms.uRswPrb2BoxMax;
        shader.uniforms.uRswPrb2Pos = uniforms.uRswPrb2Pos;
        shader.uniforms.uRswStkSsr = ssrStackShare.uRswStkSsr;
        shader.uniforms.uRswStkSsrOn = ssrStackShare.uRswStkSsrOn;
        shader.uniforms.uRswStkTexel = ssrStackShare.uRswStkTexel;
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\n" + VARY_DECL)
          .replace(
            "#include <project_vertex>",
            "#include <project_vertex>\n" +
              "\t// IL-F22: posição de mundo p/ box-projection.\n" +
              "\tvec4 rswPrbW = vec4( transformed, 1.0 );\n" +
              "#ifdef USE_INSTANCING\n" +
              "\trswPrbW = instanceMatrix * rswPrbW;\n" +
              "#endif\n" +
              "\tvRswPrbWorld = ( modelMatrix * rswPrbW ).xyz;"
          );
        const src = THREE.ShaderChunk[CHUNK_NAME];
        const patched =
          VARY_DECL + "\n" + probeParallaxGlsl() + "\n" + stackComposeGlsl() + "\n" +
          src.replace(RADIANCE_CALL, RADIANCE_CALL_STACKED);
        shader.fragmentShader = shader.fragmentShader.replace(incl, patched);


        if (
          shader.fragmentShader.indexOf("#include <roughnessmap_fragment>") !== -1 &&
          shader.fragmentShader.indexOf("#include <dithering_fragment>") !== -1
        ) {
          if (!ud.__rswAlphaRoughU) ud.__rswAlphaRoughU = { value: mat.transparent === true ? 0 : 1 };
          shader.uniforms.uRswAlphaRoughOn = ud.__rswAlphaRoughU;
          alphaRoughMats.add(mat);
          shader.fragmentShader = shader.fragmentShader.replace(
            "#include <dithering_fragment>",
            "#include <dithering_fragment>\n" +
              "\tgl_FragColor.a = mix( gl_FragColor.a, min( roughnessFactor, 0.995 ), clamp( uRswStkOn, 0.0, 1.0 ) * clamp( uRswAlphaRoughOn, 0.0, 1.0 ) * step( 0.999, gl_FragColor.a ) );"
          );
        }
      } catch (err) {
        if (!warnedErr) {
          warnedErr = true;
          try { console.warn("[Iluminação] IL-F22: patch de probe falhou (no-op honesto).", err); } catch (_e) {                  }
        }
      }
    };
    mat.customProgramCacheKey = function () {
      const base = typeof prevKey === "function" ? String(prevKey.call(this)) : "";
      return base + "|rswPrb" + generation;
    };
    mat.needsUpdate = true;
  }


  function ensureRec(p) {
    let rec = records.get(p.key);
    if (!rec) {
      rec = {
        key: p.key, probe: p, sig: probeSignature(p),
        cubeRT: null, cubeCam: null, pmremRT: null,
        facesDone: 0, dirty: true, ready: false, failed: false,
        lastMs: 0,
      };
      records.set(p.key, rec);
      return rec;
    }
    const sig = probeSignature(p);
    if (sig !== rec.sig) {
      const resChanged = rec.probe && rec.probe.resolution !== p.resolution;
      rec.sig = sig;
      rec.dirty = true;
      rec.failed = false;
      rec.facesDone = 0;
      if (resChanged) disposeRec(rec);
    }
    rec.probe = p;
    return rec;
  }


  function setProbes(newList) {
    list = (newList || []).filter((p) => p && p.key !== null && p.key !== undefined);
    const seen = new Set(list.map((p) => p.key));
    for (const p of list) ensureRec(p);
    for (const [k, rec] of Array.from(records.entries())) {
      if (!seen.has(k)) { disposeRec(rec); records.delete(k); }
    }
  }

  function configure(opts) {
    const o = opts || {};
    if (typeof o.on === "boolean") on = o.on;
    if (typeof o.budget === "number" && Number.isFinite(o.budget)) budget = Math.max(0, Math.floor(o.budget));
    if (Array.isArray(o.probes)) setProbes(o.probes);

    if (typeof o.stackOn === "boolean") stackOn = o.stackOn;
  }

  function setEnabled(v) { on = !!v; }

  function bumpGeneration() {
    generation++;
    for (const rec of records.values()) { rec.dirty = true; }
  }


  function camStill(camera) {
    const p = camera.position;
    const q = camera.quaternion;
    const still =
      Math.abs(p.x - lastCamX) < EPS_CAM && Math.abs(p.y - lastCamY) < EPS_CAM &&
      Math.abs(p.z - lastCamZ) < EPS_CAM &&
      Math.abs(q.x - lastQX) < EPS_CAM && Math.abs(q.y - lastQY) < EPS_CAM &&
      Math.abs(q.z - lastQZ) < EPS_CAM && Math.abs(q.w - lastQW) < EPS_CAM;
    lastCamX = p.x; lastCamY = p.y; lastCamZ = p.z;
    lastQX = q.x; lastQY = q.y; lastQZ = q.z; lastQW = q.w;
    stillFrames = still ? stillFrames + 1 : 0;
    return stillFrames >= IDLE_FRAMES;
  }

  function restoreEnv(scene) {
    if (isProbeTex(scene.environment)) scene.environment = savedBaseEnv;
    if (uniforms) { uniforms.uRswPrbOn.value = 0; uniforms.uRswPrbBlend.value = 0; }
    appliedKey = null;
    appliedBlend = 0;
  }


  function canRenderPerFace(rec) {
    return !!(rec.cubeCam && Array.isArray(rec.cubeCam.children) &&
      rec.cubeCam.children.length >= 6 &&
      typeof rec.cubeCam.updateCoordinateSystem === "function");
  }

  function renderCubeFace(renderer, scene, rec, face) {
    const cubeCam = rec.cubeCam;


    if (cubeCam.coordinateSystem !== renderer.coordinateSystem) {
      cubeCam.coordinateSystem = renderer.coordinateSystem;
      cubeCam.updateCoordinateSystem();
      cubeCam.updateMatrixWorld(true);
    }
    const cam = cubeCam.children[face];
    const prevRT = renderer.getRenderTarget();
    const prevXr = renderer.xr ? renderer.xr.enabled : false;
    if (renderer.xr) renderer.xr.enabled = false;
    try {
      renderer.setRenderTarget(rec.cubeRT, face);
      renderer.render(scene, cam);
    } finally {
      renderer.setRenderTarget(prevRT);
      if (renderer.xr) renderer.xr.enabled = prevXr;
    }
  }


  function frame(opts) {
    if (disposed || !supported) return;
    const { renderer, scene, camera } = opts || {};
    if (!renderer || !scene || !camera) return;

    lastScene = scene;                                                      

    if (alphaRoughMats.size > 0) {
      for (const m of alphaRoughMats) {
        const uAr = m && m.userData ? m.userData.__rswAlphaRoughU : null;
        if (!uAr) { alphaRoughMats.delete(m); continue; }
        uAr.value = m.transparent === true ? 0 : 1;
      }
    }
    biPick = null;                                            
    const idle = camStill(camera);
    const camPt = [camera.position.x, camera.position.y, camera.position.z];


    if (on && budget > 0) {
      const active = selectActiveProbes(list, camPt, budget);


      const candidates = [];
      for (const p of active) {
        const rec = records.get(p.key);
        if (rec) rec.lastTouch = ++touchSeq;
        if (!rec || !rec.ready || !rec.pmremRT) continue;
        if (probeContains(p, camPt)) candidates.push(p);
      }
      const pick = candidates.length > 0 ? pickProbeForPoint(candidates, camPt) : null;

      const pick2 = candidates.length > 1 ? pickTopTwoProbes(candidates, camPt) : null;
      biPick = pick2 && pick2.b ? pick2.b : null;
      const applied = pick ? pick.probe : null;
      const appliedW = applied ? probeBlendWeight(applied, camPt) : 0;
      if (applied && applied.key !== null) {
        const rec = records.get(applied.key);

        if (!isProbeTex(scene.environment)) savedBaseEnv = scene.environment || null;
        scene.environment = rec.pmremRT.texture;
        const bx = applied.pos[0] - applied.size[0] / 2;
        const by = applied.pos[1] - applied.size[1] / 2;
        const bz = applied.pos[2] - applied.size[2] / 2;
        if (uniforms) {
          uniforms.uRswPrbOn.value = 1;
          uniforms.uRswPrbBlend.value = appliedW;
          uniforms.uRswPrbBoxMin.value.set(bx, by, bz);
          uniforms.uRswPrbBoxMax.value.set(bx + applied.size[0], by + applied.size[1], bz + applied.size[2]);
          uniforms.uRswPrbPos.value.set(applied.pos[0], applied.pos[1], applied.pos[2]);
        }
        appliedKey = applied.key;
        appliedBlend = appliedW;


        appliedBoxMin[0] = bx; appliedBoxMin[1] = by; appliedBoxMin[2] = bz;
        appliedBoxMax[0] = bx + applied.size[0];
        appliedBoxMax[1] = by + applied.size[1];
        appliedBoxMax[2] = bz + applied.size[2];
        const stkHalfMin = Math.min(applied.size[0], applied.size[1], applied.size[2]) / 2;
        const stkMargin = Math.max(1e-6, Math.min(applied.blend, stkHalfMin));
        appliedFeather = stkHalfMin > 1e-6
          ? Math.min(0.5, Math.max(0.01, stkMargin / stkHalfMin))
          : REFL_PROBE_FEATHER_DEFAULT;
        if (uniforms) uniforms.uRswPrbFeather.value = appliedFeather;
      } else {

        restoreEnv(scene);
      }
    } else {
      restoreEnv(scene);


      for (const rec of records.values()) {
        if (rec.cubeRT || rec.pmremRT) { disposeRec(rec); rec.dirty = true; }
      }
    }


    let stkXf = 0;
    if (uniforms) {
      uniforms.uRswStkOn.value = stackOn ? 1 : 0;
      let stkBase = null;
      if (appliedKey !== null) {
        stkBase = savedBaseEnv || null;
        const stkRec = records.get(appliedKey);
        const stkPrbTex = stkRec && stkRec.pmremRT ? stkRec.pmremRT.texture : null;
        if (
          stackOn && stkBase && stkPrbTex &&
          stkBase.image && stkPrbTex.image &&
          stkBase.image.height === stkPrbTex.image.height
        ) {
          stkXf = 1;
        }
      } else {
        stkBase = scene.environment || null;
      }
      uniforms.uRswPrbBase.value = stkBase;
      uniforms.uRswStkXf.value = stkXf;


      let bi = 0;
      if (stkXf === 1 && biPick && biPick.probe && biPick.probe.key !== null && biPick.probe.key !== undefined) {
        const biRec = records.get(biPick.probe.key);
        const biTex = biRec && biRec.ready && biRec.pmremRT ? biRec.pmremRT.texture : null;
        const recA = appliedKey !== null ? records.get(appliedKey) : null;
        const texA = recA && recA.pmremRT ? recA.pmremRT.texture : null;
        if (biTex && texA && biTex.image && texA.image && biTex.image.height === texA.image.height) {
          const bp = biPick.probe;
          const b2x = bp.pos[0] - bp.size[0] / 2;
          const b2y = bp.pos[1] - bp.size[1] / 2;
          const b2z = bp.pos[2] - bp.size[2] / 2;
          uniforms.uRswPrb2BoxMin.value.set(b2x, b2y, b2z);
          uniforms.uRswPrb2BoxMax.value.set(b2x + bp.size[0], b2y + bp.size[1], b2z + bp.size[2]);
          uniforms.uRswPrb2Pos.value.set(bp.pos[0], bp.pos[1], bp.pos[2]);
          uniforms.uRswPrbCube2.value = biTex;
          uniforms.uRswPrb2Blend.value = Math.max(0, Math.min(1, biPick.weight || 0));
          bi = 1;
        }
      }
      uniforms.uRswPrb2On.value = bi;
      if (bi === 0) {
        uniforms.uRswPrb2Blend.value = 0;
        uniforms.uRswPrbCube2.value = null;
      }
      lastBi = bi;
    }
    lastXf = stkXf;


    if (!on || !idle || budget === 0) return;
    const active2 = selectActiveProbes(list, camPt, budget);
    const capRecs = [];
    for (const p of active2) {
      const rec = records.get(p.key);
      if (!rec || p.enabled === false || rec.failed) continue;
      capRecs.push({ key: p.key, enabled: true, dirty: rec.dirty, facesDone: rec.facesDone });
    }
    const targetKey = pickCaptureTarget(capRecs);
    if (targetKey === null || targetKey === undefined) return;
    const rec = records.get(targetKey);
    if (!rec || !rec.probe || rec.failed) return;
    const p = rec.probe;
    const t0 = nowMs();


    const savedEnvForCapture = scene.environment;
    const savedOnU = uniforms ? uniforms.uRswPrbOn.value : 0;
    const savedBlendU = uniforms ? uniforms.uRswPrbBlend.value : 0;


    const savedStkU = uniforms ? uniforms.uRswStkOn.value : 0;

    const savedBiU = uniforms ? uniforms.uRswPrb2On.value : 0;
    try {
      if (!rec.cubeRT) {
        rec.cubeRT = new THREE.WebGLCubeRenderTarget(p.resolution, {
          type: hdrCaptureType(renderer),
          generateMipmaps: false,
        });
      }
      if (!rec.cubeCam) {
        rec.cubeCam = new THREE.CubeCamera(0.05, 5000, rec.cubeRT);
      }
      rec.cubeCam.position.set(p.pos[0], p.pos[1], p.pos[2]);
      rec.cubeCam.updateMatrixWorld(true);
      if (isProbeTex(scene.environment)) scene.environment = savedBaseEnv;
      if (uniforms) { uniforms.uRswPrbOn.value = 0; uniforms.uRswPrbBlend.value = 0; uniforms.uRswStkOn.value = 0; uniforms.uRswPrb2On.value = 0; }
      const face = rec.facesDone;
      if (canRenderPerFace(rec)) {

        renderCubeFace(renderer, scene, rec, face);
      } else if (face === PROBE_FACES - 1) {


        rec.cubeCam.update(renderer, scene);
      }
      rec.msAccum = (face === 0 ? 0 : rec.msAccum || 0) + (nowMs() - t0);
      if (face === PROBE_FACES - 1) {

        if (!pmrem) pmrem = new THREE.PMREMGenerator(renderer);
        if (rec.pmremRT) { try { rec.pmremRT.dispose(); } catch (_e) {          } }
        const tPm = nowMs();
        rec.pmremRT = pmrem.fromCubemap(rec.cubeRT.texture);
        rec.ready = true;
        rec.dirty = false;
        rec.facesDone = 0;
        const elapsed = rec.msAccum + (nowMs() - tPm);
        rec.msAccum = 0;
        rec.lastMs = elapsed;                                           
        lastCaptureMs = elapsed;
        capturesDone++;
        enforceGpuCap();
      } else {
        rec.facesDone = face + 1;
      }
    } catch (err) {
      rec.failed = true;
      try { console.warn("[Iluminação] IL-F22: falha na captura do probe", targetKey, err); } catch (_e) {          }
    } finally {
      scene.environment = savedEnvForCapture;
      if (uniforms) { uniforms.uRswPrbOn.value = savedOnU; uniforms.uRswPrbBlend.value = savedBlendU; uniforms.uRswStkOn.value = savedStkU; uniforms.uRswPrb2On.value = savedBiU; }
    }
  }


  function getState() {
    const camPt = [lastCamX || 0, lastCamY || 0, lastCamZ || 0];
    const active = on ? selectActiveProbes(list, camPt, budget) : [];
    let capturing = null;
    let ready = 0;
    for (const rec of records.values()) {
      if (rec.ready) ready++;
      if (rec.facesDone > 0 && rec.facesDone < PROBE_FACES) {
        capturing = { id: rec.key, face: rec.facesDone };
      }
    }
    return {
      probeCount: list.length,
      active: active.length,
      capturing,
      capturedCount: capturesDone,
      lastCaptureMs,
      applied: appliedKey !== null ? { probeId: appliedKey, blend: appliedBlend } : null,
      texUnitsExtra: PROBE_EXTRA_TEX_UNITS,
      supported,
      on,
      budget,


      stack: { on: stackOn, xfade: lastXf === 1, feather: appliedFeather, biProbe: lastBi === 1 },
    };
  }


  function getStackState(out) {
    const o = out || {};
    o.on = appliedKey !== null ? 1 : 0;


    o.blend = o.on === 1 && Number.isFinite(appliedBlend) ? appliedBlend : 0;
    o.minX = appliedBoxMin[0]; o.minY = appliedBoxMin[1]; o.minZ = appliedBoxMin[2];
    o.maxX = appliedBoxMax[0]; o.maxY = appliedBoxMax[1]; o.maxZ = appliedBoxMax[2];
    o.feather = appliedFeather;
    return o;
  }


  function dispose() {
    if (disposed) return;
    disposed = true;


    if (lastScene) { try { restoreEnv(lastScene); } catch (_e) {          } }
    for (const rec of records.values()) disposeRec(rec);
    records.clear();
    list = [];
    if (pmrem) { try { pmrem.dispose(); } catch (_e) {          } pmrem = null; }
    if (uniforms) {
      uniforms.uRswPrbOn.value = 0;
      uniforms.uRswPrbBlend.value = 0;

      uniforms.uRswStkOn.value = 0;
      uniforms.uRswStkXf.value = 0;
      uniforms.uRswPrbBase.value = null;

      uniforms.uRswPrb2On.value = 0;
      uniforms.uRswPrb2Blend.value = 0;
      uniforms.uRswPrbCube2.value = null;
    }
    alphaRoughMats.clear();
    appliedKey = null;
  }

  return {
    patchMaterial,
    setProbes,
    configure,
    setEnabled,
    bumpGeneration,
    frame,
    getState,
    getStackState,                                                           
    dispose,

    PROBE_EXTRA_TEX_UNITS,
  };
}
