import { buildCsgLods } from "./csgLod.js";
import { getSharedMeshLods, getSharedSubmeshLods } from "./meshLod.js";
import {
  MAX_PALETTE_INSTANCES,
  patchMaterialForPalette,
  writeIdentityRow,
} from "./skinnedPaletteCore.js";             


import { applyStandardPhysics } from "../lighting/materialPhysicsTable.js";
import { applyNeonPoolHdrPatch, getMaterialDef, patchNeonHdrChained } from "./baseMaterials.js";
import { LEGACY_NEON_DIFFUSE_BOOST } from "../lighting/emissiveNitsCore.js";


import { configureSurfaceMaterial, saWeakGpu } from "./appearanceRender.js";
import { surfaceSignature } from "../lighting/surfaceAppearanceCore.js";
import { markInstanceAttributeRange, writeInstanceAttribute, writeInstanceColor } from "./instanceAttributeRanges.js";


const INITIAL_CAPACITY = 16;
const NEON_BOOST = 2.2;                                                   
console.assert(
  NEON_BOOST === LEGACY_NEON_DIFFUSE_BOOST,
  "IL-F38: NEON_BOOST diferente de LEGACY_NEON_DIFFUSE_BOOST — paridade A/B pool×Part quebrada"
);


function rbxMatOf(rec) { return (rec && rec.material) || "Plastic"; }


function patchPoolNeonHdr(mat, onUniform, keyTag) {
  if (!mat) return false;
  if (Object.prototype.hasOwnProperty.call(mat, "onBeforeCompile")) return false;
  const patch = (shader) => applyNeonPoolHdrPatch(shader, onUniform);
  const keyFn = () => keyTag;
  mat.onBeforeCompile = patch;
  mat.customProgramCacheKey = keyFn;
  if (!mat.userData) mat.userData = {};
  mat.userData.__rswBasePatch = patch;


  mat.userData.__rswBaseKey = keyFn;
  mat.userData.__rswCplxNeonOn = onUniform;
  mat.needsUpdate = true;
  return true;
}
const DEFAULT_MAX_POOLS = 256;                                                 
const DEFAULT_MAX_CSG_GEOS = 64;                                     
const DEFAULT_MAX_PROTOS = 512;                                
const LOD_HYSTERESIS = 0.9;                                           

const ZERO16 = new Float32Array(16);                                           


export function csgHashOf(csg) {
  if (!csg || !Array.isArray(csg.parts) || !csg.parts.length) return null;
  const v3 = (v) => (v ? [v.x || 0, v.y || 0, v.z || 0] : [0, 0, 0]);
  const parts = csg.parts.map((p) => [
    p.shape || "Block",
    v3(p.size),
    v3(p.local),
    v3(p.rotation),
    p.negate ? 1 : 0,
    p.color ? [p.color.r, p.color.g, p.color.b] : 0,
  ]);
  return JSON.stringify([
    parts,
    v3(csg.baseSize),
    csg.usePartColor ? 1 : 0,
    Number.isFinite(csg.smoothingAngle) ? csg.smoothingAngle : 50,
  ]);
}

export function createComplexInstanced({
  THREE,
  scene,
  buildCsgGeometry,
  resolveMeshProto,
  applyPoolMaterial = null,
  makeTexture = null,
  makeSpecialGeo = null,                                                             
  requestRender = null,
  onMeshProtoReady = null,
  meshPoolGate = null,                                                                   
  posePaletteDriver = null,                                                             
  materialBatching = null,
  maxCsgParts = 24,
  maxPools = DEFAULT_MAX_POOLS,
  maxCsgGeos = DEFAULT_MAX_CSG_GEOS,
  maxProtos = DEFAULT_MAX_PROTOS,
}) {
  const pools = new Map();                   
  const byId = new Map();                     
  const csgGeos = new Map();                                                      
  const protos = new Map();                                                  
  const specialGeos = new Map();                                                          
  const hashCache = new WeakMap();                                        
  let hiddenIds = null;                                       
  let flatMode = false;                                        
  let disposed = false;

  const tmpMat = new THREE.Matrix4();
  const tmpMat2 = new THREE.Matrix4();                                            
  const tmpPos = new THREE.Vector3();
  const tmpScale = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const tmpEuler = new THREE.Euler();
  const tmpColor = new THREE.Color();
  const DEG = Math.PI / 180;


  const palettePools = new Set();                           
  let paletteIota = null;                                                        
  let paletteDriverOk = null;                                           

  function paletteDriverSupported() {
    if (!posePaletteDriver || typeof posePaletteDriver.fillRow !== "function") return false;
    if (paletteDriverOk == null) {
      try {
        paletteDriverOk = !!(
          typeof posePaletteDriver.supported === "function" &&
          posePaletteDriver.supported() &&
          typeof THREE.DataTexture === "function" &&
          typeof THREE.InstancedBufferAttribute === "function"
        );
      } catch (_) {
        paletteDriverOk = false;
      }
    }
    return paletteDriverOk;
  }

  function protoUsesPalette(proto) {
    return !!(proto && proto.skinned && proto.posePool && paletteDriverSupported());
  }


  function paletteHasRoom(rec) {
    const resolution = resolutionFor(rec);
    if (!resolution.ok) return false;
    const pool = pools.get(resolution.key);
    if (!pool || !pool.palette) return true;                                 
    return pool.slots.has(rec.id) || pool.count < MAX_PALETTE_INSTANCES;
  }

  function getPaletteIota() {
    if (!paletteIota) {
      const arr = new Float32Array(MAX_PALETTE_INSTANCES);
      for (let i = 0; i < arr.length; i++) arr[i] = i;
      paletteIota = new THREE.InstancedBufferAttribute(arr, 1);
    }
    return paletteIota;
  }

  function makePaletteTexture(buf, width, height) {
    const tex = new THREE.DataTexture(buf, width, height, THREE.RGBAFormat, THREE.FloatType);
    if (THREE.NearestFilter != null) {
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
    }
    tex.generateMipmaps = false;
    tex.flipY = false;
    tex.needsUpdate = true;
    return tex;
  }


  function paletteWriteSlot(pool, slot, rec) {
    const pal = pool.palette;
    if (!pal) return;
    if (rec !== undefined) pal.instances[slot] = rec && rec.instance ? rec.instance : null;
    const off = slot * pal.rowFloats;
    let ok = false;
    try {
      ok = !!posePaletteDriver.fillRow(pal.instances[slot], pal.meta, pal.buf, off);
    } catch (_) {
      ok = false;
    }
    if (!ok) writeIdentityRow(pal.buf, off, pal.meta.boneCount);
    pal.tex.needsUpdate = true;
  }

  function initPalettePool(pool, proto, mats) {
    try {
      const meta = proto.posePool;
      const rowFloats = meta.boneCount * 16;
      const buf = new Float32Array(pool.capacity * rowFloats);
      for (let s = 0; s < pool.capacity; s++) writeIdentityRow(buf, s * rowFloats, meta.boneCount);
      const tex = makePaletteTexture(buf, meta.texWidth, pool.capacity);
      const uniforms = {
        tex: { value: tex },
        dim: { value: { x: meta.texWidth, y: pool.capacity } },
      };

      const iota = getPaletteIota();
      const geos = new Set([pool.mesh.geometry]);
      if (pool.extras) for (const em of pool.extras) geos.add(em.geometry);
      if (pool.lods) {
        for (const lvl of pool.lods) {
          if (lvl && lvl.geo) geos.add(lvl.geo);
          if (lvl && lvl.extraGeos) for (const g of lvl.extraGeos) if (g) geos.add(g);
        }
      }
      for (const g of geos) {
        if (g && typeof g.setAttribute === "function" && !g.getAttribute("rswPaletteRow")) {
          g.setAttribute("rswPaletteRow", iota);
        }
      }

      const seen = new Set();
      for (const m of mats) {
        if (m && !seen.has(m)) {
          seen.add(m);
          patchMaterialForPalette(m, uniforms);
        }
      }
      let depthMat = null;
      let distMat = null;
      if (typeof THREE.MeshDepthMaterial === "function") {
        depthMat = new THREE.MeshDepthMaterial();
        if (THREE.RGBADepthPacking != null) depthMat.depthPacking = THREE.RGBADepthPacking;
        patchMaterialForPalette(depthMat, uniforms);
      }
      if (typeof THREE.MeshDistanceMaterial === "function") {
        distMat = new THREE.MeshDistanceMaterial();
        patchMaterialForPalette(distMat, uniforms);
      }
      for (const m of [pool.mesh, ...(pool.extras || [])]) {
        if (depthMat) m.customDepthMaterial = depthMat;
        if (distMat) m.customDistanceMaterial = distMat;
      }
      pool.palette = {
        meta,
        rowFloats,
        buf,
        tex,
        uniforms,
        depthMat,
        distMat,
        instances: new Array(pool.capacity).fill(null),
        dirty: new Set(),                                                
      };
      palettePools.add(pool);
    } catch (_) {


      pool.palette = null;
      palettePools.delete(pool);
      paletteDriverOk = false;
    }
  }

  function ping() {
    if (requestRender) requestRender();
  }

  function hashFor(rec) {
    let h = hashCache.get(rec.csg);
    if (h === undefined) {
      h = csgHashOf(rec.csg);
      hashCache.set(rec.csg, h);
    }
    return h;
  }

  function isCsgRec(rec) {
    return !!(rec && rec.csg && !rec.isMeshPart);
  }


  function specialOf(rec) {
    if (!rec || rec.isMeshPart || rec.csg || !rec.appearance) return null;
    const a = rec.appearance;
    if (!a.special || a.surface) return null;
    if (Array.isArray(a.layers) && a.layers.length) return null;
    return a.special;
  }


  function surfaceOf(rec) {
    if (!rec || !rec.isMeshPart || !rec.appearance) return null;
    const a = rec.appearance;
    if (!a.surface || a.special) return null;
    if (Array.isArray(a.layers) && a.layers.length) return null;
    return a.surface;
  }


  function clampSpecialScale(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return 1;
    return Math.min(1000, Math.max(0.001, Math.abs(v))) * (v < 0 ? -1 : 1) || 0.001;
  }

  function specialGeoFor(meshType) {
    const k = meshType || "Head";
    let geo = specialGeos.get(k);
    if (geo) return geo;
    if (!makeSpecialGeo) return null;
    try {
      geo = makeSpecialGeo(k) || null;
    } catch (_) {
      geo = null;
    }
    if (!geo) return null;
    geo.userData = geo.userData || {};
    geo.userData.__rswShared = true;                                               
    specialGeos.set(k, geo);
    return geo;
  }


  function surfColorKey(c) {
    const f = (v) => (Number.isFinite(v) ? v.toFixed(3) : "1");
    return c ? `${f(c.r)},${f(c.g)},${f(c.b)}` : "1,1,1";
  }

  function sizeKey(size) {
    const f = (v) => (Number.isFinite(v) ? v.toFixed(3) : "1");
    return size ? `${f(size.x)},${f(size.y)},${f(size.z)}` : "1,1,1";
  }


  function tOf(rec) {
    const tr = Math.min(1, Math.max(0, Number(rec && rec.transparency) || 0));
    const ltm = Math.min(1, Math.max(0, Number(rec && rec.localTransparency) || 0));
    return tr + (1 - tr) * ltm;
  }

  function keyFor(rec) {
    const sp = specialOf(rec);
    if (sp) {


      const isFileReal = sp.meshType === "FileMesh" && !!sp.meshId;
      const spMatSeg = isFileReal ? "" : `|m:${rbxMatOf(rec)}`;
      return `special|${sp.meshType || "Head"}|${sp.meshId || ""}|${sp.textureId || ""}${spMatSeg}`;
    }
    if (isCsgRec(rec)) {
      return `csg|${rec.material || "Plastic"}|${rec.materialVariant || ""}|${sizeKey(rec.size)}|t${tOf(rec).toFixed(3)}|${hashFor(rec)}`;
    }


    const surf = surfaceOf(rec);


    const sa = surf ? `|sa|${surfaceSignature(surf, { weakGpu: saWeakGpu() })}` : "";


    const matSeg = surf ? "" : `|m:${rbxMatOf(rec)}`;
    return `mesh|${rec.meshId || ""}|${rec.textureId || ""}|${rec.doubleSided ? "ds" : "ss"}${matSeg}${sa}`;
  }

  function resolutionFor(rec) {
    const hostBatchKey = keyFor(rec);
    return materialBatching ? materialBatching.resolve(rec, hostBatchKey) : { ok: true, key: hostBatchKey };
  }


  function accepts(rec) {
    if ((rec?.substrateMaterial || rec?.appearance?.surface?.substrateMaterial)
      && materialBatching?.hasRecipe(rec) !== true) return false;
    if (disposed || !rec || rec.kind !== "part") return false;


    if (rec.solid) return false;
    const sp = specialOf(rec);


    if (rec.appearance && !sp && !surfaceOf(rec)) return false;
    if (sp) {


      if (tOf(rec) >= 1) return false;
      const isFile = sp.meshType === "FileMesh" && !!sp.meshId;
      if (isFile) {
        const proto = protos.get(sp.meshId);
        if (!proto) {
          prefetchProto(sp.meshId);
          return false;
        }


        if (proto.status !== "ready") return false;


        if (proto.skinned && !protoUsesPalette(proto) && !gateAllows(rec)) return false;
        if (proto.skinned && protoUsesPalette(proto) && !paletteHasRoom(rec)) return false;
      } else if (!makeSpecialGeo) {
        return false;
      }
      const resolution = resolutionFor(rec);
      if (!resolution.ok || (!pools.has(resolution.key) && pools.size >= maxPools)) return false;
      return true;
    }
    if (isCsgRec(rec)) {
      const parts = Array.isArray(rec.csg.parts) ? rec.csg.parts : null;
      if (!parts || !parts.length || parts.length > maxCsgParts) return false;
      let hasPositive = false;
      for (const p of parts) {
        if (!p.negate) {
          hasPositive = true;
          break;
        }
      }
      if (!hasPositive) return false;                                       
      if (tOf(rec) >= 1) return false;                                                
      const entry = csgGeos.get(hashFor(rec));
      if (entry && entry.failed) return false;                                  
      if (!entry && csgGeos.size >= maxCsgGeos) return false;
      const resolution = resolutionFor(rec);
      if (!resolution.ok || (!pools.has(resolution.key) && pools.size >= maxPools)) return false;
      return true;
    }
    if (rec.isMeshPart) {
      if (!rec.meshId) return false;
      const surf = surfaceOf(rec);
      if (
        surf &&
        !makeTexture &&
        (surf.colorMap || surf.normalMap || surf.metalnessMap || surf.roughnessMap)
      ) {


        return false;
      }
      const tr = Math.min(1, Math.max(0, Number(rec.transparency) || 0));
      const ltm = Math.min(1, Math.max(0, Number(rec.localTransparency) || 0));
      if (tr + (1 - tr) * ltm >= 1) return false;                         
      const proto = protos.get(rec.meshId);
      if (!proto) {
        prefetchProto(rec.meshId);
        return false;
      }
      if (proto.status !== "ready") return false;


      if (proto.skinned && !protoUsesPalette(proto) && !gateAllows(rec)) return false;
      if (proto.skinned && protoUsesPalette(proto) && !paletteHasRoom(rec)) return false;
      const resolution = resolutionFor(rec);
      if (!resolution.ok || (!pools.has(resolution.key) && pools.size >= maxPools)) return false;
      return true;
    }
    return false;
  }


  function gateAllows(rec) {
    if (!meshPoolGate) return true;
    try {
      return !!meshPoolGate(rec);
    } catch (_) {
      return false;
    }
  }


  function prefetchProto(meshId) {
    if (disposed || protos.has(meshId) || protos.size >= maxProtos) return;
    const proto = {
      status: "pending",
      geometry: null,
      submeshes: null,                                                 
      skinned: false,                                                   
      posePool: null,                                                        
      center: null,
      maxDim: 1,
    };
    protos.set(meshId, proto);
    let done = false;
    const finish = (res) => {
      if (done || disposed) return;
      done = true;


      const subs =
        res && Array.isArray(res.submeshes) && res.submeshes.length ? res.submeshes : null;
      if (subs) {
        for (const s of subs) {
          if (
            !s ||
            !s.geometry ||
            !s.geometry.userData ||
            s.geometry.userData.__rswShared !== true ||
            !s.material
          ) {
            proto.status = "none";
            return;
          }
        }
        proto.status = "ready";
        proto.submeshes = subs;
        proto.skinned = !!res.skinned;             
        proto.posePool = res.posePool || null;             
        proto.center = res.center || { x: 0, y: 0, z: 0 };
        proto.maxDim = res.size
          ? Math.max(res.size.x, res.size.y, res.size.z) || 1
          : 1;
        if (onMeshProtoReady) onMeshProtoReady(meshId);
        return;
      }
      const geo = res && res.geometry ? res.geometry : null;


      if (!geo || !geo.userData || geo.userData.__rswShared !== true) {
        proto.status = "none";
        return;
      }
      proto.status = "ready";
      proto.geometry = geo;
      proto.center = res.center || { x: 0, y: 0, z: 0 };
      proto.maxDim = res.size
        ? Math.max(res.size.x, res.size.y, res.size.z) || 1
        : 1;
      if (onMeshProtoReady) onMeshProtoReady(meshId);
    };
    try {
      resolveMeshProto(meshId, finish);
    } catch (_) {
      finish(null);
    }
  }


  function csgEntryFor(rec) {
    const hash = hashFor(rec);
    let entry = csgGeos.get(hash);
    if (entry) return entry.failed ? null : entry;
    if (csgGeos.size >= maxCsgGeos) return null;
    let geo = null;
    try {
      geo = buildCsgGeometry(rec);
    } catch (_) {
      geo = null;
    }
    if (!geo) {
      csgGeos.set(hash, { failed: true });                                  
      return null;
    }
    geo.userData = geo.userData || {};
    geo.userData.__rswShared = true;                                           
    let lods = null;
    try {
      lods = buildCsgLods(THREE, geo);
    } catch (_) {
      lods = null;
    }
    if (lods && lods.length >= 2) {
      for (const lvl of lods) {
        if (lvl && lvl.geo) {
          lvl.geo.userData = lvl.geo.userData || {};
          lvl.geo.userData.__rswShared = true;
        }
      }
    } else {
      lods = null;
    }
    const posAttr = geo.getAttribute ? geo.getAttribute("position") : null;
    const bs = rec.csg.baseSize || rec.size || { x: 1, y: 1, z: 1 };
    entry = {
      failed: false,
      geo,
      lods,


      positions: posAttr && posAttr.array ? Array.from(posAttr.array) : null,
      baseSize: { x: bs.x, y: bs.y, z: bs.z },
    };
    csgGeos.set(hash, entry);
    return entry;
  }


  function makePool(key, type, geo, material, lods) {
    const capacity = INITIAL_CAPACITY;
    const mesh = new THREE.InstancedMesh(geo, material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;                                   
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.userData.__rswPool = true;                                      
    mesh.userData.__rswComplex = true;
    mesh.userData.__rswPoolKey = key;
    scene.add(mesh);
    return {
      key,
      type,                  
      mesh,
      capacity,
      count: 0,
      ids: new Array(capacity).fill(null),
      slots: new Map(),              
      real: new Float32Array(capacity * 16),                                     
      centers: new Float64Array(capacity * 3),
      hiddenFlags: new Uint8Array(capacity),
      lods: lods || null,
      lodLevel: 0,
      localMat: null,                                                    
      protoMaxDim: 1,
      csgEntry: null,
      ownTexture: null,
      surfaceMat: null,                                                        
      maxScale: 1,
      colorBoost: 1,
      baseT: 0,                                             
      translucent: false,
      anchor: null,                                                   
      sortDirty: false,
      extras: null,                                                     
      palette: null,                                                                 
      specialTint: false,                                                             
      specialTintPartColor: false,
      pickSphere: null,                                                                  
      csgNeonOn: null,                                                                    
    };
  }


  function syncExtraCounts(pool) {
    if (!pool.extras) return;
    for (const em of pool.extras) em.count = pool.count;
  }


  function poolTexture(assetId, opts) {
    if (!assetId || !makeTexture) return null;
    try {
      return makeTexture(assetId, opts) || null;
    } catch (_) {
      return null;
    }
  }


  function buildSurfaceMaterial(surface, side, allowPatch = true) {
    const sm = new THREE.MeshStandardMaterial();
    configureSurfaceMaterial(THREE, sm, surface, (id, o) => poolTexture(id, o), { allowPatch });
    sm.side = side;


    sm.__rswPBR = {
      normalMap: sm.normalMap,
      metalnessMap: sm.metalnessMap,
      roughnessMap: sm.roughnessMap,
      aoMap: sm.aoMap,
    };
    sm.__rswFlat = false;
    return sm;
  }


  function buildProtoPool(key, type, proto, textureId, doubleSided, surface = null, rec = null) {
    const side = doubleSided ? THREE.DoubleSide : THREE.FrontSide;


    const surfaceMat = surface ? buildSurfaceMaterial(surface, side, !(proto && proto.skinned)) : null;


    const _rbxMat = rbxMatOf(rec);
    const _isNeon = !surface && (getMaterialDef(_rbxMat) || {}).neon;


    const ownTexture = surfaceMat ? surfaceMat.map : poolTexture(textureId);
    let pool;
    if (proto.submeshes) {


      const mats = proto.submeshes.map((s) => {


        if (surfaceMat) {
          surfaceMat.__rswPoolMap = surfaceMat.map || null;
          return surfaceMat;
        }
        const m = s.material && s.material.clone ? s.material.clone() : s.material;
        if (m) {
          m.__rswPoolMap = ownTexture || m.map || null;
          m.map = m.__rswPoolMap;
          m.side = side;
          m.needsUpdate = true;


          if (m.userData && m.userData.__rswMatName) {
            applyStandardPhysics(m, m.userData.__rswMatName);
          }
        }
        return m;
      });


      let lods = null;
      try {
        lods = getSharedSubmeshLods(THREE, proto.submeshes);
      } catch (_) {
        lods = null;
      }
      const extrasLen = proto.submeshes.length - 1;
      if (
        !(
          lods &&
          lods.length >= 2 &&
          lods[0].geo === proto.submeshes[0].geometry &&
          lods.every((l) => l && l.geo && l.extraGeos && l.extraGeos.length === extrasLen)
        )
      ) {
        lods = null;
      }


      if (lods && protoUsesPalette(proto)) {
        const skinOk = (g) =>
          !!(g && g.getAttribute && g.getAttribute("skinIndex") && g.getAttribute("skinWeight"));
        if (!lods.every((l) => skinOk(l.geo) && l.extraGeos.every(skinOk))) lods = null;
      }
      pool = makePool(key, type, proto.submeshes[0].geometry, mats[0], lods);
      pool.extras = proto.submeshes.slice(1).map((s, i) => {
        const em = new THREE.InstancedMesh(s.geometry, mats[i + 1], pool.capacity);
        em.count = 0;
        em.frustumCulled = false;
        em.instanceMatrix = pool.mesh.instanceMatrix;                       
        em.userData = pool.mesh.userData;                              
        scene.add(em);
        return em;
      });

      if (protoUsesPalette(proto)) {
        initPalettePool(pool, proto, mats);


        for (const pmPal of mats) {
          if (!pmPal || !pmPal.userData) continue;
          if ((getMaterialDef(pmPal.userData.__rswMatName) || {}).neon) {
            patchNeonHdrChained(pmPal, { value: 1 }, "rswCplxNeonHdrP1");
          }
        }
      }
    } else {


      let mat = surfaceMat;
      if (!mat) {
        mat = new THREE.MeshStandardMaterial({
          color: 0xdfe3e8,
          roughness: 0.85,
          metalness: 0.05,
        });
        mat.side = side;
        if (ownTexture) mat.map = ownTexture;


        const rbxMat = rbxMatOf(rec);
        applyStandardPhysics(mat, rbxMat);
        mat.userData.__rswMatName = rbxMat;

        if (!surface && (getMaterialDef(rbxMat) || {}).neon) {
          patchPoolNeonHdr(mat, { value: 1 }, "rswCplxNeonHdr1");
        }
      }
      let lods = null;
      try {
        lods = getSharedMeshLods(THREE, proto.geometry);
      } catch (_) {
        lods = null;
      }
      if (!(lods && lods.length >= 2 && lods[0].geo === proto.geometry)) lods = null;
      pool = makePool(key, type, proto.geometry, mat, lods);
    }
    pool.ownTexture = ownTexture;
    pool.surfaceMat = surfaceMat;                                             
    pool.protoMaxDim = proto.maxDim;


    pool.localMat = new THREE.Matrix4()
      .makeScale(1 / proto.maxDim, 1 / proto.maxDim, 1 / proto.maxDim)
      .multiply(
        new THREE.Matrix4().makeTranslation(
          -proto.center.x,
          -proto.center.y,
          -proto.center.z,
        ),
      );
    return pool;
  }


  function ensureSpecialPool(key, rec) {
    const sp = specialOf(rec);
    if (!sp) return null;
    if (sp.meshType === "FileMesh" && sp.meshId) {
      const proto = protos.get(sp.meshId);


      return proto && proto.status === "ready"
        ? buildProtoPool(key, "special", proto, "", false)
        : null;
    }


    const geo = specialGeoFor(sp.meshType);
    if (!geo) return null;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.05 });

    const _spRbxMat = rbxMatOf(rec);
    applyStandardPhysics(mat, _spRbxMat);
    mat.userData.__rswMatName = _spRbxMat;

    if ((getMaterialDef(_spRbxMat) || {}).neon) {
      patchPoolNeonHdr(mat, { value: 1 }, "rswCplxNeonHdr1");
    }
    let ownTexture = null;
    if (sp.textureId && makeTexture) {
      try {
        ownTexture = makeTexture(sp.textureId) || null;
      } catch (_) {
        ownTexture = null;
      }
    }
    if (ownTexture) mat.map = ownTexture;
    const pool = makePool(key, "special", geo, mat, null);
    pool.ownTexture = ownTexture;
    pool.specialTint = true;
    pool.specialTintPartColor = !ownTexture;                                        
    return pool;
  }

  function ensurePool(rec, resolution = resolutionFor(rec), replacingPool = null) {
    if (!resolution.ok) return null;
    const key = resolution.key;
    let pool = pools.get(key);
    if (pool) return !materialBatching || materialBatching.validatePool(pool, resolution).ok ? pool : null;
    if (pools.size >= maxPools) return null;
    if (isCsgRec(rec)) {
      const entry = csgEntryFor(rec);
      if (!entry) return null;


      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(1, 1, 1),
        vertexColors: true,
        side: THREE.DoubleSide,
      });
      pool = makePool(key, "csg", entry.geo, mat, entry.lods);
      pool.csgEntry = entry;


      if (applyPoolMaterial) {
        try {
          applyPoolMaterial(pool.mesh, rec);
        } catch (_) {

        }
      }


      if (pool.mesh.userData && pool.mesh.userData.__rswNeon) {
        pool.csgNeonOn = { value: 1 };
        const matCSG = Array.isArray(pool.mesh.material) ? pool.mesh.material[0] : pool.mesh.material;


        if (!patchPoolNeonHdr(matCSG, pool.csgNeonOn, "rswCplxNeonHdrB1")) {
          if (!patchNeonHdrChained(matCSG, pool.csgNeonOn, "rswCplxNeonHdrB1c")) pool.csgNeonOn = null;
        }
      }
      syncColorBoost(pool);
      pool.baseT = tOf(rec);
      syncOpacity(pool);
      if (pool.translucent) {


        pool.anchor = { x: rec.position.x, y: rec.position.y, z: rec.position.z };
        pool.mesh.position.set(pool.anchor.x, pool.anchor.y, pool.anchor.z);
      }
    } else if (specialOf(rec)) {
      pool = ensureSpecialPool(key, rec);            
      if (!pool) return null;
    } else {
      const proto = protos.get(rec.meshId);
      if (!proto || proto.status !== "ready") return null;
      pool = buildProtoPool(key, "mesh", proto, rec.textureId || "", !!rec.doubleSided, surfaceOf(rec), rec);
      if (!pool) return null;
      if (pool.surfaceMat && pool.surfaceMat.transparent) {


        pool.translucent = true;
        pool.anchor = { x: rec.position.x, y: rec.position.y, z: rec.position.z };
        pool.mesh.position.set(pool.anchor.x, pool.anchor.y, pool.anchor.z);
        if (pool.extras) {
          for (const em of pool.extras) {
            em.position.set(pool.anchor.x, pool.anchor.y, pool.anchor.z);
          }
        }
      }
    }
    if (flatMode) applyFlat(pool);
    if (materialBatching && !materialBatching.preparePool(pool, resolution, replacingPool).ok) {
      disposePool(pool);
      return null;
    }
    pools.set(key, pool);
    return pool;
  }

  function growPool(pool) {

    const newCap = pool.palette
      ? Math.min(pool.capacity * 2, MAX_PALETTE_INSTANCES)
      : pool.capacity * 2;
    const old = pool.mesh;
    const mesh = new THREE.InstancedMesh(old.geometry, old.material, newCap);
    mesh.count = pool.count;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, pool.count * 16));
    mesh.instanceMatrix.needsUpdate = true;
    if (old.instanceColor) {
      mesh.setColorAt(0, tmpColor.setRGB(1, 1, 1));                  
      mesh.instanceColor.array.set(old.instanceColor.array.subarray(0, pool.count * 3));
      mesh.instanceColor.needsUpdate = true;
    }
    mesh.userData = old.userData;                                               
    mesh.position.copy(old.position);                                 
    mesh.quaternion.copy(old.quaternion);
    mesh.scale.copy(old.scale);
    mesh.visible = old.visible;
    mesh.castShadow = old.castShadow;
    mesh.receiveShadow = old.receiveShadow;
    mesh.layers.mask = old.layers.mask;
    mesh.renderOrder = old.renderOrder;
    mesh.customDepthMaterial = old.customDepthMaterial;
    mesh.customDistanceMaterial = old.customDistanceMaterial;
    mesh.onBeforeRender = old.onBeforeRender;
    mesh.onAfterRender = old.onAfterRender;
    const real = new Float32Array(newCap * 16);
    real.set(pool.real.subarray(0, pool.count * 16));
    const centers = new Float64Array(newCap * 3);
    centers.set(pool.centers.subarray(0, pool.count * 3));
    const hiddenFlags = new Uint8Array(newCap);
    hiddenFlags.set(pool.hiddenFlags.subarray(0, pool.count));
    const ids = new Array(newCap).fill(null);
    for (let i = 0; i < pool.count; i++) ids[i] = pool.ids[i];
    scene.remove(old);
    old.dispose();                                                               
    pool.mesh = mesh;
    pool.capacity = newCap;
    pool.real = real;
    pool.centers = centers;
    pool.hiddenFlags = hiddenFlags;
    pool.ids = ids;
    scene.add(mesh);
    if (pool.extras) {


      pool.extras = pool.extras.map((oldEm) => {
        const em = new THREE.InstancedMesh(oldEm.geometry, oldEm.material, newCap);
        em.count = pool.count;
        em.frustumCulled = false;
        em.instanceMatrix = mesh.instanceMatrix;
        em.instanceColor = mesh.instanceColor;
        em.visible = oldEm.visible;
        em.castShadow = oldEm.castShadow;
        em.receiveShadow = oldEm.receiveShadow;
        em.layers.mask = oldEm.layers.mask;
        em.renderOrder = oldEm.renderOrder;
        em.customDepthMaterial = oldEm.customDepthMaterial;
        em.customDistanceMaterial = oldEm.customDistanceMaterial;
        em.onBeforeRender = oldEm.onBeforeRender;
        em.onAfterRender = oldEm.onAfterRender;
        em.userData = mesh.userData;
        em.position.copy(mesh.position);                                        
        scene.remove(oldEm);
        oldEm.dispose();
        scene.add(em);
        return em;
      });
    }
    if (pool.palette) {


      const pal = pool.palette;
      const buf = new Float32Array(newCap * pal.rowFloats);
      buf.set(pal.buf.subarray(0, pool.count * pal.rowFloats));
      for (let s = pool.count; s < newCap; s++) writeIdentityRow(buf, s * pal.rowFloats, pal.meta.boneCount);
      if (pal.tex && pal.tex.dispose) pal.tex.dispose();
      pal.buf = buf;
      pal.tex = makePaletteTexture(buf, pal.meta.texWidth, newCap);
      pal.uniforms.tex.value = pal.tex;
      pal.uniforms.dim.value = { x: pal.meta.texWidth, y: newCap };
      const instances = new Array(newCap).fill(null);
      for (let i = 0; i < pool.count; i++) instances[i] = pal.instances[i];
      pal.instances = instances;
      for (const m of [pool.mesh, ...(pool.extras || [])]) {
        if (pal.depthMat) m.customDepthMaterial = pal.depthMat;
        if (pal.distMat) m.customDistanceMaterial = pal.distMat;
      }
    }
  }

  function disposePool(pool) {
    materialBatching?.releasePool(pool);
    pools.delete(pool.key);
    scene.remove(pool.mesh);
    const tex = pool.mesh.userData ? pool.mesh.userData.__rswMatTex : null;
    if (tex && tex.dispose) tex.dispose();
    if (pool.mesh.userData) pool.mesh.userData.__rswMatTex = null;
    if (pool.ownTexture && pool.ownTexture.dispose) pool.ownTexture.dispose();
    if (pool.surfaceMat) {


      const src = pool.surfaceMat.__rswPBR || pool.surfaceMat;
      const saExtra = (pool.surfaceMat.userData && pool.surfaceMat.userData.__rswSaTex) || [];
      const seenTex = new Set();
      for (const t of [src.normalMap, src.metalnessMap, src.roughnessMap, src.aoMap, ...saExtra]) {
        if (t && !seenTex.has(t)) {
          seenTex.add(t);
          if (t.dispose) t.dispose();
        }
      }
      pool.surfaceMat = null;
    }
    if (pool.mesh.material && pool.mesh.material.dispose) pool.mesh.material.dispose();
    pool.mesh.dispose();
    if (pool.extras) {


      for (const em of pool.extras) {
        scene.remove(em);
        if (em.material && em.material.dispose) em.material.dispose();
        em.dispose();
      }
      pool.extras = null;
    }
    if (pool.palette) {

      const pal = pool.palette;
      if (pal.tex && pal.tex.dispose) pal.tex.dispose();
      if (pal.depthMat && pal.depthMat.dispose) pal.depthMat.dispose();
      if (pal.distMat && pal.distMat.dispose) pal.distMat.dispose();
      palettePools.delete(pool);
      pool.palette = null;
    }


  }


  function clampRatio(v, base) {
    const r = v / Math.max(base, 0.05);
    return Number.isFinite(r) && r > 0 ? r : 1;
  }

  function composeMatrix(pool, rec, out) {
    const rot = rec.rotation || { x: 0, y: 0, z: 0 };
    tmpEuler.set((rot.x || 0) * DEG, (rot.y || 0) * DEG, (rot.z || 0) * DEG, "XYZ");
    tmpQuat.setFromEuler(tmpEuler);
    tmpPos.set(rec.position.x, rec.position.y, rec.position.z);
    if (pool.type === "csg") {


      const bs = (rec.csg && rec.csg.baseSize) || rec.size;
      const rx = clampRatio(Math.max(Math.abs(rec.size.x), 0.05), bs.x);
      const ry = clampRatio(Math.max(Math.abs(rec.size.y), 0.05), bs.y);
      const rz = clampRatio(Math.max(Math.abs(rec.size.z), 0.05), bs.z);
      tmpScale.set(rx, ry, rz);
      out.compose(tmpPos, tmpQuat, tmpScale);
      if (pool.anchor) {
        out.elements[12] -= pool.anchor.x;
        out.elements[13] -= pool.anchor.y;
        out.elements[14] -= pool.anchor.z;
      }
      return Math.max(rx, ry, rz);
    }
    const sx = Math.max(rec.size.x, 0.05);
    const sy = Math.max(rec.size.y, 0.05);
    const sz = Math.max(rec.size.z, 0.05);
    tmpScale.set(sx, sy, sz);
    out.compose(tmpPos, tmpQuat, tmpScale);
    let localMax = 1;
    if (pool.type === "special") {


      const sp = specialOf(rec);
      const off = (sp && sp.offset) || { x: 0, y: 0, z: 0 };
      const sc = (sp && sp.scale) || { x: 1, y: 1, z: 1 };
      const kx = clampSpecialScale(sc.x);
      const ky = clampSpecialScale(sc.y);
      const kz = clampSpecialScale(sc.z);
      out.multiply(tmpMat2.makeTranslation(off.x / sx, off.y / sy, off.z / sz));
      out.multiply(tmpMat2.makeScale(kx, ky, kz));
      localMax = Math.max(Math.abs(kx), Math.abs(ky), Math.abs(kz));
    }
    if (pool.localMat) out.multiply(pool.localMat);
    if (pool.anchor) {


      out.elements[12] -= pool.anchor.x;
      out.elements[13] -= pool.anchor.y;
      out.elements[14] -= pool.anchor.z;
    }
    return (Math.max(sx, sy, sz) * localMax) / (pool.protoMaxDim || 1);
  }


  function markBoundsDirty(pool) {
    pool.mesh.boundingSphere = null;
    if (pool.extras) {
      for (const em of pool.extras) em.boundingSphere = null;
    }
  }

  function writeLiveMatrix(pool, slot) {
    const src = pool.hiddenFlags[slot]
      ? ZERO16
      : pool.real.subarray(slot * 16, slot * 16 + 16);
    if (writeInstanceAttribute(pool.mesh.instanceMatrix, slot, src)) markBoundsDirty(pool);
  }

  function writeInstance(pool, slot, rec) {
    lodDirty = true;                                                                           
    const worldScale = composeMatrix(pool, rec, tmpMat);
    if (worldScale > pool.maxScale) pool.maxScale = worldScale;
    for (let i = 0; i < 16; i++) pool.real[slot * 16 + i] = tmpMat.elements[i];
    pool.centers[slot * 3] = rec.position.x;
    pool.centers[slot * 3 + 1] = rec.position.y;
    pool.centers[slot * 3 + 2] = rec.position.z;
    pool.hiddenFlags[slot] = hiddenIds && hiddenIds.has(rec.id) ? 1 : 0;
    writeLiveMatrix(pool, slot);
    if (pool.type === "csg") {
      const boost = pool.colorBoost;
      tmpColor.setRGB(rec.color.r * boost, rec.color.g * boost, rec.color.b * boost);
      writeInstanceColor(pool.mesh, slot, tmpColor);
    } else if (pool.specialTint) {


      const sp = specialOf(rec);
      const vc = (sp && sp.vertexColor) || { x: 1, y: 1, z: 1 };
      const cx = Math.max(0, Math.min(2, vc.x));
      const cy = Math.max(0, Math.min(2, vc.y));
      const cz = Math.max(0, Math.min(2, vc.z));
      if (pool.specialTintPartColor) {
        tmpColor.setRGB(cx * rec.color.r, cy * rec.color.g, cz * rec.color.b);
      } else {
        tmpColor.setRGB(cx, cy, cz);
      }
      writeInstanceColor(pool.mesh, slot, tmpColor);
    }
    if (pool.extras && pool.mesh.instanceColor) {
      for (const mesh of pool.extras) mesh.instanceColor = pool.mesh.instanceColor;
    }
  }


  function syncColorBoost(pool) {
    const want =
      pool.mesh.userData && pool.mesh.userData.__rswNeon ? NEON_BOOST : 1;


    if (pool.csgNeonOn) pool.csgNeonOn.value = want === NEON_BOOST ? 1 : 0;
    if (want === pool.colorBoost) return;
    const ratio = want / pool.colorBoost;
    pool.colorBoost = want;
    const colors = pool.mesh.instanceColor;
    if (colors && colors.array) {
      for (let i = 0; i < pool.count * 3; i++) colors.array[i] *= ratio;
      markInstanceAttributeRange(colors, 0, pool.count);
    }
  }


  function syncOpacity(pool) {
    if (pool.type !== "csg") return;
    const mat = pool.mesh.material;
    if (!mat) return;
    const ud = pool.mesh.userData;
    const matOp = ud && Number.isFinite(ud.__rswMatOpacity) ? ud.__rswMatOpacity : 1;
    const eff = Math.min(1, Math.max(0, (1 - pool.baseT) * matOp));
    const translucent = eff < 1;
    if (mat.transparent !== translucent || mat.opacity !== eff) {
      mat.transparent = translucent;
      mat.opacity = eff;
      mat.needsUpdate = true;
    }
    if (translucent !== pool.translucent) {
      pool.translucent = translucent;
      pool.sortDirty = true;
    }
  }

  function publishCollider(rec, pool) {
    const entry = pool.csgEntry;
    if (!entry || !entry.positions || !rec.instance) return;


    rec.instance._csgMesh = {
      positions: entry.positions,
      baseSize: { x: entry.baseSize.x, y: entry.baseSize.y, z: entry.baseSize.z },
    };
  }


  function add(rec) {
    if (!accepts(rec)) return false;
    if (byId.has(rec.id)) return update(rec);
    const pool = ensurePool(rec);
    if (!pool) return false;
    return appendInstance(pool, rec);
  }

  function appendInstance(pool, rec) {
    if (pool.count >= pool.capacity) growPool(pool);
    const slot = pool.count;
    try {
      writeInstance(pool, slot, rec);
    } catch {
      if (pool.count === 0) disposePool(pool);
      return false;
    }
    return commitInstance(pool, rec);
  }

  function commitInstance(pool, rec) {
    const slot = pool.count;
    pool.count += 1;
    pool.mesh.count = pool.count;
    syncExtraCounts(pool);
    pool.ids[slot] = rec.id;
    pool.slots.set(rec.id, slot);
    byId.set(rec.id, pool.key);


    if (pool.palette) paletteWriteSlot(pool, slot, rec);
    if (pool.translucent) pool.sortDirty = true;
    if (pool.type === "csg") publishCollider(rec, pool);
    ping();
    return true;
  }

  function update(rec, keys) {
    if (!rec || !byId.has(rec.id)) return false;
    const curKey = byId.get(rec.id);
    const pool = pools.get(curKey);
    if (!pool) {
      byId.delete(rec.id);
      return false;
    }
    if (!accepts(rec)) return false;                                      
    const resolution = resolutionFor(rec);
    if (!resolution.ok) return false;
    if (resolution.key !== curKey) {
      const destination = ensurePool(rec, resolution, pool);
      if (!destination) return false;
      if (destination.count >= destination.capacity) growPool(destination);
      try {
        writeInstance(destination, destination.count, rec);
      } catch {
        if (destination.count === 0) disposePool(destination);
        return false;
      }
      remove(rec.id);
      return commitInstance(destination, rec);
    }
    if (materialBatching && !materialBatching.validatePool(pool, resolution).ok) return false;
    const slot = pool.slots.get(rec.id);
    if (slot == null) return false;
    if (
      pool.type === "csg" &&
      applyPoolMaterial &&
      keys &&
      (keys.indexOf("Material") !== -1 || keys.indexOf("MaterialVariant") !== -1)
    ) {


      try {
        applyPoolMaterial(pool.mesh, rec);
      } catch (_) {

      }
      if (flatMode) applyFlat(pool);
      syncColorBoost(pool);
      syncOpacity(pool);
    }
    writeInstance(pool, slot, rec);
    if (pool.palette && rec && rec.instance) pool.palette.instances[slot] = rec.instance;             
    if (pool.translucent) pool.sortDirty = true;
    ping();
    return true;
  }

  function remove(id) {
    const key = byId.get(id);
    if (key == null) return false;
    const pool = pools.get(key);
    byId.delete(id);
    if (!pool) return false;
    const slot = pool.slots.get(id);
    if (slot == null) return false;
    pool.slots.delete(id);
    const last = pool.count - 1;
    if (slot !== last) {

      const lastId = pool.ids[last];
      pool.ids[slot] = lastId;
      pool.slots.set(lastId, slot);
      pool.real.copyWithin(slot * 16, last * 16, last * 16 + 16);
      pool.centers.copyWithin(slot * 3, last * 3, last * 3 + 3);
      pool.hiddenFlags[slot] = pool.hiddenFlags[last];
      pool.mesh.instanceMatrix.array.copyWithin(slot * 16, last * 16, last * 16 + 16);
      if (pool.mesh.instanceColor) {
        pool.mesh.instanceColor.array.copyWithin(slot * 3, last * 3, last * 3 + 3);
        markInstanceAttributeRange(pool.mesh.instanceColor, slot);
      }
      markInstanceAttributeRange(pool.mesh.instanceMatrix, slot);
      if (pool.palette) {

        const rf = pool.palette.rowFloats;
        pool.palette.buf.copyWithin(slot * rf, last * rf, last * rf + rf);
        pool.palette.instances[slot] = pool.palette.instances[last];
        pool.palette.tex.needsUpdate = true;
      }
    }
    pool.ids[last] = null;
    if (pool.palette) {
      pool.palette.instances[last] = null;
      pool.palette.dirty.delete(id);
    }
    pool.count = last;
    pool.mesh.count = last;
    syncExtraCounts(pool);
    markBoundsDirty(pool);
    if (pool.translucent) pool.sortDirty = true;
    lodDirty = true;                                                          
    if (!pool.count) disposePool(pool);                                
    ping();
    return true;
  }

  function has(id) {
    return byId.has(id);
  }

  function idFromHit(mesh, instanceId) {
    if (!mesh || !mesh.userData || !mesh.userData.__rswComplex) return null;
    const pool = pools.get(mesh.userData.__rswPoolKey);
    if (!pool || (pool.mesh !== mesh && !(pool.extras && pool.extras.indexOf(mesh) !== -1))) {
      return null;
    }
    if (!Number.isInteger(instanceId) || instanceId < 0 || instanceId >= pool.count) {
      return null;
    }
    return pool.ids[instanceId];
  }

  function getRaycastMeshes() {
    const out = [];
    for (const pool of pools.values()) {
      if (!pool.count) continue;
      out.push(pool.mesh);
      if (pool.extras) for (const em of pool.extras) out.push(em);
    }
    return out;
  }

  function forEachCenter(fn) {
    for (const pool of pools.values()) {
      for (let i = 0; i < pool.count; i++) {
        if (pool.hiddenFlags[i]) continue;                            
        fn(pool.ids[i], pool.centers[i * 3], pool.centers[i * 3 + 1], pool.centers[i * 3 + 2]);
      }
    }
  }

  function applyHidden(hidden) {
    const next = hidden && hidden.size ? hidden : null;
    let changed = false;
    for (const pool of pools.values()) {
      for (let slot = 0; slot < pool.count; slot++) {
        const want = next && next.has(pool.ids[slot]) ? 1 : 0;
        if (pool.hiddenFlags[slot] === want) continue;
        pool.hiddenFlags[slot] = want;
        writeLiveMatrix(pool, slot);
        changed = true;
      }
    }
    hiddenIds = next ? new Set(next) : null;
    if (changed) ping();
    return changed;
  }

  function applyFlat(pool) {


    const sfm = pool.surfaceMat;
    if (sfm && sfm.__rswPBR && sfm.__rswFlat !== flatMode) {
      sfm.__rswFlat = flatMode;
      sfm.normalMap = flatMode ? null : sfm.__rswPBR.normalMap;
      sfm.metalnessMap = flatMode ? null : sfm.__rswPBR.metalnessMap;
      sfm.roughnessMap = flatMode ? null : sfm.__rswPBR.roughnessMap;

      sfm.aoMap = flatMode ? null : sfm.__rswPBR.aoMap || null;
      sfm.metalness = !flatMode && sfm.__rswPBR.metalnessMap ? 1 : 0.1;
      sfm.roughness = !flatMode && sfm.__rswPBR.roughnessMap ? 1 : 0.8;
      sfm.needsUpdate = true;
    }
    if (pool.extras) {

      for (const em of [pool.mesh, ...pool.extras]) {
        const m = em.material;
        if (!m) continue;
        const want = flatMode ? null : m.__rswPoolMap || null;
        if (m.map !== want) {
          m.map = want;
          m.needsUpdate = true;
        }
      }
      return;
    }
    const mat = pool.mesh.material;
    if (!mat) return;
    const tex =
      (pool.mesh.userData && pool.mesh.userData.__rswMatTex) || pool.ownTexture || null;
    const wantMap = flatMode ? null : tex;
    if (mat.map !== wantMap) {
      mat.map = wantMap;
      mat.needsUpdate = true;
    }
  }

  function setFlatMode(on) {
    const want = !!on;
    if (disposed || want === flatMode) return false;
    if (materialBatching && !materialBatching.permitsHostMaterialChange()) return false;
    flatMode = want;
    for (const pool of pools.values()) applyFlat(pool);
    ping();
    return true;
  }


  let lastLodPos = null;
  let lodDirty = true;


  const lodGuardQa = { scans: 0, skips: 0, switches: 0 };
  lodGuardQa.parity = (camPos) => {
    const cp = camPos || (typeof globalThis !== "undefined" && globalThis.__rswCamPos ? globalThis.__rswCamPos() : null);
    if (!cp) return { ok: false, checked: 0, mismatches: 0, reason: "sem camPos (passe {x,y,z} ou abra o viewport)" };
    let checked = 0;
    let mismatches = 0;
    for (const pool of pools.values()) {
      if (!pool.lods || !pool.count) continue;
      let best = Infinity;
      const c = pool.centers;
      for (let i = 0; i < pool.count; i++) {
        const dx = c[i * 3] - cp.x;
        const dy = c[i * 3 + 1] - cp.y;
        const dz = c[i * 3 + 2] - cp.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < best) best = d2;
      }
      const d = Math.sqrt(best);
      const s = pool.maxScale || 1;
      const cur = pool.lodLevel || 0;
      let level = 0;
      for (let i = pool.lods.length - 1; i >= 1; i--) {
        const limit = pool.lods[i].minDist * s * (cur >= i ? LOD_HYSTERESIS : 1);
        if (d >= limit) {
          level = i;
          break;
        }
      }
      checked += 1;
      if (level !== cur) mismatches += 1;
    }
    return { ok: mismatches === 0, checked, mismatches };
  };
  if (typeof globalThis !== "undefined") globalThis.__rswLodGuardQa = lodGuardQa;

  function updateLods(camPos) {
    if (disposed || !camPos) return false;
    const lodMoved =
      !lastLodPos ||
      (camPos.x - lastLodPos.x) * (camPos.x - lastLodPos.x) +
        (camPos.y - lastLodPos.y) * (camPos.y - lastLodPos.y) +
        (camPos.z - lastLodPos.z) * (camPos.z - lastLodPos.z) >
        1e-4;
    if (!lodMoved && !lodDirty) return false;


    const contentDirty = lodDirty;
    lodDirty = false;
    if (!lastLodPos) {
      lastLodPos = { x: camPos.x, y: camPos.y, z: camPos.z };
    } else if (lodMoved) {
      lastLodPos.x = camPos.x;
      lastLodPos.y = camPos.y;
      lastLodPos.z = camPos.z;
    }
    let changed = false;
    for (const pool of pools.values()) {
      if (!pool.lods || !pool.count) continue;
      const guard = pool.lodGuard;
      if (!contentDirty && guard) {
        const gx = camPos.x - guard.x;
        const gy = camPos.y - guard.y;
        const gz = camPos.z - guard.z;
        if (gx * gx + gy * gy + gz * gz < guard.margin2) {
          lodGuardQa.skips += 1;
          continue;
        }
      }
      lodGuardQa.scans += 1;
      let best = Infinity;
      const c = pool.centers;
      for (let i = 0; i < pool.count; i++) {
        const dx = c[i * 3] - camPos.x;
        const dy = c[i * 3 + 1] - camPos.y;
        const dz = c[i * 3 + 2] - camPos.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < best) best = d2;
      }
      const d = Math.sqrt(best);
      const s = pool.maxScale || 1;
      const cur = pool.lodLevel || 0;
      let level = 0;
      for (let i = pool.lods.length - 1; i >= 1; i--) {
        const limit = pool.lods[i].minDist * s * (cur >= i ? LOD_HYSTERESIS : 1);
        if (d >= limit) {
          level = i;
          break;
        }
      }


      let guardMargin = Infinity;
      for (let i = pool.lods.length - 1; i >= 1; i--) {
        const nextLimit = pool.lods[i].minDist * s * (level >= i ? LOD_HYSTERESIS : 1);
        const gap = d >= nextLimit ? d - nextLimit : nextLimit - d;
        if (gap < guardMargin) guardMargin = gap;
      }
      if (!pool.lodGuard) pool.lodGuard = { x: 0, y: 0, z: 0, margin2: 0 };
      pool.lodGuard.x = camPos.x;
      pool.lodGuard.y = camPos.y;
      pool.lodGuard.z = camPos.z;
      pool.lodGuard.margin2 = guardMargin * guardMargin;
      if (level !== cur) {
        lodGuardQa.switches += 1;
        pool.lodLevel = level;
        const lvl = pool.lods[level];
        pool.mesh.geometry = lvl.geo;
        if (pool.extras && lvl.extraGeos) {
          const n = Math.min(pool.extras.length, lvl.extraGeos.length);
          for (let j = 0; j < n; j++) pool.extras[j].geometry = lvl.extraGeos[j];
        }
        markBoundsDirty(pool);                                                     
        changed = true;
      }
    }
    return changed;
  }


  let lastSortPos = null;


  let sortDistBuf = null;
  let sortOrderBuf = null;


  let sortRealSnap = null;
  let sortLiveSnap = null;
  let sortCenterSnap = null;
  let sortColorSnap = null;
  const sortIdsSnap = [];
  const sortHiddenSnap = [];


  let sortPaletteSnap = null;
  const sortPalInstSnap = [];

  function sortPool(pool, camPos) {
    const n = pool.count;
    if (!sortDistBuf || sortDistBuf.length < n) {
      sortDistBuf = new Float64Array(Math.max(64, n * 2));
      sortOrderBuf = new Int32Array(Math.max(64, n * 2));
    }
    const dist = sortDistBuf.subarray(0, n);
    const order = sortOrderBuf.subarray(0, n);
    for (let i = 0; i < n; i++) {
      const dx = pool.centers[i * 3] - camPos.x;
      const dy = pool.centers[i * 3 + 1] - camPos.y;
      const dz = pool.centers[i * 3 + 2] - camPos.z;
      dist[i] = dx * dx + dy * dy + dz * dz;
      order[i] = i;
    }
    order.sort((a, b) => dist[b] - dist[a]);                                  
    let identity = true;
    for (let i = 0; i < n; i++) {
      if (order[i] !== i) {
        identity = false;
        break;
      }
    }
    if (identity) return false;


    if (!sortRealSnap || sortRealSnap.length < n * 16) {
      const m = Math.max(64, n * 2);
      sortRealSnap = new Float32Array(m * 16);
      sortLiveSnap = new Float32Array(m * 16);
      sortCenterSnap = new Float32Array(m * 3);
      sortColorSnap = new Float32Array(m * 3);
    }
    const liveArr = pool.mesh.instanceMatrix.array;
    const colorArr = pool.mesh.instanceColor ? pool.mesh.instanceColor.array : null;
    sortRealSnap.set(pool.real.subarray(0, n * 16));
    sortLiveSnap.set(liveArr.subarray(0, n * 16));
    sortCenterSnap.set(pool.centers.subarray(0, n * 3));
    if (colorArr) sortColorSnap.set(colorArr.subarray(0, n * 3));
    for (let i = 0; i < n; i++) {
      sortIdsSnap[i] = pool.ids[i];
      sortHiddenSnap[i] = pool.hiddenFlags[i];
    }
    for (let slot = 0; slot < n; slot++) {
      const from = order[slot];
      const rb = from * 16;
      const wb = slot * 16;
      for (let k = 0; k < 16; k++) {
        pool.real[wb + k] = sortRealSnap[rb + k];
        liveArr[wb + k] = sortLiveSnap[rb + k];
      }
      const cb = from * 3;
      const cw = slot * 3;
      pool.centers[cw] = sortCenterSnap[cb];
      pool.centers[cw + 1] = sortCenterSnap[cb + 1];
      pool.centers[cw + 2] = sortCenterSnap[cb + 2];
      pool.hiddenFlags[slot] = sortHiddenSnap[from];
      pool.ids[slot] = sortIdsSnap[from];
      pool.slots.set(sortIdsSnap[from], slot);
      if (colorArr) {
        colorArr[cw] = sortColorSnap[cb];
        colorArr[cw + 1] = sortColorSnap[cb + 1];
        colorArr[cw + 2] = sortColorSnap[cb + 2];
      }
    }
    if (pool.palette) {


      const pal = pool.palette;
      const rf = pal.rowFloats;
      if (!sortPaletteSnap || sortPaletteSnap.length < n * rf) {
        sortPaletteSnap = new Float32Array(Math.max(64, n * 2) * rf);
      }
      sortPaletteSnap.set(pal.buf.subarray(0, n * rf));
      for (let i = 0; i < n; i++) sortPalInstSnap[i] = pal.instances[i];
      for (let slot = 0; slot < n; slot++) {
        const from = order[slot];
        if (from === slot) continue;
        pal.buf.set(sortPaletteSnap.subarray(from * rf, from * rf + rf), slot * rf);
        pal.instances[slot] = sortPalInstSnap[from];
      }
      pal.tex.needsUpdate = true;
    }
    markInstanceAttributeRange(pool.mesh.instanceMatrix, 0, n);
    if (pool.mesh.instanceColor) markInstanceAttributeRange(pool.mesh.instanceColor, 0, n);
    return true;
  }

  function sortTranslucent(camPos) {
    if (disposed || !camPos) return false;
    const moved =
      !lastSortPos ||
      (camPos.x - lastSortPos.x) * (camPos.x - lastSortPos.x) +
        (camPos.y - lastSortPos.y) * (camPos.y - lastSortPos.y) +
        (camPos.z - lastSortPos.z) * (camPos.z - lastSortPos.z) >
        0.25;
    let changed = false;
    for (const pool of pools.values()) {
      if (!pool.translucent || pool.count < 2) continue;
      if (!moved && !pool.sortDirty) continue;
      pool.sortDirty = false;
      if (sortPool(pool, camPos)) changed = true;
    }
    if (moved) lastSortPos = { x: camPos.x, y: camPos.y, z: camPos.z };
    if (changed) ping();
    return changed;
  }


  function csgGeometryFor(rec) {
    if (disposed || !isCsgRec(rec)) return null;
    const entry = csgGeos.get(hashFor(rec));
    return entry && !entry.failed && entry.geo ? entry : null;
  }

  function size() {
    return byId.size;
  }

  function poolCount() {
    return pools.size;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const pool of Array.from(pools.values())) disposePool(pool);
    pools.clear();
    byId.clear();
    palettePools.clear();                                                        
    for (const entry of csgGeos.values()) {
      if (entry.failed) continue;
      if (entry.lods) {
        for (const lvl of entry.lods) {
          if (lvl && lvl.geo && lvl.geo !== entry.geo && lvl.geo.dispose) {
            lvl.geo.dispose();
          }
        }
      }
      if (entry.geo && entry.geo.dispose) entry.geo.dispose();
    }
    csgGeos.clear();
    protos.clear();                                                          
    for (const geo of specialGeos.values()) {
      if (geo && geo.dispose) geo.dispose();                                 
    }
    specialGeos.clear();
  }


  const pickMesh = new THREE.Mesh();
  pickMesh.material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const pickRaycaster = new THREE.Raycaster();
  const pickHits = [];
  const pickBoxTmp = new THREE.Box3();
  const pickCenterTmp = new THREE.Vector3();
  const pickVec = new THREE.Vector3();


  function pickGeosOf(pool) {
    const lvl0 = pool.lods && pool.lods[0] ? pool.lods[0] : null;
    const geos = [lvl0 && lvl0.geo ? lvl0.geo : pool.mesh.geometry];
    if (pool.extras) {
      for (let j = 0; j < pool.extras.length; j++) {
        const eg =
          lvl0 && lvl0.extraGeos && lvl0.extraGeos[j]
            ? lvl0.extraGeos[j]
            : pool.extras[j].geometry;
        if (eg) geos.push(eg);
      }
    }
    return geos;
  }


  function pickSphereOf(pool) {
    if (pool.pickSphere) return pool.pickSphere;
    pickBoxTmp.makeEmpty();
    for (const g of pickGeosOf(pool)) {
      if (!g) continue;
      if (g.boundingBox === null) g.computeBoundingBox();
      if (g.boundingBox && !g.boundingBox.isEmpty()) pickBoxTmp.union(g.boundingBox);
    }
    if (pickBoxTmp.isEmpty()) {
      pool.pickSphere = { x: 0, y: 0, z: 0, r: 0 };                               
      return pool.pickSphere;
    }
    pickBoxTmp.getCenter(pickCenterTmp);
    const r = pickBoxTmp.max.distanceTo(pickBoxTmp.min) * 0.5;
    pool.pickSphere = { x: pickCenterTmp.x, y: pickCenterTmp.y, z: pickCenterTmp.z, r };
    return pool.pickSphere;
  }

  function pickByRay(ray) {
    if (!ray) return null;
    pickRaycaster.ray.copy(ray);
    pickRaycaster.near = 0;
    pickRaycaster.far = Infinity;
    let bestId = null;
    let bestDist = Infinity;
    for (const pool of pools.values()) {
      if (!pool.count) continue;
      const sph = pickSphereOf(pool);
      if (!(sph.r > 0)) continue;
      const geos = pickGeosOf(pool);
      console.assert(geos.length > 0, "pickByRay: pool sem geometria de picking");
      const ax = pool.anchor ? pool.anchor.x : 0;                                                             
      const ay = pool.anchor ? pool.anchor.y : 0;
      const az = pool.anchor ? pool.anchor.z : 0;
      const m = pool.real;
      for (let i = 0; i < pool.count; i++) {
        if (pool.hiddenFlags[i]) continue;
        const o = i * 16;
        const sx = Math.hypot(m[o], m[o + 1], m[o + 2]);
        const sy = Math.hypot(m[o + 4], m[o + 5], m[o + 6]);
        const sz = Math.hypot(m[o + 8], m[o + 9], m[o + 10]);
        const maxS = Math.max(sx, sy, sz, 1e-6);
        pickVec.set(
          m[o] * sph.x + m[o + 4] * sph.y + m[o + 8] * sph.z + m[o + 12] + ax,
          m[o + 1] * sph.x + m[o + 5] * sph.y + m[o + 9] * sph.z + m[o + 13] + ay,
          m[o + 2] * sph.x + m[o + 6] * sph.y + m[o + 10] * sph.z + m[o + 14] + az,
        );
        const radius = sph.r * maxS;
        if (ray.distanceSqToPoint(pickVec) > radius * radius) continue;

        pickMesh.matrixWorld.fromArray(m, o);
        pickMesh.matrixWorld.elements[12] += ax;
        pickMesh.matrixWorld.elements[13] += ay;
        pickMesh.matrixWorld.elements[14] += az;
        for (const g of geos) {
          pickMesh.geometry = g;
          pickHits.length = 0;
          pickMesh.raycast(pickRaycaster, pickHits);
          for (const h of pickHits) {
            if (h.distance < bestDist) {
              bestDist = h.distance;
              bestId = pool.ids[i];
            }
          }
        }
      }
    }
    return bestId == null ? null : { id: bestId, distance: bestDist };
  }


  function markPoseDirty(id) {
    const key = byId.get(id);
    if (key == null) return false;
    const pool = pools.get(key);
    if (!pool || !pool.palette || !pool.slots.has(id)) return false;
    pool.palette.dirty.add(id);
    ping();
    return true;
  }

  function hasPalette(id) {
    const key = byId.get(id);
    if (key == null) return false;
    const pool = pools.get(key);
    return !!(pool && pool.palette && pool.slots.has(id));
  }


  function updatePosePalettes() {
    if (disposed || !palettePools.size) return false;
    let changed = false;
    for (const pool of palettePools) {
      const pal = pool.palette;
      if (!pal || !pal.dirty.size) continue;
      for (const id of pal.dirty) {
        const slot = pool.slots.get(id);
        if (slot == null) continue;
        paletteWriteSlot(pool, slot);
        changed = true;
      }
      pal.dirty.clear();
    }
    return changed;
  }

  function preparePromotion(id, meshes) {
    const pool = pools.get(byId.get(id));
    return pool && materialBatching
      ? materialBatching.preparePromotion(pool, meshes)
      : { ok: false, reason: "SSM_POOL_NOT_BOUND" };
  }

  return {
    accepts,
    preparePromotion,
    add,
    update,
    remove,
    has,
    idFromHit,
    pickByRay,
    getRaycastMeshes,
    forEachCenter,
    applyHidden,
    setFlatMode,
    updateLods,
    sortTranslucent,
    updatePosePalettes,             
    markPoseDirty,             
    hasPalette,             
    csgGeometryFor,
    size,
    poolCount,
    dispose,
  };
}
