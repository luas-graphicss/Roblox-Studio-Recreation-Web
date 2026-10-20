import {
  GI_DIM,
  GI_MAX_BOXES,
  createGrid,
  fitGridToBoxes,
  voxelizeBoxes,
  listSurfaceCells,
  injectSun,
  prepareLights,
  injectLights,
  propagateStep,
  bounceInject,
  bake,
} from "../lighting/voxelGiCore.js";
import { giAtlasLayout, repackGiAtlas } from "../lighting/giAtlasCore.js";
import {
  bakeSkyVisAlpha,
  buildColumnTops,
  computeSkyVis,
  sanitizeSkyBentSettings,
} from "../lighting/skyVisCore.js";


import { giSliceProfile } from "../lighting/giSliceCore.js";
import { heightAtJs } from "../lighting/farShadowCore.js";


import {
  GI_BOUNCE_MAX_EXTRA,
  GI_EMISSIVES_PER_SLICE,
  buildGiSpecularGlsl,
  injectEmissives,
} from "../lighting/giBounceCore.js";


const SKY_CFG = sanitizeSkyBentSettings({});
const ITER_A = 4;
const ITER_B = 3;


const ITER_EXTRA_F39 = 2;

const VERT_PARS = "varying vec3 vRswGiPos;\n";
const VERT_MAIN = [
  "",
  "vec4 rswGiW = vec4( transformed, 1.0 );",
  "#ifdef USE_INSTANCING",
  "rswGiW = instanceMatrix * rswGiW;",
  "#endif",
  "vRswGiPos = ( modelMatrix * rswGiW ).xyz;",
].join("\n");

const FRAG_PARS_COMMON = [
  "uniform float uRswSkyAmount;",

  "uniform float uRswGiSpec;",
  "uniform vec3 uRswGiOrigin;",
  "uniform vec3 uRswGiSpan;",
  "uniform float uRswGiCell;",
  "uniform float uRswGiAmount;",
  "varying vec3 vRswGiPos;",
].join("\n");

const FRAG_PARS_3D = [
  "uniform highp sampler3D uRswGiTex;",
  FRAG_PARS_COMMON,
  "vec3 rswSampleGi( vec3 p, vec3 n ) {",
  "\tvec3 uvw = ( p + n * uRswGiCell * 0.75 - uRswGiOrigin ) / uRswGiSpan;",
  "\tif ( any( lessThan( uvw, vec3( 0.0 ) ) ) || any( greaterThan( uvw, vec3( 1.0 ) ) ) ) return vec3( 0.0 );",
  "\treturn texture( uRswGiTex, uvw ).rgb;",
  "}",
  "// Fase 10: alfa = sky visibility; fora da grade o céu é aberto (1.0).",
  "float rswSampleSkyA( vec3 p, vec3 n ) {",
  "\tvec3 uvw = ( p + n * uRswGiCell * 0.75 - uRswGiOrigin ) / uRswGiSpan;",
  "\tif ( any( lessThan( uvw, vec3( 0.0 ) ) ) || any( greaterThan( uvw, vec3( 1.0 ) ) ) ) return 1.0;",
  "\treturn texture( uRswGiTex, uvw ).a;",
  "}",
  "",
].join("\n");


function buildFragParsAtlas(dim, atlas) {
  const dimF = dim.toFixed(1);
  const txF = atlas.tilesX.toFixed(1);
  const tyF = atlas.tilesY.toFixed(1);
  return [
    "uniform sampler2D uRswGiTex;",
    FRAG_PARS_COMMON,
    "vec3 rswGiSlice( vec2 xy, float sliceZ ) {",
    "\tvec2 tile = vec2( mod( sliceZ, " + txF + " ), floor( sliceZ / " + txF + " ) );",
    "\treturn texture2D( uRswGiTex, ( tile + xy ) / vec2( " + txF + ", " + tyF + " ) ).rgb;",
    "}",
    "vec3 rswSampleGi( vec3 p, vec3 n ) {",
    "\tvec3 uvw = ( p + n * uRswGiCell * 0.75 - uRswGiOrigin ) / uRswGiSpan;",
    "\tif ( any( lessThan( uvw, vec3( 0.0 ) ) ) || any( greaterThan( uvw, vec3( 1.0 ) ) ) ) return vec3( 0.0 );",
    "\tvec2 xy = clamp( uvw.xy, vec2( 0.5 / " + dimF + " ), vec2( 1.0 - 0.5 / " + dimF + " ) );",
    "\tfloat zf = clamp( uvw.z * " + dimF + " - 0.5, 0.0, " + dimF + " - 1.0 );",
    "\tfloat z0 = floor( zf );",
    "\tvec3 a = rswGiSlice( xy, z0 );",
    "\tvec3 b = rswGiSlice( xy, min( z0 + 1.0, " + dimF + " - 1.0 ) );",
    "\treturn mix( a, b, zf - z0 );",
    "}",
    "float rswGiSliceA( vec2 xy, float sliceZ ) {",
    "\tvec2 tile = vec2( mod( sliceZ, " + txF + " ), floor( sliceZ / " + txF + " ) );",
    "\treturn texture2D( uRswGiTex, ( tile + xy ) / vec2( " + txF + ", " + tyF + " ) ).a;",
    "}",
    "// Fase 10: alfa = sky visibility (trilinear manual); fora da grade 1.0.",
    "float rswSampleSkyA( vec3 p, vec3 n ) {",
    "\tvec3 uvw = ( p + n * uRswGiCell * 0.75 - uRswGiOrigin ) / uRswGiSpan;",
    "\tif ( any( lessThan( uvw, vec3( 0.0 ) ) ) || any( greaterThan( uvw, vec3( 1.0 ) ) ) ) return 1.0;",
    "\tvec2 xy = clamp( uvw.xy, vec2( 0.5 / " + dimF + " ), vec2( 1.0 - 0.5 / " + dimF + " ) );",
    "\tfloat zf = clamp( uvw.z * " + dimF + " - 0.5, 0.0, " + dimF + " - 1.0 );",
    "\tfloat z0 = floor( zf );",
    "\tfloat a = rswGiSliceA( xy, z0 );",
    "\tfloat b = rswGiSliceA( xy, min( z0 + 1.0, " + dimF + " - 1.0 ) );",
    "\treturn mix( a, b, zf - z0 );",
    "}",
    "",
  ].join("\n");
}

const FRAG_MAIN = [
  "",
  "if ( uRswGiAmount > 0.001 ) {",
  "\treflectedLight.indirectDiffuse += rswSampleGi( vRswGiPos, normal ) * uRswGiAmount * BRDF_Lambert( diffuseColor.rgb );",
  "}",
].join("\n");





const FRAG_SPEC_STD = buildGiSpecularGlsl(true);
const FRAG_SPEC_BASIC = buildGiSpecularGlsl(false);





const FRAG_SKY_MAIN = [
  "",
  "if ( uRswSkyAmount > 0.001 ) {",
  "\tirradiance *= mix( 1.0, rswSampleSkyA( vRswGiPos, normal ), uRswSkyAmount );",
  "}",
  "",
].join("\n");


const ST_IDLE = 0;
const ST_VOXELIZE = 1;
const ST_SURFACE = 2;
const ST_SUN = 3;
const ST_LIGHTS = 4;
const ST_PROP_A = 5;
const ST_BOUNCE = 6;
const ST_PROP_B = 7;
const ST_BAKE = 8;

const ST_SKYVIS = 9;


const ST_ALPHA = 10;



const ST_EMISSIVE = 11;

function nowMs() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

export function createVoxelGI({ THREE, renderer, weakGpu, tier }) {




  const profile = giSliceProfile({ weak: weakGpu === true, tier: tier || "" });
  const dim = profile.dim;
  const caps = renderer && renderer.capabilities ? renderer.capabilities : null;
  const has3d = !!(THREE && THREE.Data3DTexture && caps && caps.isWebGL2 !== false);
  const atlas = giAtlasLayout(dim);
  const atlasFits =
    !caps ||
    !Number.isFinite(caps.maxTextureSize) ||
    caps.maxTextureSize >= Math.max(atlas.width, atlas.height);
  const hasAtlas = !!(THREE && THREE.DataTexture && caps && atlasFits);


  const mode = has3d ? "3d" : hasAtlas ? "atlas" : "off";
  const supported = mode !== "off";
  const total = dim * dim * dim;
  const texData = new Uint8Array(total * 4);


  const fragParsAtlas = mode === "atlas" ? buildFragParsAtlas(dim, atlas) : null;
  let atlasData = null;
  let texture = null;
  let disposed = false;


  let bakedOnce = false;
  let wantedAmount = 0;



  let wantedSky = 0;





  let patchGen = 0;

  if (mode === "3d") {
    texture = new THREE.Data3DTexture(texData, dim, dim, dim);
  } else if (mode === "atlas") {
    atlasData = new Uint8Array(atlas.width * atlas.height * 4);
    texture = new THREE.DataTexture(atlasData, atlas.width, atlas.height);



    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.flipY = false;
  }
  if (texture) {
    texture.format = THREE.RGBAFormat;
    texture.type = THREE.UnsignedByteType;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
  }



  const uniforms = {
    uRswGiTex: { value: texture },
    uRswSkyAmount: { value: 0 },
    uRswGiOrigin: { value: supported ? new THREE.Vector3(0, 0, 0) : null },
    uRswGiSpan: { value: supported ? new THREE.Vector3(1, 1, 1) : null },
    uRswGiCell: { value: 1 },
    uRswGiAmount: { value: 0 },

    uRswGiSpec: { value: 0 },
  };

  function injectShader(shader, specVariant) {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      VERT_PARS +
      shader.vertexShader.replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>" + VERT_MAIN,
      );





    shader.fragmentShader =
      (mode === "atlas" ? fragParsAtlas : FRAG_PARS_3D) +
      shader.fragmentShader.replace(
        "#include <lights_fragment_end>",
        FRAG_SKY_MAIN + "#include <lights_fragment_end>" + FRAG_MAIN + (specVariant === "s" ? FRAG_SPEC_STD : specVariant === "b" ? FRAG_SPEC_BASIC : ""),
      );
  }


  function patchMaterial(mat) {
    if (!supported || disposed || !mat || !mat.userData || mat.userData.__rswGi) return;
    if (!mat.isMeshLambertMaterial && !mat.isMeshPhongMaterial && !mat.isMeshStandardMaterial) return;
    mat.userData.__rswGi = true;
    const prev = mat.onBeforeCompile;
    const prevKey = typeof mat.customProgramCacheKey === "function" ? mat.customProgramCacheKey.bind(mat) : null;


    const specVariant = mat.isMeshStandardMaterial ? "s" : mat.isMeshPhongMaterial ? "b" : "n";
    mat.onBeforeCompile = function (shader, rnd) {
      if (typeof prev === "function") prev.call(this, shader, rnd);
      injectShader(shader, specVariant);
    };
    const gen = patchGen;


    const dimTag = dim === GI_DIM ? "" : "|d" + dim;


    mat.customProgramCacheKey = () =>
      (prevKey ? String(prevKey()) : "") + (mode === "atlas" ? "|rswGiSky2ag" : "|rswGiSky1g") + gen + dimTag + "|b39" + specVariant;
    mat.needsUpdate = true;
  }


  let job = null;
  let pending = null;
  let stage = ST_IDLE;
  let cursor = 0;
  let iter = 0;
  let grid = null;
  let surf = null;
  let bufIn = null;
  let bufOut = null;


  let skyArr = null;
  let skyTops = null;


  let terrainProvider = null;
  let jobHfSample = undefined;


  let bouncePlan = null;
  let jobEmissives = null;
  let jobExtraBounces = 0;


  let jobExtraSweeps = ITER_EXTRA_F39;
  let bounceRound = 0;
  let jobEmissiveCells = 0;
  let lastEmissiveCells = 0;
  let lastBounceRounds = 0;
  let wantedSpec = 0;


  function setTerrainProvider(fn) {
    terrainProvider = typeof fn === "function" ? fn : null;
  }


  function getProfile() {
    return profile;
  }

  function requestRebuild(next) {
    if (!supported || disposed || !next) return;
    pending = next;
  }

  function isWorking() {
    return !!job || !!pending;
  }

  function beginJob() {
    job = pending;
    pending = null;


    const fit = fitGridToBoxes(job.boxes || [], job.focus || null, dim);
    grid = createGrid(fit.origin, fit.cell, dim);
    surf = null;
    skyTops = null;
    jobHfSample = undefined;
    stage = ST_VOXELIZE;
    cursor = 0;
    iter = 0;

    jobEmissives =
      bouncePlan && bouncePlan.emissiveGi === true && Array.isArray(job.emissives) && job.emissives.length
        ? job.emissives
        : null;
    jobExtraBounces =
      bouncePlan && bouncePlan.on === true
        ? Math.min(GI_BOUNCE_MAX_EXTRA, Math.max(0, bouncePlan.extraBounces | 0))
        : 0;


    jobExtraSweeps =
      bouncePlan && Number.isFinite(bouncePlan.extraSweeps) && (bouncePlan.extraSweeps | 0) >= 1
        ? Math.min(4, bouncePlan.extraSweeps | 0)
        : ITER_EXTRA_F39;
    bounceRound = 0;
    jobEmissiveCells = 0;
  }


  function stageAfterDirect() {
    return jobEmissives ? ST_EMISSIVE : ST_PROP_A;
  }


  function step(budgetMs) {
    if (!supported || disposed) return false;
    if (!job) {
      if (!pending) return false;
      beginJob();
    }
    const t0 = nowMs();


    const budget = Math.max(0.25, budgetMs || 5);
    let published = false;
    while (nowMs() - t0 < budget && stage !== ST_IDLE) {
      switch (stage) {
        case ST_VOXELIZE: {
          const boxes = job.boxes || [];
          voxelizeBoxes(grid, boxes, cursor, cursor + profile.boxesPerSlice);
          cursor += profile.boxesPerSlice;


          if (cursor >= Math.min(boxes.length, GI_MAX_BOXES)) {
            stage = ST_SKYVIS;
            cursor = 0;
          }
          break;
        }
        case ST_SKYVIS: {

          if (!skyArr || skyArr.length !== grid.n) skyArr = new Float32Array(grid.n);
          if (!skyTops) skyTops = buildColumnTops(grid);


          if (cursor === 0 && profile.hfSkylight && terrainProvider) {
            let hf = null;
            try {
              hf = terrainProvider();
            } catch (_e) {
              hf = null;
            }
            jobHfSample =
              hf && !hf.empty && hf.data
                ? (wx, wz) => heightAtJs(hf, wx, wz)
                : undefined;
          }


          computeSkyVis(grid, skyTops, skyArr, cursor, cursor + profile.skyvisCellsPerSlice, jobHfSample, profile.lateralRays);
          cursor += profile.skyvisCellsPerSlice;
          if (cursor >= grid.n) {
            stage = ST_SURFACE;
            cursor = 0;
          }
          break;
        }
        case ST_SURFACE: {
          surf = listSurfaceCells(grid);
          job.preparedLights = prepareLights(job.lights);
          stage = job.sun ? ST_SUN : job.preparedLights.length ? ST_LIGHTS : stageAfterDirect();
          cursor = 0;
          break;
        }
        case ST_SUN: {


          injectSun(grid, surf, job.sun, cursor, cursor + profile.sunCellsPerSlice, job.transBoxes);
          cursor += profile.sunCellsPerSlice;
          if (cursor >= surf.length) {
            stage = job.preparedLights.length ? ST_LIGHTS : stageAfterDirect();
            cursor = 0;
          }
          break;
        }
        case ST_LIGHTS: {
          const liSlice = Math.max(100, Math.floor(profile.lightCellsPerSlice / job.preparedLights.length));
          injectLights(grid, surf, job.preparedLights, cursor, cursor + liSlice);
          cursor += liSlice;
          if (cursor >= surf.length) {
            stage = stageAfterDirect();
            cursor = 0;
          }
          break;
        }
        case ST_EMISSIVE: {


          jobEmissiveCells += injectEmissives(grid, jobEmissives, cursor, cursor + GI_EMISSIVES_PER_SLICE);
          cursor += GI_EMISSIVES_PER_SLICE;
          if (cursor >= jobEmissives.length) {
            stage = ST_PROP_A;
            cursor = 0;
          }
          break;
        }
        case ST_PROP_A: {


          if (iter === 0 && cursor === 0) {
            bufIn = grid.ea;
            bufOut = grid.eb;
          }
          propagateStep(grid, bufIn, bufOut, cursor, cursor + profile.propCellsPerSlice);
          cursor += profile.propCellsPerSlice;
          if (cursor >= grid.n) {
            cursor = 0;
            const t = bufIn; bufIn = bufOut; bufOut = t;
            iter += 1;
            if (iter >= ITER_A) {
              stage = ST_BOUNCE;
              iter = 0;
            }
          }
          break;
        }
        case ST_BOUNCE: {


          bounceInject(grid, surf, bufIn, cursor, cursor + profile.bounceCellsPerSlice);
          cursor += profile.bounceCellsPerSlice;
          if (cursor >= surf.length) {
            stage = ST_PROP_B;
            iter = 0;
            cursor = 0;
          }
          break;
        }
        case ST_PROP_B: {
          propagateStep(grid, bufIn, bufOut, cursor, cursor + profile.propCellsPerSlice);
          cursor += profile.propCellsPerSlice;
          if (cursor >= grid.n) {
            cursor = 0;
            const t = bufIn; bufIn = bufOut; bufOut = t;
            iter += 1;


            if (iter >= (bounceRound === 0 ? ITER_B : jobExtraSweeps)) {
              if (bounceRound < jobExtraBounces) {
                bounceRound += 1;
                iter = 0;
                stage = ST_BOUNCE;
              } else {
                stage = ST_BAKE;
              }
            }
          }
          break;
        }
        case ST_BAKE: {

          bake(grid, bufIn, texData, cursor, cursor + profile.bakeCellsPerSlice);
          cursor += profile.bakeCellsPerSlice;
          if (cursor >= grid.n) {
            stage = ST_ALPHA;
            cursor = 0;
          }
          break;
        }
        case ST_ALPHA: {


          if (skyArr && skyArr.length === grid.n) {
            bakeSkyVisAlpha(grid, skyArr, texData, cursor, cursor + profile.bakeCellsPerSlice);
            cursor += profile.bakeCellsPerSlice;
            if (cursor < grid.n) break;
          }
          if (atlasData) repackGiAtlas(texData, atlasData, dim, atlas.tilesX);
          uniforms.uRswGiOrigin.value.set(grid.origin[0], grid.origin[1], grid.origin[2]);



          const span = grid.cell * grid.dim;
          uniforms.uRswGiSpan.value.set(span, span, span);
          uniforms.uRswGiCell.value = grid.cell;
          texture.needsUpdate = true;
          bakedOnce = true;
          uniforms.uRswGiAmount.value = wantedAmount;
          uniforms.uRswSkyAmount.value = wantedSky;


          uniforms.uRswGiSpec.value = wantedSpec;
          lastEmissiveCells = jobEmissiveCells;
          lastBounceRounds = bounceRound;
          published = true;
          job = null;
          grid = null;
          surf = null;
          jobHfSample = undefined;
          jobEmissives = null;
          stage = ST_IDLE;
          break;
        }
        default:
          stage = ST_IDLE;
          break;
      }
    }
    return published;
  }

  function setAmount(v) {
    if (!supported) return;
    wantedAmount = Math.min(4, Math.max(0, Number.isFinite(v) ? v : 0));


    uniforms.uRswGiAmount.value = bakedOnce ? wantedAmount : 0;
  }


  function setSkyAmount(v) {
    if (!supported) return;
    const k = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
    wantedSky = k * SKY_CFG.skyAmount;
    uniforms.uRswSkyAmount.value = bakedOnce ? wantedSky : 0;
  }


  function setSpecAmount(v) {
    if (!supported) return;
    wantedSpec = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
    uniforms.uRswGiSpec.value = bakedOnce ? wantedSpec : 0;
  }


  function setBouncePlan(p) {
    bouncePlan = p && typeof p === "object" ? p : null;
  }


  function getBounceState() {
    return {
      extraBounces: jobExtraBounces,
      lastBounceRounds,
      lastEmissiveCells,
      specWanted: wantedSpec,
      specApplied: uniforms.uRswGiSpec.value,
    };
  }

  function hasBaked() {
    return bakedOnce;
  }

  function dispose() {
    disposed = true;
    job = null;
    pending = null;
    grid = null;
    surf = null;
    stage = ST_IDLE;


    wantedAmount = 0;
    wantedSky = 0;
    wantedSpec = 0;
    bouncePlan = null;
    jobEmissives = null;
    skyArr = null;
    skyTops = null;
    terrainProvider = null;
    jobHfSample = undefined;
    uniforms.uRswGiAmount.value = 0;
    uniforms.uRswSkyAmount.value = 0;
    uniforms.uRswGiSpec.value = 0;
    uniforms.uRswGiTex.value = null;
    if (texture) {
      texture.dispose();
      texture = null;
    }
  }

  function bumpGeneration() {
    patchGen += 1;
  }

  return {
    bumpGeneration,
    supported,
    mode,

    getProfile,
    setTerrainProvider,
    patchMaterial,
    requestRebuild,
    isWorking,
    step,
    setAmount,
    setSkyAmount,

    setBouncePlan,
    setSpecAmount,
    getBounceState,
    hasBaked,
    dispose,
  };
}
