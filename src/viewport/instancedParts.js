import { applyNeonEmissivePatch, getMaterialDef, materialCanvas } from "./baseMaterials.js";

import { applyPhongPhysics, applyStandardPhysics } from "../lighting/materialPhysicsTable.js";


import { glassRefractionPatchFor, glassRefractionKeyFor, markGlassMaterial } from "./refractionPass.js";
import { getOverrideVariant, isUse2022 } from "../editor/materialPaint.js";
import { isLayersOnly } from "./decalPoolCore.js";
import { markInstanceAttributeRange, writeInstanceAttribute, writeInstanceColor } from "./instanceAttributeRanges.js";

export const INSTANCED_SHAPES = Object.freeze(["Block", "Ball", "Cylinder", "Wedge"]);

const INITIAL_CAPACITY = 256;
const DEG = Math.PI / 180;
const STUDS_PER_TILE = 4;                                                           
const NEON_BOOST = 2.2;                                                        

function modeIs2022() {
  try {
    return isUse2022() !== false;
  } catch (_) {
    return true;
  }
}


export function isInstanceableMaterial(name) {
  const def = getMaterialDef(name || "Plastic");
  return !!def;
}


export function effOpacityFor(rec) {
  const tr = Math.min(1, Math.max(0, Number(rec && rec.transparency) || 0));
  const ltm = Math.min(1, Math.max(0, Number(rec && rec.localTransparency) || 0));
  const t = tr + (1 - tr) * ltm;
  let def = null;
  try {
    def = getMaterialDef((rec && rec.material) || "Plastic");
  } catch (_) {
    def = null;
  }
  const matOp = def && Number.isFinite(def.opacity) ? def.opacity : 1;
  return (1 - t) * matOp;
}

export function isInstanceable(rec, { allowSubstrate = false } = {}) {
  if (!rec || rec.kind !== "part") return false;
  if (rec.csg || rec.isMeshPart) return false;


  if (rec.appearance && !isLayersOnly(rec.appearance)) return false;
  if (rec.className === "SpawnLocation") return false;
  if (rec.materialVariant || (rec.substrateMaterial && !allowSubstrate)) return false;


  const tr0 = Math.min(1, Math.max(0, Number(rec.transparency) || 0));
  const ltm0 = Math.min(1, Math.max(0, Number(rec.localTransparency) || 0));
  if (tr0 + (1 - tr0) * ltm0 >= 1) return false;
  if (INSTANCED_SHAPES.indexOf(rec.shape || "Block") === -1) return false;
  const material = rec.material || "Plastic";
  if (!isInstanceableMaterial(material)) return false;
  let override = null;
  try {
    override = getOverrideVariant(material);
  } catch (_) {
    override = null;
  }
  if (override) return false;
  return true;
}


function makePoolShaderPatch(withAlpha) {
  return function (shader) {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <uv_vertex>",
      [
        "#include <uv_vertex>",
        "#if defined( USE_MAP ) && defined( USE_INSTANCING )",
        "\tvMapUv *= vec2( max( length( instanceMatrix[ 0 ].xyz ), length( instanceMatrix[ 2 ].xyz ) ), length( instanceMatrix[ 1 ].xyz ) ) / " +
          STUDS_PER_TILE.toFixed(1) + ";",
        "#endif",
      ].join("\n"),
    );
    if (withAlpha) {
      shader.vertexShader = (
        "attribute float rswAlpha;\nvarying float vRswAlpha;\n" + shader.vertexShader
      ).replace("#include <begin_vertex>", "vRswAlpha = rswAlpha;\n\t#include <begin_vertex>");
      shader.fragmentShader = (
        "varying float vRswAlpha;\n" + shader.fragmentShader
      ).replace(
        "#include <color_fragment>",
        "#include <color_fragment>\n\tdiffuseColor.a *= vRswAlpha;",
      );
    }
  };
}

export function createInstancedParts({ THREE, scene, geoForShape, materialBatching = null }) {
  const pools = new Map();
  const byId = new Map();
  const hiddenMatrices = new Map();
  const tmpMatrix = new THREE.Matrix4();
  const tmpPos = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const tmpEuler = new THREE.Euler();
  const tmpScale = new THREE.Vector3();
  const tmpColor = new THREE.Color();
  const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  let disposed = false;
  let flatMode = false;                                                   


  let lightModel = "lambert";
  let lightSpec = 1;

  function poolKeyFor(rec) {
    return (
      (rec.shape || "Block") +
      "|" +
      (rec.material || "Plastic") +
      "|" +
      (modeIs2022() ? "2022" : "classic") +
      (effOpacityFor(rec) < 1 ? "|tr" : "|op")
    );
  }

  function resolutionFor(rec) {
    const hostBatchKey = poolKeyFor(rec);
    return materialBatching ? materialBatching.resolve(rec, hostBatchKey) : { ok: true, key: hostBatchKey };
  }

  function accepts(rec) {
    return isInstanceable(rec, { allowSubstrate: materialBatching?.hasRecipe(rec) === true });
  }

  function brightnessFor(material) {
    let def = null;
    try { def = getMaterialDef(material); } catch (_) { def = null; }
    const b = def && typeof def.brightness === "number" ? def.brightness : 1;
    return Math.min(1, Math.max(0, b));
  }

  function makePoolTexture(material, use2022) {
    let canvas = null;
    try {
      canvas = materialCanvas(material, use2022);
    } catch (_) {
      canvas = null;
    }
    if (!canvas) return null;
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  function makePoolMaterial(pool, existingTex) {





    let mat;
    if (lightModel === "basic") {
      mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    } else if (lightModel === "standard") {
      mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.05 });
      mat.userData.__rswMatName = pool.material;
      mat.userData.__rswSbGenerated = true;
      mat.userData.__rswSbPool = true;
      applyStandardPhysics(mat, pool.material);
    } else if (lightModel === "phong") {
      mat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 28 });
      mat.specular.setScalar(0.18 * lightSpec);


      applyPhongPhysics(mat, pool.material, { specScale: lightSpec, rebase: true });


      mat.userData.__rswMatName = pool.material;
    } else {
      mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    }
    if (pool.shape === "Wedge" && THREE.DoubleSide != null) mat.side = THREE.DoubleSide;
    const tex = existingTex || makePoolTexture(pool.material, pool.use2022);
    if (tex) mat.map = tex;
    if (pool.translucent) {


      mat.transparent = true;
      mat.depthWrite = false;
    }


    const neonPool = !!(getMaterialDef(pool.material) || {}).neon && lightModel !== "basic";


    const glassPool =
      !!pool.translucent &&
      (getMaterialDef(pool.material) || {}).cat === "Glass" &&
      lightModel !== "basic";
    const refrPatch = glassPool ? glassRefractionPatchFor(pool.material) : null;
    if (tex || pool.translucent || neonPool) {
      const uvPatch = makePoolShaderPatch(!!pool.translucent);
      const basePatch = !neonPool && !refrPatch
        ? uvPatch
        : function (shader) {
            uvPatch(shader);
            if (refrPatch) refrPatch(shader);
            if (neonPool) applyNeonEmissivePatch(shader);
          };
      const baseKey = () =>
        (pool.translucent ? "rswInstPool3A" : "rswInstPool3") +
        (neonPool ? "|neon" : "") +
        (refrPatch ? "|" + glassRefractionKeyFor() : "");
      mat.onBeforeCompile = basePatch;
      mat.customProgramCacheKey = baseKey;


      mat.userData.__rswBasePatch = basePatch;
      mat.userData.__rswBaseKey = baseKey;
      if (refrPatch) markGlassMaterial(mat, pool.material);
    }
    return mat;
  }

  function makeMesh(pool, capacity, material) {
    const mat = material || makePoolMaterial(pool);
    const mesh = new THREE.InstancedMesh(pool.geometry, mat, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.userData.__rswPool = true;
    mesh.userData.__rswPoolKey = pool.key;
    mesh.userData.__rswShared = true;
    if (mesh.instanceMatrix && typeof mesh.instanceMatrix.setUsage === "function" && THREE.DynamicDrawUsage != null) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    mesh.setColorAt(0, tmpColor.setRGB(1, 1, 1));
    if (mesh.instanceColor && typeof mesh.instanceColor.setUsage === "function" && THREE.DynamicDrawUsage != null) {
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    return mesh;
  }


  function makeAlphaAttribute(capacity, prev) {
    const arr = new Float32Array(capacity);
    if (prev) arr.set(prev.array);
    else arr.fill(1);
    const attr = new THREE.InstancedBufferAttribute(arr, 1);
    if (typeof attr.setUsage === "function" && THREE.DynamicDrawUsage != null) {
      attr.setUsage(THREE.DynamicDrawUsage);
    }
    return attr;
  }


  function applyFlat(pool) {
    const mat = pool.mesh ? pool.mesh.material : null;
    if (!mat) return;
    if (flatMode) {
      if (mat.map) {
        pool.savedMap = mat.map;
        mat.map = null;
        mat.needsUpdate = true;
      }
    } else if (pool.savedMap) {
      mat.map = pool.savedMap;
      pool.savedMap = null;
      mat.needsUpdate = true;
    }
  }

  function setFlatMode(on) {
    const want = !!on;
    if (disposed || want === flatMode) return false;
    if (materialBatching && !materialBatching.permitsHostMaterialChange()) return false;
    flatMode = want;
    for (const pool of pools.values()) applyFlat(pool);
    return true;
  }


  function setLightingModel(kind, specScale) {
    if (disposed) return false;
    const model = kind === "basic" || kind === "phong" || kind === "standard" ? kind : "lambert";
    const spec = Math.min(1, Math.max(0, Number(specScale) || 0));
    const kindChanged = model !== lightModel;
    const specChanged = model === "phong" && spec !== lightSpec;
    if (!kindChanged && !specChanged) return false;
    if (materialBatching && !materialBatching.permitsHostMaterialChange()) return false;
    lightModel = model;
    lightSpec = spec;
    for (const pool of pools.values()) {
      if (!pool.mesh) continue;
      const old = pool.mesh.material;
      if (!kindChanged) {
        if (old && old.isMeshPhongMaterial) {
          old.specular.setScalar(0.18 * lightSpec);

          applyPhongPhysics(old, pool.material, { specScale: lightSpec, rebase: true });
        }
        continue;
      }
      const tex = pool.savedMap || (old && old.map) || null;
      pool.savedMap = null;
      const next = makePoolMaterial(pool, tex);
      pool.mesh.material = next;
      if (flatMode) applyFlat(pool);
      if (old) {
        old.map = null;                                                
        old.dispose();
      }
    }
    return kindChanged;
  }

  function ensurePool(rec, resolution = resolutionFor(rec), replacingPool = null) {
    if (!resolution.ok) return null;
    const key = resolution.key;
    let pool = pools.get(key);
    if (pool) return !materialBatching || materialBatching.validatePool(pool, resolution).ok ? pool : null;
    const shape = rec.shape || "Block";
    const material = rec.material || "Plastic";
    const def = getMaterialDef(material);
    const boost = def && def.neon ? NEON_BOOST : 1;
    const translucent = effOpacityFor(rec) < 1;
    pool = {
      key,
      shape,
      material,
      use2022: modeIs2022(),
      translucent,
      colorScale: 1,
      geometry: null,
      alpha: null,
      capacity: INITIAL_CAPACITY,
      count: 0,
      ids: [],
      slots: new Map(),
      centers: new Float64Array(INITIAL_CAPACITY * 3),
      mesh: null,
      savedMap: null,
    };
    if (translucent) {


      pool.geometry = geoForShape(shape).clone();
      pool.geometry.userData.__rswShared = true;                                  
      pool.alpha = makeAlphaAttribute(INITIAL_CAPACITY, null);
      pool.geometry.setAttribute("rswAlpha", pool.alpha);
    } else {
      pool.geometry = geoForShape(shape);
    }
    pool.mesh = makeMesh(pool, pool.capacity, null);


    const hasMap = !!(pool.mesh.material && pool.mesh.material.map);
    pool.colorScale = hasMap ? boost : boost * brightnessFor(material);
    if (flatMode) applyFlat(pool);
    if (materialBatching && !materialBatching.preparePool(pool, resolution, replacingPool).ok) {
      disposePool(pool);
      return null;
    }
    scene.add(pool.mesh);
    pools.set(key, pool);
    return pool;
  }

  function grow(pool) {
    const nextCapacity = pool.capacity * 2;
    const next = makeMesh(pool, nextCapacity, pool.mesh.material);
    next.userData = pool.mesh.userData;
    next.position.copy(pool.mesh.position);
    next.quaternion.copy(pool.mesh.quaternion);
    next.scale.copy(pool.mesh.scale);
    next.visible = pool.mesh.visible;
    next.castShadow = pool.mesh.castShadow;
    next.receiveShadow = pool.mesh.receiveShadow;
    next.layers.mask = pool.mesh.layers.mask;
    next.renderOrder = pool.mesh.renderOrder;
    next.customDepthMaterial = pool.mesh.customDepthMaterial;
    next.customDistanceMaterial = pool.mesh.customDistanceMaterial;
    next.onBeforeRender = pool.mesh.onBeforeRender;
    next.onAfterRender = pool.mesh.onAfterRender;
    next.instanceMatrix.array.set(pool.mesh.instanceMatrix.array);
    if (pool.mesh.instanceColor && next.instanceColor) {
      next.instanceColor.array.set(pool.mesh.instanceColor.array);
    }
    next.count = pool.count;
    next.instanceMatrix.needsUpdate = true;
    if (next.instanceColor) next.instanceColor.needsUpdate = true;
    scene.remove(pool.mesh);
    if (typeof pool.mesh.dispose === "function") pool.mesh.dispose();
    const centers = new Float64Array(nextCapacity * 3);
    centers.set(pool.centers);
    pool.centers = centers;
    if (pool.alpha) {
      pool.alpha = makeAlphaAttribute(nextCapacity, pool.alpha);
      pool.geometry.setAttribute("rswAlpha", pool.alpha);
      pool.alpha.needsUpdate = true;
    }
    pool.mesh = next;
    pool.capacity = nextCapacity;
    scene.add(next);
  }

  function writeInstance(pool, slot, rec) {
    const p = rec.position || { x: 0, y: 0, z: 0 };
    const r = rec.rotation || { x: 0, y: 0, z: 0 };
    const s = rec.size || { x: 1, y: 1, z: 1 };
    tmpPos.set(p.x || 0, p.y || 0, p.z || 0);
    tmpEuler.set((r.x || 0) * DEG, (r.y || 0) * DEG, (r.z || 0) * DEG, "XYZ");
    tmpQuat.setFromEuler(tmpEuler);
    tmpScale.set(
      Math.max(Number(s.x) || 1, 0.05),
      Math.max(Number(s.y) || 1, 0.05),
      Math.max(Number(s.z) || 1, 0.05)
    );
    tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
    if (hiddenMatrices.has(rec.id)) {
      hiddenMatrices.set(rec.id, tmpMatrix.toArray());
      writeInstanceAttribute(pool.mesh.instanceMatrix, slot, zeroMatrix.elements);
    } else {
      if (writeInstanceAttribute(pool.mesh.instanceMatrix, slot, tmpMatrix.elements)) {
        pool.mesh.boundingSphere = null;
        pool.mesh.boundingBox = null;
      }
    }
    const c = rec.color || null;
    const cr = c && c.r != null ? c.r : 0.64;
    const cg = c && c.g != null ? c.g : 0.64;
    const cb = c && c.b != null ? c.b : 0.64;
    writeInstanceColor(pool.mesh, slot, tmpColor.setRGB(cr * pool.colorScale, cg * pool.colorScale, cb * pool.colorScale));
    if (pool.alpha) {
      writeInstanceAttribute(pool.alpha, slot, [Math.min(1, Math.max(0, effOpacityFor(rec)))]);
    }
    pool.centers[slot * 3] = tmpPos.x;
    pool.centers[slot * 3 + 1] = tmpPos.y;
    pool.centers[slot * 3 + 2] = tmpPos.z;
  }

  function add(rec) {
    if (disposed || !rec || !accepts(rec)) return false;
    if (byId.has(rec.id)) return update(rec);
    const pool = ensurePool(rec);
    if (!pool) return false;
    return appendInstance(pool, rec);
  }

  function appendInstance(pool, rec) {
    if (pool.count >= pool.capacity) grow(pool);
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
    pool.ids[slot] = rec.id;
    pool.slots.set(rec.id, slot);
    byId.set(rec.id, pool);
    pool.mesh.count = pool.count;
    return true;
  }

  function update(rec) {
    if (disposed || !rec || !accepts(rec)) return false;
    const pool = byId.get(rec.id);
    if (!pool) return false;
    const resolution = resolutionFor(rec);
    if (!resolution.ok) return false;
    if (pool.key !== resolution.key) {
      const destination = ensurePool(rec, resolution, pool);
      if (!destination) return false;
      if (destination.count >= destination.capacity) grow(destination);
      const previousHidden = hiddenMatrices.get(rec.id);
      try {
        writeInstance(destination, destination.count, rec);
      } catch {
        if (previousHidden) hiddenMatrices.set(rec.id, previousHidden);
        if (destination.count === 0) disposePool(destination);
        return false;
      }
      const nextHidden = hiddenMatrices.get(rec.id);
      remove(rec.id);
      if (nextHidden) hiddenMatrices.set(rec.id, nextHidden);
      return commitInstance(destination, rec);
    }
    if (materialBatching && !materialBatching.validatePool(pool, resolution).ok) return false;
    writeInstance(pool, pool.slots.get(rec.id), rec);
    return true;
  }

  function remove(id) {
    const pool = byId.get(id);
    if (!pool) return false;
    const slot = pool.slots.get(id);
    const last = pool.count - 1;
    if (slot !== last) {
      const lastId = pool.ids[last];
      const ma = pool.mesh.instanceMatrix.array;
      ma.copyWithin(slot * 16, last * 16, last * 16 + 16);
      if (pool.mesh.instanceColor) {
        const ca = pool.mesh.instanceColor.array;
        ca.copyWithin(slot * 3, last * 3, last * 3 + 3);
      }
      if (pool.alpha) {
        pool.alpha.array[slot] = pool.alpha.array[last];
        markInstanceAttributeRange(pool.alpha, slot);
      }
      markInstanceAttributeRange(pool.mesh.instanceMatrix, slot);
      pool.mesh.boundingSphere = null;
      pool.mesh.boundingBox = null;
      if (pool.mesh.instanceColor) markInstanceAttributeRange(pool.mesh.instanceColor, slot);
      pool.centers[slot * 3] = pool.centers[last * 3];
      pool.centers[slot * 3 + 1] = pool.centers[last * 3 + 1];
      pool.centers[slot * 3 + 2] = pool.centers[last * 3 + 2];
      pool.ids[slot] = lastId;
      pool.slots.set(lastId, slot);
    }
    pool.ids.length = last;
    pool.count = last;
    pool.mesh.count = last;
    pool.slots.delete(id);
    byId.delete(id);
    hiddenMatrices.delete(id);
    if (materialBatching && pool.count === 0) disposePool(pool);
    return true;
  }

  function idFromHit(object, instanceId) {
    const key = object && object.userData ? object.userData.__rswPoolKey : null;
    const pool = key ? pools.get(key) : null;
    if (!pool || instanceId == null || instanceId < 0 || instanceId >= pool.count) return null;
    const id = pool.ids[instanceId];
    return id != null ? id : null;
  }

  function getRaycastMeshes() {
    const out = [];
    for (const pool of pools.values()) {
      if (pool.count > 0 && pool.mesh.visible !== false) out.push(pool.mesh);
    }
    return out;
  }

  function forEachCenter(fn) {
    for (const pool of pools.values()) {
      for (let i = 0; i < pool.count; i++) {
        fn(pool.ids[i], pool.centers[i * 3], pool.centers[i * 3 + 1], pool.centers[i * 3 + 2]);
      }
    }
  }

  function applyHidden(hiddenSet) {
    let changed = false;
    if (hiddenSet && hiddenSet.size) {
      for (const id of hiddenSet) {
        const pool = byId.get(id);
        if (!pool || hiddenMatrices.has(id)) continue;
        const slot = pool.slots.get(id);
        const ma = pool.mesh.instanceMatrix.array;
        hiddenMatrices.set(id, Array.prototype.slice.call(ma, slot * 16, slot * 16 + 16));
        writeInstanceAttribute(pool.mesh.instanceMatrix, slot, zeroMatrix.elements);
        changed = true;
      }
    }
    if (hiddenMatrices.size) {
      const restore = [];
      for (const id of hiddenMatrices.keys()) {
        if (!hiddenSet || !hiddenSet.has(id)) restore.push(id);
      }
      for (const id of restore) {
        const saved = hiddenMatrices.get(id);
        hiddenMatrices.delete(id);
        const pool = byId.get(id);
        if (!pool) continue;
        const slot = pool.slots.get(id);
        writeInstanceAttribute(pool.mesh.instanceMatrix, slot, tmpMatrix.fromArray(saved).elements);
        pool.mesh.boundingSphere = null;
        pool.mesh.boundingBox = null;
        changed = true;
      }
    }
    return changed;
  }

  function preparePromotion(id, meshes) {
    const pool = byId.get(id);
    return pool && materialBatching
      ? materialBatching.preparePromotion(pool, meshes)
      : { ok: false, reason: "SSM_POOL_NOT_BOUND" };
  }

  function disposePool(pool) {
    materialBatching?.releasePool(pool);
    pools.delete(pool.key);
    scene.remove(pool.mesh);
    const material = pool.mesh.material;
    const textures = new Set([material?.map, pool.savedMap]);
    for (const texture of textures) texture?.dispose?.();
    material?.dispose?.();
    pool.mesh.dispose?.();
    if (pool.translucent) pool.geometry?.dispose?.();
  }

  function dispose() {
    disposed = true;
    for (const pool of pools.values()) disposePool(pool);
    pools.clear();
    byId.clear();
    hiddenMatrices.clear();
  }

  return {
    accepts,
    preparePromotion,
    add,
    update,
    remove,
    has: (id) => byId.has(id),
    idFromHit,
    getRaycastMeshes,
    forEachCenter,
    applyHidden,
    setFlatMode,
    setLightingModel,
    size: () => byId.size,
    poolCount: () => pools.size,
    dispose,
  };
}
