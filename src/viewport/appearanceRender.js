import { assetStore } from "../assets/assetStore.js";
import { synchronizeSubstrateAuthoring, setSubstrateMaterialSource } from "./substrateAuthoringBridge.js";
import { materialCanvas, getMaterialDef, patchNeonHdrChained } from "./baseMaterials.js";
import {
  findVariant,
  getOverrideVariant,
  variantData,
  isUse2022,
} from "../editor/materialPaint.js";
import { resolveMeshData, loadMeshInto } from "./meshLoader.js";

import {
  planSurfaceMaps,
  saProgramKey,
  SA_GLSL_UNIFORMS,
  SA_GLSL_PRELUDE,
  SA_GLSL_MAP_CHUNK,
  SA_GLSL_NORMAL_CHUNK,
  SA_GLSL_ROUGHNESS_CHUNK,
  SA_GLSL_METALNESS_CHUNK,
} from "../lighting/surfaceAppearanceCore.js";

import { applyStandardPhysics, applyPhongPhysics } from "../lighting/materialPhysicsTable.js";


const imageCache = new Map();                                           

function getImageFor(assetId) {
  if (!assetId || typeof assetId !== "string") return null;
  let entry = imageCache.get(assetId);
  if (entry) return entry;
  let rec = null;
  try {
    rec = assetStore.getById(assetId);
  } catch (_) {
    rec = null;
  }
  if (!rec || !rec.dataUri || !rec.local) return null;
  if (typeof Image === "undefined") return null;
  const img = new Image();
  entry = { img, loaded: false, waiters: [] };
  img.onload = () => {
    entry.loaded = true;
    for (const fn of entry.waiters.splice(0)) {
      try {
        fn();
      } catch (_) {

      }
    }
  };
  img.src = rec.dataUri;
  imageCache.set(assetId, entry);
  return entry;
}


export function makeAssetTexture(THREE, assetId, onReady, opts = {}) {
  const entry = getImageFor(assetId);
  if (!entry) return null;
  const tex = new THREE.Texture(entry.img);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  if (opts.srgb !== false && THREE.SRGBColorSpace && "colorSpace" in tex) {
    tex.colorSpace = THREE.SRGBColorSpace;
  }
  const finish = () => {
    tex.needsUpdate = true;
    if (typeof onReady === "function") onReady();
  };
  if (entry.loaded) finish();
  else entry.waiters.push(finish);
  return tex;
}


function collectBaseMaterials(obj) {
  const out = [];
  if (obj.material) out.push(obj.material);
  if (obj.userData && obj.userData.__origMat && out.indexOf(obj.userData.__origMat) === -1) {
    out.push(obj.userData.__origMat);
  }
  return out;
}

function resolveVariantFor(rec) {
  if (rec.materialVariant) {
    const v = variantData(findVariant(rec.materialVariant));
    if (v) return v;
  }
  const ov = getOverrideVariant(rec.material);
  return ov ? variantData(ov) : null;
}


function applyIndividualMeshIdentity(obj, rec) {
  if (!obj || !rec) return;
  const recMat = rec.material || "Plastic";
  obj.traverse((n) => {
    if (!n || !n.isMesh || !n.material) return;
    const matList = Array.isArray(n.material) ? n.material : [n.material];
    for (const m of matList) {
      if (!m) continue;
      if (!m.userData) m.userData = {};
      const hasPbrMaps = !!(m.normalMap || m.roughnessMap || m.metalnessMap || m.aoMap);
      if ((m.userData.__rswMatName === undefined || m.userData.__rswMatName === null) && !hasPbrMaps) {
        m.userData.__rswMatName = recMat;
      }
      const nmId = m.userData.__rswMatName;
      if (!nmId) continue;
      if (m.isMeshStandardMaterial) applyStandardPhysics(m, nmId);
      else if (m.isMeshPhongMaterial) applyPhongPhysics(m, nmId);
      if ((getMaterialDef(nmId) || {}).neon) patchNeonHdrChained(m, { value: 1 }, "rswIndNeonHdr1");
    }
  });
}

export function applyPartMaterial(THREE, obj, rec, helpers = {}) {
  if (!THREE || !obj || !rec || rec.kind !== "part") return;
  synchronizeSubstrateAuthoring(obj, rec);
  if (rec.isMeshPart) {


    applyIndividualMeshIdentity(obj, rec);
    return;
  }
  const mats = collectBaseMaterials(obj);
  if (!mats.length) return;
  const onReady = helpers.requestRender || null;

  const variant = resolveVariantFor(rec);
  const def = getMaterialDef(rec.material);


  for (const m of mats) {
    if (!m.userData) m.userData = {};
    m.userData.__rswMatName = rec.material || "Plastic";
    if (m.isMeshPhongMaterial) applyPhongPhysics(m, m.userData.__rswMatName);
    if (m.isMeshStandardMaterial) applyStandardPhysics(m, m.userData.__rswMatName);
  }
  const use2022 = isUse2022();
  const key = variant
    ? `v|${variant.name}|${variant.colorMap}|${variant.studsPerTile}`
    : `m|${rec.material}|${use2022 ? "2022" : "classic"}`;

  let tex = obj.userData.__rswMatTex || null;

  if (obj.userData.__rswMatKey !== key) {
    if (tex && tex.dispose) tex.dispose();
    tex = null;
    if (variant && variant.colorMap) {
      tex = makeAssetTexture(THREE, variant.colorMap, onReady);
    }
    if (!tex) {
      const canvas = materialCanvas(variant ? variant.baseMaterial : rec.material, use2022);
      if (canvas) {
        tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
      }
    }
    obj.userData.__rswMatTex = tex;
    obj.userData.__rswMatKey = key;
    for (const m of mats) {
      m.map = tex || null;
      m.needsUpdate = true;
    }
  }
  if (tex) {
    const spt = variant ? variant.studsPerTile : 4;                                 
    const ru = Math.max(rec.size.x, rec.size.z) / Math.max(0.05, spt);
    const rv = rec.size.y / Math.max(0.05, spt);
    tex.repeat.set(
      Number.isFinite(ru) && ru > 0 ? ru : 1,
      Number.isFinite(rv) && rv > 0 ? rv : 1,
    );
  }

  obj.userData.__rswNeon = !variant && !!def.neon;
  obj.userData.__rswMatOpacity =
    !variant && Number.isFinite(def.opacity) ? def.opacity : 1;
}


export { syncNeonEmissive } from "./baseMaterials.js";


const FACES = {
  Front: { pos: [0, 0, -0.5], rot: [0, Math.PI, 0], u: "x", v: "y" },
  Back: { pos: [0, 0, 0.5], rot: [0, 0, 0], u: "x", v: "y" },
  Right: { pos: [0.5, 0, 0], rot: [0, Math.PI / 2, 0], u: "z", v: "y" },
  Left: { pos: [-0.5, 0, 0], rot: [0, -Math.PI / 2, 0], u: "z", v: "y" },
  Top: { pos: [0, 0.5, 0], rot: [-Math.PI / 2, 0, 0], u: "x", v: "z" },
  Bottom: { pos: [0, -0.5, 0], rot: [Math.PI / 2, 0, 0], u: "x", v: "z" },
};

function disposeSubtree(node) {
  const visit = (n) => {
    if (n.geometry && !(n.geometry.userData && n.geometry.userData.__rswShared) && n.geometry.dispose) {
      n.geometry.dispose();
    }
    if (n.material) {
      const mats = Array.isArray(n.material) ? n.material : [n.material];
      for (const m of mats) {
        if (!m) continue;
        if (m.map && m.map.dispose) m.map.dispose();
        if (m.dispose) m.dispose();
      }
    }
  };
  if (typeof node.traverse === "function") node.traverse(visit);
  else visit(node);
}

function syncLayerGroup(THREE, obj, rec, onReady) {
  const old = obj.userData.__rswAppGroup;
  if (old) {
    obj.remove(old);
    disposeSubtree(old);
    obj.userData.__rswAppGroup = null;
  }
  const layers =
    rec.appearance && Array.isArray(rec.appearance.layers) ? rec.appearance.layers : null;
  if (!layers || !layers.length) return;
  const group = new THREE.Group();
  group.userData.rswAppearance = true;
  let order = 0;
  for (const layer of layers) {
    if (layer.transparency >= 1) continue;                              
    const f = FACES[layer.face] || FACES.Front;
    const tex = makeAssetTexture(THREE, layer.texture, onReady);
    if (!tex) continue;                                      
    const dimU = Math.max(0.05, rec.size[f.u]);
    const dimV = Math.max(0.05, rec.size[f.v]);
    if (layer.type === "texture") {
      const su = Math.max(0.05, layer.studsPerTileU);
      const sv = Math.max(0.05, layer.studsPerTileV);
      tex.repeat.set(dimU / su, dimV / sv);
      tex.offset.set(-((layer.offsetStudsU || 0) / su) % 1, -((layer.offsetStudsV || 0) / sv) % 1);
    }
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 1 - layer.transparency,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2 - order,
      polygonOffsetUnits: -2 - order,
      side: THREE.FrontSide,
    });
    mat.color.setRGB(layer.color.r, layer.color.g, layer.color.b);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    plane.position.set(f.pos[0] * 1.004, f.pos[1] * 1.004, f.pos[2] * 1.004);
    plane.rotation.set(f.rot[0], f.rot[1], f.rot[2]);
    plane.renderOrder = 10 + (Number.isFinite(layer.zIndex) ? layer.zIndex : 0);
    plane.userData.rswDecal = true;
    group.add(plane);
    order += 1;
  }
  if (!group.children.length) return;
  obj.add(group);
  obj.userData.__rswAppGroup = group;
}


function makeWedgeGeo(THREE) {

  const pos = new Float32Array([

    -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5,

    0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, 0.5,

    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5,
    -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5,

    -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5,
    -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5,

    -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, -0.5,
    -0.5, -0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

function makeCornerWedgeGeo(THREE) {

  const a = [-0.5, -0.5, -0.5];
  const b = [0.5, -0.5, -0.5];
  const c = [0.5, -0.5, 0.5];
  const d = [-0.5, -0.5, 0.5];
  const top = [0.5, 0.5, -0.5];
  const tris = [
    [a, c, b], [a, d, c],        
    [a, b, top],      
    [b, c, top],      
    [c, d, top], [d, a, top],          
  ];
  const pos = new Float32Array(tris.flat().flat());
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

function makeHeadGeo(THREE) {


  const pts = [];
  pts.push(new THREE.Vector2(0, -0.5));
  pts.push(new THREE.Vector2(0.32, -0.48));
  pts.push(new THREE.Vector2(0.46, -0.36));
  pts.push(new THREE.Vector2(0.5, -0.15));
  pts.push(new THREE.Vector2(0.5, 0.15));
  pts.push(new THREE.Vector2(0.46, 0.36));
  pts.push(new THREE.Vector2(0.32, 0.48));
  pts.push(new THREE.Vector2(0, 0.5));
  return new THREE.LatheGeometry(pts, 20);
}

function makeTorsoGeo(THREE) {

  const geo = new THREE.BoxGeometry(1, 1, 1);
  const posAttr = geo.getAttribute("position");
  for (let i = 0; i < posAttr.count; i++) {
    const y = posAttr.getY(i);
    const k = 1 - 0.25 * (y + 0.5);                               
    posAttr.setX(i, posAttr.getX(i) * k);
  }
  posAttr.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}


export function geoForMeshType(THREE, type) {
  switch (type) {
    case "Brick":
      return new THREE.BoxGeometry(1, 1, 1);
    case "Cylinder":
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 20);
    case "Sphere":
      return new THREE.SphereGeometry(0.5, 20, 14);
    case "Head":
      return makeHeadGeo(THREE);
    case "Torso":
      return makeTorsoGeo(THREE);
    case "Wedge":
    case "ParallelRamp":
      return makeWedgeGeo(THREE);
    case "CornerWedge":
      return makeCornerWedgeGeo(THREE);
    case "Prism":
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 3);
    case "Pyramid":
      return new THREE.ConeGeometry(0.5, 1, 4);
    default:
      return new THREE.BoxGeometry(1, 1, 1);
  }
}

function setBaseSurfaceHidden(obj, hidden) {
  for (const m of collectBaseMaterials(obj)) m.visible = !hidden;
  obj.userData.__rswSurfaceHidden = !!hidden;
}

function syncSpecialMesh(THREE, obj, rec, onReady) {
  const old = obj.userData.__rswSpecial;
  if (old) {
    obj.remove(old);
    disposeSubtree(old);
    obj.userData.__rswSpecial = null;
  }
  const special =
    rec.appearance && rec.appearance.special && !rec.isMeshPart
      ? rec.appearance.special
      : null;
  if (!special) {
    if (obj.userData.__rswSurfaceHidden) setBaseSurfaceHidden(obj, false);
    return;
  }

  setBaseSurfaceHidden(obj, true);

  const holder = new THREE.Group();
  holder.userData.rswSpecialMesh = true;
  const sx = Math.max(0.05, rec.size.x);
  const sy = Math.max(0.05, rec.size.y);
  const sz = Math.max(0.05, rec.size.z);


  holder.position.set(special.offset.x / sx, special.offset.y / sy, special.offset.z / sz);
  const clampScale = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return 1;
    return Math.min(1000, Math.max(0.001, Math.abs(v))) * (v < 0 ? -1 : 1) || 0.001;
  };
  holder.scale.set(clampScale(special.scale.x), clampScale(special.scale.y), clampScale(special.scale.z));

  const mat = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.05 });

  applyStandardPhysics(mat, (rec && rec.material) || "Plastic");


  mat.userData.__rswMatName = (rec && rec.material) || "Plastic";
  const vc = special.vertexColor || { x: 1, y: 1, z: 1 };
  mat.color.setRGB(
    Math.max(0, Math.min(2, vc.x)) * rec.color.r,
    Math.max(0, Math.min(2, vc.y)) * rec.color.g,
    Math.max(0, Math.min(2, vc.z)) * rec.color.b,
  );
  if (special.textureId) {
    const tex = makeAssetTexture(THREE, special.textureId, onReady);
    if (tex) {
      mat.map = tex;
      mat.color.setRGB(
        Math.max(0, Math.min(2, vc.x)),
        Math.max(0, Math.min(2, vc.y)),
        Math.max(0, Math.min(2, vc.z)),
      );
    }
  }

  if (special.meshType === "FileMesh" && special.meshId) {
    const data = resolveMeshData(special.meshId);
    if (data) {

      loadMeshInto(THREE, holder, data, () => {
        if (typeof onReady === "function") onReady();
      });
    } else {
      holder.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat));
    }
  } else {
    holder.add(new THREE.Mesh(geoForMeshType(THREE, special.meshType), mat));
  }
  obj.add(holder);
  obj.userData.__rswSpecial = holder;


  obj.userData.__litMode = null;
}


const saQa = { materials: 0, orm: 0, pom: 0, detailColor: 0, detailNormal: 0, overlay: 0, transparency: 0, tintMask: 0, lastPlan: null };
if (typeof window !== "undefined") {
  window.__rswSurfaceQaF10 = { get: () => ({ ...saQa }) };
}


export function saWeakGpu() {
  try {
    const t = typeof window !== "undefined" && window.__rswLightingQa && window.__rswLightingQa.get();
    return t ? !!t.weakGpu : true;
  } catch (_) {
    return true;
  }
}


export function configureSurfaceMaterial(THREE, sm, surface, getTex, opts = {}) {
  const allowPatch = opts.allowPatch !== false;
  setSubstrateMaterialSource(sm, surface.substrateMaterial || "");
  const plan = planSurfaceMaps(surface, { weakGpu: saWeakGpu() });
  const c = surface.color || { r: 1, g: 1, b: 1 };
  sm.color.setRGB(c.r, c.g, c.b);
  const m = plan.maps;
  const tex = (entry) => (entry ? getTex(entry.id, { srgb: entry.srgb }) || null : null);
  const colorMap = tex(m.color);
  const normalMap = tex(m.normal);
  const ormMap = tex(m.orm);
  const metalMap = ormMap || tex(m.metalness);
  const roughMap = ormMap || tex(m.roughness);
  const heightMap = tex(m.height);


  if (heightMap) {
    heightMap.generateMipmaps = false;
    heightMap.minFilter = THREE.LinearFilter;
  }
  const detailColorTex = tex(m.detailColor);
  const detailNormalTex = normalMap ? tex(m.detailNormal) : null;
  sm.map = colorMap;
  sm.normalMap = normalMap;
  sm.metalnessMap = metalMap;
  sm.roughnessMap = roughMap;

  sm.aoMap = ormMap || null;
  sm.aoMapIntensity = 1;

  sm.metalness = metalMap ? 1 : 0.1;
  sm.roughness = roughMap ? 1 : 0.8;

  if (sm.normalScale) sm.normalScale.set(1, plan.normalScaleY);
  sm.transparent = plan.alpha.transparent;
  const flags = { pom: !!heightMap, detailColor: !!detailColorTex, detailNormal: !!detailNormalTex };
  const uniforms = { uSaAlphaMode: { value: plan.alpha.index } };
  if (flags.pom) {
    uniforms.uSaHeightMap = { value: heightMap };
    uniforms.uSaPomScale = { value: plan.pomScale };
    uniforms.uSaPomSteps = { value: plan.pomSteps };
  }
  if (flags.detailColor) uniforms.uSaDetailColor = { value: detailColorTex };
  if (flags.detailNormal) uniforms.uSaDetailNormal = { value: detailNormalTex };
  if (flags.detailColor || flags.detailNormal) uniforms.uSaDetailTiling = { value: plan.detailTiling };
  sm.userData.__rswSaPlan = plan;

  sm.userData.__rswSaTex = [heightMap, detailColorTex, detailNormalTex].filter(Boolean);
  if (allowPatch) {
    const patch = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.defines = shader.defines || {};
      if (flags.pom) shader.defines.RSW_SA_POM = 1;
      if (flags.detailColor) shader.defines.RSW_SA_DETAIL_COLOR = 1;
      if (flags.detailNormal) shader.defines.RSW_SA_DETAIL_NORMAL = 1;
      shader.fragmentShader = SA_GLSL_UNIFORMS + "\n" + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_fragment>",
        SA_GLSL_PRELUDE + "\n" + SA_GLSL_MAP_CHUNK,
      );
      if (flags.pom || flags.detailNormal) {
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <normal_fragment_maps>",
          SA_GLSL_NORMAL_CHUNK,
        );
      }
      if (flags.pom) {
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <roughnessmap_fragment>",
          SA_GLSL_ROUGHNESS_CHUNK,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <metalnessmap_fragment>",
          SA_GLSL_METALNESS_CHUNK,
        );
      }


    };
    const key = saProgramKey(flags);

    sm.userData.__rswBasePatch = patch;
    sm.userData.__rswBaseKey = () => key;
    sm.onBeforeCompile = patch;
    sm.customProgramCacheKey = sm.userData.__rswBaseKey;
  }
  saQa.materials += 1;
  if (ormMap) saQa.orm += 1;
  if (flags.pom) saQa.pom += 1;
  if (flags.detailColor) saQa.detailColor += 1;
  if (flags.detailNormal) saQa.detailNormal += 1;
  if (plan.alpha.index === 0) saQa.overlay += 1;
  else if (plan.alpha.index === 1) saQa.transparency += 1;
  else saQa.tintMask += 1;
  saQa.lastPlan = {
    alphaMode: plan.alpha.index,
    orm: !!ormMap,
    pom: flags.pom,
    detailColor: flags.detailColor,
    detailNormal: flags.detailNormal,
    normalScaleY: plan.normalScaleY,
    texUnits: plan.texUnits,
    pomScale: plan.pomScale,
    pomSteps: plan.pomSteps,
    detailTiling: plan.detailTiling,
  };
  return plan;
}


function syncMeshSurface(THREE, obj, rec, onReady) {
  const content = obj.userData.__meshContent;
  if (!content) return;                                                          
  const surface = rec.appearance && rec.appearance.surface ? rec.appearance.surface : null;
  const nodes = [];
  content.traverse((n) => {
    if (n.isMesh) nodes.push(n);
  });
  if (!nodes.length) return;


  for (const n of nodes) {
    if (n.userData.__rswOrigMat === undefined) n.userData.__rswOrigMat = n.material || null;
  }


  if (obj.userData.__rswSurfaceMat) {
    const sm = obj.userData.__rswSurfaceMat;
    const seen = new Set();
    const extra = (sm.userData && sm.userData.__rswSaTex) || [];
    for (const t of [sm.map, sm.normalMap, sm.metalnessMap, sm.roughnessMap, sm.aoMap, ...extra]) {
      if (t && !seen.has(t)) {
        seen.add(t);
        if (t.dispose) t.dispose();
      }
    }
    if (sm.dispose) sm.dispose();
    obj.userData.__rswSurfaceMat = null;
  }

  const side = rec.doubleSided ? THREE.DoubleSide : THREE.FrontSide;

  if (surface) {


    const sm = new THREE.MeshStandardMaterial();
    configureSurfaceMaterial(
      THREE,
      sm,
      surface,
      (id, opts) => makeAssetTexture(THREE, id, onReady, opts),
    );
    sm.side = side;
    obj.userData.__rswSurfaceMat = sm;


    const oldMeshTex = obj.userData.__rswMeshTex || null;
    if (oldMeshTex && oldMeshTex.dispose) oldMeshTex.dispose();
    obj.userData.__rswMeshTex = null;
    for (const n of nodes) n.material = sm;
    return;
  }


  const oldTex = obj.userData.__rswMeshTex || null;
  let tex = null;
  if (rec.textureId) tex = makeAssetTexture(THREE, rec.textureId, onReady);
  for (const n of nodes) {
    if (n.userData.__rswOrigMat !== undefined && n.userData.__rswOrigMat !== null) {
      n.material = n.userData.__rswOrigMat;
    }
    const m = n.material;
    if (!m) continue;
    if (m.__rswOrigMap === undefined) m.__rswOrigMap = m.map || null;
    m.map = tex || m.__rswOrigMap;
    m.side = side;
    m.needsUpdate = true;
  }
  if (oldTex && oldTex !== tex && oldTex.dispose) oldTex.dispose();
  obj.userData.__rswMeshTex = tex || null;
}


export function syncAppearance(THREE, obj, rec, helpers = {}) {
  if (!THREE || !obj || !rec || rec.kind !== "part") return;
  const onReady = helpers.requestRender || null;
  syncLayerGroup(THREE, obj, rec, onReady);
  syncSpecialMesh(THREE, obj, rec, onReady);
  if (rec.isMeshPart) syncMeshSurface(THREE, obj, rec, onReady);
  synchronizeSubstrateAuthoring(obj, rec);
}
