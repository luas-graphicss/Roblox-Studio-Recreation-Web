import { fieldFromOccupancy, meshSmoothField, relaxPositions } from "../terrain/smoothMesher.js";
import { terrainStore, TerrainEvents } from "../terrain/terrainStore.js";
import { VOXEL_SIZE, materialColorRGB, materialName, materialIndexByName, isWaterMaterial, MATERIAL_COUNT } from "../terrain/materials.js";
import { atlasLayout, buildAtlasPixels } from "../terrain/terrainTextures.js";
import { explodeTrianglesWithMaterials, dominantMaterialAt } from "../terrain/triplanarMesh.js";
import { splitTriangleSoup, splitInstancesIntoCells } from "../terrain/meshChunks.js";
import {
  TRIPLANAR_CACHE_KEY,
  TRIPLANAR_TEX_SCALE,
  buildTriplanarVertexPars,
  buildTriplanarVertexMain,
  buildTriplanarFragPars,
  buildTriplanarFragMain,
} from "../terrain/triplanarShader.js";
import {
  WATER_CACHE_KEY,
  WATER_PLANAR_CACHE_SUFFIX,
  WAVE_AMP_STUDS,
  WAVE_SPEED_FACTOR,
  waveSpeedEffective,
  computeShoreDepth,
  buildWaterVertexPars,
  buildWaterNormalMain,
  buildWaterVertexMain,
  buildWaterFragPars,
  buildWaterFragMain,
  buildWaterEmissiveMain,
} from "../terrain/waterWaves.js";


import {
  buildWaterPlanarVertexPars,
  buildWaterPlanarVertexMain,
  buildWaterPlanarFragPars,
  buildWaterPlanarFragMain,
} from "../lighting/planarReflectionCore.js";
import { waterPlanarUniforms } from "./planarReflections.js";

import { waveClock } from "../terrain/waveClock.js";
import {
  GRASS_CACHE_KEY,
  collectGrassCells,
  buildGrassInstances,
  buildGrassVertexPars,
  buildGrassVertexMain,
} from "../terrain/decorations.js";
import { Events as InstanceEvents } from "../datamodel/instance.js";
import { bus } from "../core/eventBus.js";
import { store } from "../core/state.js";

import { registerFrameCallback } from "../core/frameDriver.js";

const MAX_FIELD_VOXELS = 4000000;                                    
const REBUILD_THROTTLE_MS = 60;
const TERRAIN_CHUNK_STUDS = 128;                                                     

export function createTerrainRenderer({ THREE, scene, requestRender, requestAnimRender, patchMaterial }) {


  const animRender = requestAnimRender || requestRender;
  const data = terrainStore.getData();
  const group = new THREE.Group();
  group.name = "TerrainRender";
  scene.add(group);


  const solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.0, side: THREE.FrontSide });


  solidMat.shadowSide = THREE.BackSide;






  const atlasInfo = atlasLayout();
  const atlas = buildAtlasPixels({
    count: MATERIAL_COUNT,
    nameOf: materialName,
    colorOf: materialColorRGB,
  });
  const atlasTex = new THREE.DataTexture(atlas.data, atlasInfo.width, atlasInfo.height);
  atlasTex.magFilter = THREE.LinearFilter;
  atlasTex.minFilter = THREE.LinearFilter;
  atlasTex.generateMipmaps = false;
  atlasTex.needsUpdate = true;
  solidMat.onBeforeCompile = (shader) => {
    shader.uniforms.uRswAtlas = { value: atlasTex };
    shader.uniforms.uRswTexScale = { value: TRIPLANAR_TEX_SCALE };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + buildTriplanarVertexPars())
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + buildTriplanarVertexMain());
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + buildTriplanarFragPars(atlasInfo))
      .replace("#include <color_fragment>", "#include <color_fragment>\n" + buildTriplanarFragMain());
  };
  solidMat.customProgramCacheKey = () => TRIPLANAR_CACHE_KEY;


  solidMat.userData.__rswBasePatch = solidMat.onBeforeCompile;
  solidMat.userData.__rswBaseKey = solidMat.customProgramCacheKey;


  if (typeof patchMaterial === "function") patchMaterial(solidMat);


  solidMat.envMapIntensity = 0.5;

  const waterMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.16, 0.5, 0.71), transparent: true, opacity: 0.7,
    roughness: 0.25, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide,
  });
  waterMat.userData.__rswMatName = "Water";
  waterMat.envMapIntensity = 0.85;


  const waterUniforms = {
    uRswTime: { value: 0 },
    uRswWaveAmp: { value: 0.75 },
    uRswWaveSpeed: { value: 1.2 },
    uRswGrab: { value: null },
    uRswGrabSize: { value: new THREE.Vector2(1, 1) },
    uRswGrabOn: { value: 0 },
  };
  waterMat.onBeforeCompile = (shader) => {
    shader.uniforms.uRswTime = waterUniforms.uRswTime;
    shader.uniforms.uRswWaveAmp = waterUniforms.uRswWaveAmp;
    shader.uniforms.uRswWaveSpeed = waterUniforms.uRswWaveSpeed;
    shader.uniforms.uRswGrab = waterUniforms.uRswGrab;
    shader.uniforms.uRswGrabSize = waterUniforms.uRswGrabSize;
    shader.uniforms.uRswGrabOn = waterUniforms.uRswGrabOn;

    shader.uniforms.uRswPlanar = waterPlanarUniforms.uRswPlanar;
    shader.uniforms.uRswPlanarMat = waterPlanarUniforms.uRswPlanarMat;
    shader.uniforms.uRswPlanarOn = waterPlanarUniforms.uRswPlanarOn;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + buildWaterVertexPars() + "\n" + buildWaterPlanarVertexPars())
      .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\n" + buildWaterNormalMain())

      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + buildWaterVertexMain())
      .replace("#include <project_vertex>", buildWaterPlanarVertexMain() + "\n#include <project_vertex>");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + buildWaterFragPars() + "\n" + buildWaterPlanarFragPars())
      .replace("#include <color_fragment>", "#include <color_fragment>\n" + buildWaterFragMain())

      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n" + buildWaterEmissiveMain() + "\n" + buildWaterPlanarFragMain());
  };
  waterMat.customProgramCacheKey = () => WATER_CACHE_KEY + WATER_PLANAR_CACHE_SUFFIX;


  waterMat.userData.__rswBasePatch = waterMat.onBeforeCompile;
  waterMat.userData.__rswBaseKey = waterMat.customProgramCacheKey;


  const GRASS_INDEX = materialIndexByName("Grass");
  const grassUniforms = {
    uRswTime: { value: 0 },
    uRswSway: { value: 0.3 },
  };
  const grassColor = materialColorRGB(GRASS_INDEX);
  const grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0, metalness: 0.0, side: THREE.DoubleSide });
  grassMat.color.setRGB(
    Math.min(1, grassColor[0] * 1.1),
    Math.min(1, grassColor[1] * 1.18),
    Math.min(1, grassColor[2] * 1.0),
  );
  grassMat.envMapIntensity = 0.35;
  grassMat.onBeforeCompile = (shader) => {
    shader.uniforms.uRswTime = grassUniforms.uRswTime;
    shader.uniforms.uRswSway = grassUniforms.uRswSway;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + buildGrassVertexPars())
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + buildGrassVertexMain());
  };
  grassMat.customProgramCacheKey = () => GRASS_CACHE_KEY;
  grassMat.userData.__rswBasePatch = grassMat.onBeforeCompile;
  grassMat.userData.__rswBaseKey = grassMat.customProgramCacheKey;

  if (typeof patchMaterial === "function") patchMaterial(grassMat);


  function makeBladeGeometry() {
    const positions = [], normals = [], colors = [], bends = [], indices = [];
    const planes = [[1, 0], [0, 1]];                            
    let base = 0;
    for (const [qx, qz] of planes) {
      const verts = [
        [-0.5 * qx, 0, -0.5 * qz, 0], [0.5 * qx, 0, 0.5 * qz, 0],
        [-0.125 * qx, 1, -0.125 * qz, 1], [0.125 * qx, 1, 0.125 * qz, 1],
      ];
      for (const v of verts) {
        positions.push(v[0], v[1], v[2]);
        normals.push(0, 1, 0);
        const l = 0.45 + v[3] * 0.55;
        colors.push(l, l, l);
        bends.push(v[3]);
      }
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      base += 4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(normals), 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(colors), 3));
    geo.setAttribute("rswBend", new THREE.BufferAttribute(new Float32Array(bends), 1));
    geo.setIndex(indices);
    return geo;
  }
  const bladeGeo = makeBladeGeometry();

  let solidMeshes = [];                                    
  let waterMesh = null;
  let grassMeshes = [];                             
  let grassMesh = null;                                                    


  const ANIM_VIS_TIMEOUT_MS = 400;
  let animSeenMs = (typeof performance !== "undefined" ? performance.now() : Date.now());
  function markAnimSeen() { animSeenMs = (typeof performance !== "undefined" ? performance.now() : Date.now()); }

  function disposeMesh(mesh) {
    if (!mesh) return;
    group.remove(mesh);
    if (mesh.geometry) mesh.geometry.dispose();
  }

  function disposeGrass() {
    for (const m of grassMeshes) {
      group.remove(m);


      if (typeof m.dispose === "function") m.dispose();
    }
    grassMeshes = [];
    grassMesh = null;
  }

  const occOf = (x, y, z) => data.getOcc(x, y, z);
  const matOf = (x, y, z) => data.getMat(x, y, z);

  function solidOccAt(x, y, z) {
    const o = data.getOcc(x, y, z);
    if (o <= 0) return 0;
    return isWaterMaterial(data.getMat(x, y, z)) ? 0 : o;
  }
  function waterOccAt(x, y, z) {
    const o = data.getOcc(x, y, z);
    if (o <= 0) return 0;
    return isWaterMaterial(data.getMat(x, y, z)) ? o : 0;
  }




  function sampleColor(fx, fy, fz) {
    const cx = Math.floor(fx), cy = Math.floor(fy), cz = Math.floor(fz);
    let r = 0, g = 0, b = 0, w = 0;
    for (let dz = -1; dz <= 0; dz++)
      for (let dy = -1; dy <= 0; dy++)
        for (let dx = -1; dx <= 0; dx++) {
          const o = data.getOcc(cx + dx, cy + dy, cz + dz);
          if (o <= 0) continue;
          const m = data.getMat(cx + dx, cy + dy, cz + dz);
          if (isWaterMaterial(m)) continue;
          const c = materialColorRGB(m);
          r += c[0] * o; g += c[1] * o; b += c[2] * o; w += o;
        }
    if (w <= 0) return [0.5, 0.5, 0.5];
    r /= w; g /= w; b /= w;

    const hsh = Math.sin(fx * 12.9898 + fy * 78.233 + fz * 37.719) * 43758.5453;
    const j = 1 + (hsh - Math.floor(hsh) - 0.5) * 0.12;
    return [Math.min(1, r * j), Math.min(1, g * j), Math.min(1, b * j)];
  }


  function buildGeometry(min, dims, occFn, withColor, withWaterInfo) {
    const size = dims[0] * dims[1] * dims[2];
    if (size <= 0 || size > MAX_FIELD_VOXELS) return null;
    const raw = new Float32Array(size);
    for (let z = 0; z < dims[2]; z++)
      for (let y = 0; y < dims[1]; y++)
        for (let x = 0; x < dims[0]; x++)
          raw[x + dims[0] * (y + dims[1] * z)] = occFn(min[0] + x, min[1] + y, min[2] + z);
    const field = fieldFromOccupancy(raw, dims);
    const { positions, normals, indices } = meshSmoothField(field, dims);
    if (!positions.length || !indices.length) return null;
    relaxPositions(positions, indices, { amount: 0.35, maxOffset: 0.45, passes: 1 });
    const colors = withColor ? new Float32Array(positions.length) : null;
    const mats = withColor ? new Float32Array(positions.length / 3) : null;
    const shore = withWaterInfo ? new Float32Array(positions.length / 3) : null;
    const depth = withWaterInfo ? new Float32Array(positions.length / 3) : null;
    for (let i = 0; i < positions.length; i += 3) {
      const wx = min[0] + positions[i];
      const wy = min[1] + positions[i + 1];
      const wz = min[2] + positions[i + 2];
      positions[i] = wx * VOXEL_SIZE;
      positions[i + 1] = wy * VOXEL_SIZE;
      positions[i + 2] = wz * VOXEL_SIZE;
      if (colors) {
        const c = sampleColor(wx, wy, wz);
        colors[i] = c[0]; colors[i + 1] = c[1]; colors[i + 2] = c[2];
        mats[i / 3] = dominantMaterialAt(occOf, matOf, isWaterMaterial, wx, wy, wz);
      }
      if (shore) {
        const sd = computeShoreDepth(solidOccAt, waterOccAt, wx, wy, wz);
        shore[i / 3] = sd.shore;
        depth[i / 3] = sd.depth;
      }
    }
    if (withColor) {


      const ex = explodeTrianglesWithMaterials(
        { positions, normals, colors, indices, materials: mats },
        { maxMaterial: atlasInfo.slots - 1 },
      );
      if (!ex) return null;


      if (ex.truncated && typeof console !== "undefined" && console.warn) {
        console.warn("Terreno: malha excedeu o teto de vértices e foi truncada — parte do terreno pode não aparecer.");
      }


      const chunks = splitTriangleSoup(ex, { cellSize: TERRAIN_CHUNK_STUDS });
      if (!chunks || !chunks.length) return null;
      const geos = [];
      for (const ch of chunks) {
        const cg = new THREE.BufferGeometry();
        cg.setAttribute("position", new THREE.BufferAttribute(ch.positions, 3));
        cg.setAttribute("normal", new THREE.BufferAttribute(ch.normals, 3));
        cg.setAttribute("color", new THREE.BufferAttribute(ch.colors, 3));


        cg.setAttribute("rswMats", new THREE.BufferAttribute(Uint8Array.from(ch.mats), 3));
        cg.setAttribute("rswWeights", new THREE.BufferAttribute(Uint8Array.from(ch.weights), 3));
        cg.boundingBox = new THREE.Box3(
          new THREE.Vector3(ch.bounds.min[0], ch.bounds.min[1], ch.bounds.min[2]),
          new THREE.Vector3(ch.bounds.max[0], ch.bounds.max[1], ch.bounds.max[2]),
        );
        cg.boundingSphere = cg.boundingBox.getBoundingSphere(new THREE.Sphere());
        geos.push(cg);
      }
      return geos;
    } else {


      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
      if (shore) {
        geo.setAttribute("rswShore", new THREE.BufferAttribute(shore, 1));
        geo.setAttribute("rswDepth", new THREE.BufferAttribute(depth, 1));
      }
      geo.setIndex(new THREE.BufferAttribute(indices, 1));
      return geo;
    }
  }

  function syncWaterMaterial() {
    const inst = terrainStore.getTerrainInstance();
    if (!inst || typeof inst.getProperty !== "function") return;
    const col = inst.getProperty("WaterColor");
    if (col && typeof col.r === "number") waterMat.color.setRGB(col.r, col.g, col.b);
    const transparency = inst.getProperty("WaterTransparency");
    if (typeof transparency === "number") waterMat.opacity = Math.max(0.05, Math.min(1, 1 - transparency));
    const reflectance = inst.getProperty("WaterReflectance");
    if (typeof reflectance === "number") {
      waterMat.metalness = Math.max(0, Math.min(0.8, reflectance * 0.7));
      waterMat.roughness = Math.max(0.05, 0.6 - reflectance * 0.5);
    }


    const waveSize = inst.getProperty("WaterWaveSize");
    if (typeof waveSize === "number") waterUniforms.uRswWaveAmp.value = Math.max(0, Math.min(1, waveSize)) * WAVE_AMP_STUDS;
    const waveSpeed = inst.getProperty("WaterWaveSpeed");
    if (typeof waveSpeed === "number") waterUniforms.uRswWaveSpeed.value = waveSpeedEffective(waveSpeed) * WAVE_SPEED_FACTOR;
    waterMat.needsUpdate = true;
  }

  function decorationsEnabled() {
    const inst = terrainStore.getTerrainInstance();
    if (!inst || typeof inst.getProperty !== "function") return false;
    return inst.getProperty("Decoration") === true;
  }


  function makeGrassChunk(inst) {
    const grassMesh = new THREE.InstancedMesh(bladeGeo, grassMat, inst.count);
    grassMesh.name = "TerrainGrass";


    grassMesh.castShadow = false;
    grassMesh.receiveShadow = true;

    grassMesh.onBeforeRender = markAnimSeen;
    if (grassMesh.boundingSphere !== undefined) {


      grassMesh.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(inst.center[0], inst.center[1], inst.center[2]),
        inst.radius + 4,
      );
      grassMesh.frustumCulled = true;
    } else {


      grassMesh.frustumCulled = false;
    }
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const col = new THREE.Color();
    const d = inst.data, s = inst.stride;
    for (let i = 0; i < inst.count; i++) {
      const o = i * s;
      pos.set(d[o], d[o + 1], d[o + 2]);
      q.setFromAxisAngle(up, d[o + 3]);
      scl.set(d[o + 4], d[o + 5], d[o + 4]);
      m4.compose(pos, q, scl);
      grassMesh.setMatrixAt(i, m4);
      const t = d[o + 6];
      col.setRGB(Math.min(1, t * 1.02), Math.min(1, t * 1.06), Math.min(1, t * 0.9));
      grassMesh.setColorAt(i, col);
    }
    grassMesh.instanceMatrix.needsUpdate = true;
    if (grassMesh.instanceColor) grassMesh.instanceColor.needsUpdate = true;
    return grassMesh;
  }


  function rebuildGrass() {
    disposeGrass();
    if (!decorationsEnabled()) { requestRender && requestRender(); return; }
    const b = data.getBounds();
    if (!b) { requestRender && requestRender(); return; }
    const cells = collectGrassCells({
      getOcc: occOf,
      getMat: matOf,
      isGrass: (m) => m === GRASS_INDEX,
      bounds: b,
    });
    const instAll = buildGrassInstances(cells, { voxelSize: VOXEL_SIZE });
    if (!instAll.count) { requestRender && requestRender(); return; }


    const cellChunks = splitInstancesIntoCells(instAll, { cellSize: TERRAIN_CHUNK_STUDS });
    for (const chunk of cellChunks) {
      const m = makeGrassChunk(chunk);
      grassMeshes.push(m);
      group.add(m);

      m.matrixAutoUpdate = false;
      m.updateWorldMatrix(true, false);
      if ("matrixWorldAutoUpdate" in m) m.matrixWorldAutoUpdate = false;
    }
    grassMesh = grassMeshes.length ? grassMeshes[0] : null;
    requestRender && requestRender();
  }

  function rebuild() {
    for (const m of solidMeshes) disposeMesh(m);
    solidMeshes = [];
    disposeMesh(waterMesh); waterMesh = null;
    const b = data.getBounds();
    if (!b) { disposeGrass(); requestRender && requestRender(); return; }

    const min = [b.min[0] - 1, b.min[1] - 1, b.min[2] - 1];
    const max = [b.max[0] + 2, b.max[1] + 2, b.max[2] + 2];
    const dims = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];

    const solidGeos = buildGeometry(min, dims, solidOccAt, true, false);
    if (solidGeos) {
      for (const cg of solidGeos) {
        const solidMesh = new THREE.Mesh(cg, solidMat);
        solidMesh.name = "TerrainSolid";


        solidMesh.castShadow = true;
        solidMesh.receiveShadow = true;

        solidMesh.matrixAutoUpdate = false;
        solidMeshes.push(solidMesh);
        group.add(solidMesh);


        solidMesh.updateWorldMatrix(true, false);
        if ("matrixWorldAutoUpdate" in solidMesh) solidMesh.matrixWorldAutoUpdate = false;
      }
    }

    const waterGeo = buildGeometry(min, dims, waterOccAt, false, true);
    if (waterGeo) {
      syncWaterMaterial();
      waterMesh = new THREE.Mesh(waterGeo, waterMat);
      waterMesh.name = "TerrainWater";


      waterMesh.receiveShadow = true;

      waterMesh.onBeforeRender = markAnimSeen;
      group.add(waterMesh);
    }
    rebuildGrass();
    grabHasPrev = false;                                                        
    requestRender && requestRender();
  }


  let pending = false, timer = null;
  function scheduleRebuild() {
    if (pending) return;
    pending = true;
    function rebuildWhenEditorIsVisible() {
      timer = null;
      if (disposed) return;

      if (store.get("appMode") === "START_PAGE") return;
      try { rebuild(); }
      finally { pending = false; }
    }
    timer = setTimeout(rebuildWhenEditorIsVisible, REBUILD_THROTTLE_MS);
  }


  let disposed = false;
  let animClock = 0;
  let unregisterFrameCallback = null;
  let animLast = (typeof performance !== "undefined" ? performance.now() : Date.now());
  function animTick(now) {
    if (disposed) return;
    const dt = Math.min(0.05, Math.max(0, (now - animLast) / 1000));
    animLast = now;
    const waterActive = !!waterMesh && waterUniforms.uRswWaveAmp.value > 0.001;
    const grassActive = !!grassMesh;
    if (!waterActive && !grassActive) return;


    if (now - animSeenMs > ANIM_VIS_TIMEOUT_MS) return;
    animClock += dt;
    waterUniforms.uRswTime.value = animClock;
    grassUniforms.uRswTime.value = animClock;
    waveClock.time = animClock;                                              
    animRender && animRender();
  }
  unregisterFrameCallback = registerFrameCallback("animation", animTick, "terrainRender:waterAndGrass");


  let grabTarget = null;
  const grabSizeTmp = new THREE.Vector2();
  const GRAB_MAX_SIZE = 1280;                                             
  const grabFrustum = new THREE.Frustum();
  const grabViewInvTmp = new THREE.Matrix4();
  const grabProjViewTmp = new THREE.Matrix4();
  const grabSphereTmp = new THREE.Sphere();
  const grabPrevView = new THREE.Matrix4();
  const grabPrevProj = new THREE.Matrix4();
  let grabHasPrev = false;                                              
  let grabInterleave = 0;                                                  


  function grabWaterOnScreen(camera) {
    const geo = waterMesh.geometry;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    if (!geo.boundingSphere) return true;
    grabViewInvTmp.copy(camera.matrixWorld).invert();
    grabProjViewTmp.multiplyMatrices(camera.projectionMatrix, grabViewInvTmp);
    grabFrustum.setFromProjectionMatrix(grabProjViewTmp);
    grabSphereTmp.copy(geo.boundingSphere).applyMatrix4(waterMesh.matrixWorld);
    return grabFrustum.intersectsSphere(grabSphereTmp);
  }
  function renderWaterGrab(renderer, camera) {
    if (disposed || !renderer || !camera || !waterMesh || !waterMesh.visible) {
      waterUniforms.uRswGrabOn.value = 0;
      return;
    }
    camera.updateMatrixWorld();
    waterMesh.updateWorldMatrix(true, false);
    if (!grabWaterOnScreen(camera)) { grabHasPrev = false; return; }       
    renderer.getDrawingBufferSize(grabSizeTmp);
    const grabScale = Math.min(0.5, GRAB_MAX_SIZE / Math.max(1, grabSizeTmp.x, grabSizeTmp.y));       
    const gw = Math.max(2, Math.floor(grabSizeTmp.x * grabScale));
    const gh = Math.max(2, Math.floor(grabSizeTmp.y * grabScale));


    const contFrames = waterUniforms.uRswWaveAmp.value > 0.001 || !!grassMesh;
    const camSame = contFrames && grabHasPrev && !!grabTarget &&
      grabTarget.width === gw && grabTarget.height === gh &&
      waterUniforms.uRswGrabOn.value === 1 &&
      grabPrevView.equals(camera.matrixWorld) &&
      grabPrevProj.equals(camera.projectionMatrix);
    if (camSame) {
      grabInterleave = (grabInterleave + 1) & 1;
      if (grabInterleave === 1) return;                                     
    } else {
      grabInterleave = 0;
    }
    if (!grabTarget) {
      grabTarget = new THREE.WebGLRenderTarget(gw, gh, { stencilBuffer: false });
      grabTarget.texture.minFilter = THREE.LinearFilter;
      grabTarget.texture.magFilter = THREE.LinearFilter;
      grabTarget.texture.generateMipmaps = false;
    } else if (grabTarget.width !== gw || grabTarget.height !== gh) {
      grabTarget.setSize(gw, gh);
    }


    waterMesh.visible = false;
    waterUniforms.uRswGrabOn.value = 0;
    const prevTarget = renderer.getRenderTarget();


    const prevShadowAuto = renderer.shadowMap.autoUpdate;
    const shadowsReady = !!(renderer.info && renderer.info.render && renderer.info.render.frame > 0);
    try {
      if (shadowsReady) renderer.shadowMap.autoUpdate = false;
      renderer.setScissorTest(false);
      renderer.setRenderTarget(grabTarget);
      renderer.clear();
      renderer.render(scene, camera);
    } finally {
      renderer.setRenderTarget(prevTarget);
      waterMesh.visible = true;
      renderer.shadowMap.autoUpdate = prevShadowAuto;
    }
    waterUniforms.uRswGrab.value = grabTarget.texture;


    waterUniforms.uRswGrabSize.value.set(grabSizeTmp.x, grabSizeTmp.y);
    waterUniforms.uRswGrabOn.value = 1;
    grabPrevView.copy(camera.matrixWorld);                                    
    grabPrevProj.copy(camera.projectionMatrix);
    grabHasPrev = true;
  }

  const offChanged = bus.on(TerrainEvents.Changed, scheduleRebuild);
  const offAppMode = bus.on("appmode:changed", () => {
    if (pending && timer === null && store.get("appMode") === "EDITOR") {
      pending = false;
      scheduleRebuild();
    }
  });
  const offWater = bus.on(TerrainEvents.WaterChanged, () => { syncWaterMaterial(); requestRender && requestRender(); });


  const offProps = bus.on(InstanceEvents.PropertyChanged, (e) => {
    if (!e || !e.instance || e.instance.className !== "Terrain") return;
    const p = e.property;
    if (p === "Decoration") { rebuildGrass(); return; }
    if (typeof p === "string" && p.indexOf("Water") === 0) {
      syncWaterMaterial();
      requestRender && requestRender();
    }
  });
  terrainStore.ensureSubscribed();
  rebuild();

  return {
    rebuild,
    isPreparing: () => pending,
    renderWaterGrab,                                                               


    getWaterMesh() { return waterMesh; },
    getRaycastTargets() { return [...solidMeshes, waterMesh].filter(Boolean); },
    dispose() {
      disposed = true;
      if (unregisterFrameCallback) { unregisterFrameCallback(); unregisterFrameCallback = null; }
      if (timer) clearTimeout(timer);
      if (typeof offChanged === "function") offChanged();
      if (typeof offAppMode === "function") offAppMode();
      if (typeof offWater === "function") offWater();
      if (typeof offProps === "function") offProps();
      for (const m of solidMeshes) disposeMesh(m);
      solidMeshes = [];
      disposeMesh(waterMesh); disposeGrass();
      if (grabTarget) { grabTarget.dispose(); grabTarget = null; }              
      bladeGeo.dispose();
      scene.remove(group);
      solidMat.dispose(); waterMat.dispose(); grassMat.dispose(); atlasTex.dispose();
    },
  };
}
