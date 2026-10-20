import {
  poolableLayers,
  carrierKeyFor,
  partSignature,
  layerPlacement,
  layerUv,
  layerTintAlpha,
  MAX_CARRIER_POOLS,
} from "./decalPoolCore.js";

const INITIAL_CAPACITY = 16;
const DEG = Math.PI / 180;

export function createDecalCarriers({ THREE, scene, makeTexture, requestRender }) {
  const pools = new Map();                      
  const byPart = new Map();                                                               
  const hiddenParts = new Set();                                               
  let disposed = false;
  let flatMode = false;                                                           

  const tmpPos = new THREE.Vector3();
  const tmpScale = new THREE.Vector3();
  const tmpEuler = new THREE.Euler();
  const tmpQuat = new THREE.Quaternion();
  const tmpLocalPos = new THREE.Vector3();
  const tmpLocalScale = new THREE.Vector3();
  const tmpLocalEuler = new THREE.Euler();
  const tmpLocalQuat = new THREE.Quaternion();
  const tmpMatrix = new THREE.Matrix4();
  const tmpLocal = new THREE.Matrix4();
  const tmpColor = new THREE.Color();
  const zeroMatrix = new THREE.Matrix4();
  zeroMatrix.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1);


  function makeCarrierMaterial(tex) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    mat.map = tex || null;
    mat.transparent = true;
    mat.depthWrite = false;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
    if (THREE.FrontSide != null) mat.side = THREE.FrontSide;
    const patch = (shader) => {
      shader.vertexShader = (
        "attribute vec4 rswUvT;\nattribute float rswAlpha;\nvarying float vRswAlpha;\n" +
        shader.vertexShader
      )
        .replace(
          "#include <uv_vertex>",
          "#include <uv_vertex>\n#ifdef USE_MAP\n\tvMapUv = vMapUv * rswUvT.xy + rswUvT.zw;\n#endif",
        )
        .replace("#include <begin_vertex>", "vRswAlpha = rswAlpha;\n\t#include <begin_vertex>");
      shader.fragmentShader = ("varying float vRswAlpha;\n" + shader.fragmentShader).replace(
        "#include <color_fragment>",
        "#include <color_fragment>\n\tdiffuseColor.a *= vRswAlpha;",
      );
    };
    const key = () => "rswDecalCarrier1";
    mat.onBeforeCompile = patch;
    mat.customProgramCacheKey = key;


    mat.userData.__rswBasePatch = patch;
    mat.userData.__rswBaseKey = key;
    return mat;
  }

  function makeUvAttr(capacity, prev) {
    const arr = new Float32Array(capacity * 4);
    for (let i = 0; i < capacity; i++) {
      arr[i * 4] = 1;
      arr[i * 4 + 1] = 1;
    }
    if (prev) arr.set(prev.array);
    const attr = new THREE.InstancedBufferAttribute(arr, 4);
    if (typeof attr.setUsage === "function" && THREE.DynamicDrawUsage != null) {
      attr.setUsage(THREE.DynamicDrawUsage);
    }
    return attr;
  }

  function makeAlphaAttr(capacity, prev) {
    const arr = new Float32Array(capacity);
    arr.fill(1);
    if (prev) arr.set(prev.array);
    const attr = new THREE.InstancedBufferAttribute(arr, 1);
    if (typeof attr.setUsage === "function" && THREE.DynamicDrawUsage != null) {
      attr.setUsage(THREE.DynamicDrawUsage);
    }
    return attr;
  }

  function makeMesh(pool, capacity, material) {
    const mesh = new THREE.InstancedMesh(pool.geometry, material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;                                                      
    mesh.userData.__rswDecalPool = true;
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

  function ensurePool(key, layer) {
    let pool = pools.get(key);
    if (pool) return pool;
    if (disposed || pools.size >= MAX_CARRIER_POOLS) return null;


    const tex = typeof makeTexture === "function" ? makeTexture(layer.texture) : null;
    if (!tex) return null;
    pool = {
      key,
      geometry: new THREE.PlaneGeometry(1, 1),
      uvT: null,
      alpha: null,
      capacity: INITIAL_CAPACITY,
      count: 0,
      ids: [],
      slots: new Map(),
      mesh: null,
      savedMap: null,
    };
    pool.geometry.userData.__rswShared = true;                              
    pool.uvT = makeUvAttr(pool.capacity, null);
    pool.alpha = makeAlphaAttr(pool.capacity, null);
    pool.geometry.setAttribute("rswUvT", pool.uvT);
    pool.geometry.setAttribute("rswAlpha", pool.alpha);
    pool.mesh = makeMesh(pool, pool.capacity, makeCarrierMaterial(tex));
    if (flatMode) applyFlat(pool);
    scene.add(pool.mesh);
    pools.set(key, pool);
    return pool;
  }

  function grow(pool) {
    const nextCapacity = pool.capacity * 2;
    const next = makeMesh(pool, nextCapacity, pool.mesh.material);
    next.instanceMatrix.array.set(pool.mesh.instanceMatrix.array);
    if (pool.mesh.instanceColor && next.instanceColor) {
      next.instanceColor.array.set(pool.mesh.instanceColor.array);
    }
    next.count = pool.count;
    next.instanceMatrix.needsUpdate = true;
    if (next.instanceColor) next.instanceColor.needsUpdate = true;
    scene.remove(pool.mesh);
    if (typeof pool.mesh.dispose === "function") pool.mesh.dispose();
    pool.uvT = makeUvAttr(nextCapacity, pool.uvT);
    pool.alpha = makeAlphaAttr(nextCapacity, pool.alpha);
    pool.geometry.setAttribute("rswUvT", pool.uvT);
    pool.geometry.setAttribute("rswAlpha", pool.alpha);
    pool.uvT.needsUpdate = true;
    pool.alpha.needsUpdate = true;
    pool.mesh = next;
    pool.capacity = nextCapacity;
    scene.add(next);
  }

  function writeEntry(pool, slot, rec, layer) {
    if (slot == null || slot < 0 || slot >= pool.count) return;
    const p = rec.position || { x: 0, y: 0, z: 0 };
    const r = rec.rotation || { x: 0, y: 0, z: 0 };
    tmpPos.set(p.x || 0, p.y || 0, p.z || 0);
    tmpEuler.set((r.x || 0) * DEG, (r.y || 0) * DEG, (r.z || 0) * DEG, "XYZ");
    tmpQuat.setFromEuler(tmpEuler);
    tmpScale.set(1, 1, 1);
    tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
    const place = layerPlacement(layer, rec.size);
    tmpLocalPos.set(place.offset[0], place.offset[1], place.offset[2]);
    tmpLocalEuler.set(place.rot[0], place.rot[1], place.rot[2], "XYZ");
    tmpLocalQuat.setFromEuler(tmpLocalEuler);
    tmpLocalScale.set(place.scale[0], place.scale[1], 1);
    tmpLocal.compose(tmpLocalPos, tmpLocalQuat, tmpLocalScale);
    tmpMatrix.multiply(tmpLocal);
    pool.mesh.setMatrixAt(slot, hiddenParts.has(rec.id) ? zeroMatrix : tmpMatrix);
    const uv = layerUv(layer, rec.size);
    pool.uvT.array[slot * 4] = uv.repU;
    pool.uvT.array[slot * 4 + 1] = uv.repV;
    pool.uvT.array[slot * 4 + 2] = uv.offU;
    pool.uvT.array[slot * 4 + 3] = uv.offV;
    pool.uvT.needsUpdate = true;
    const ta = layerTintAlpha(layer);
    pool.alpha.array[slot] = ta.alpha;
    pool.alpha.needsUpdate = true;
    pool.mesh.setColorAt(slot, tmpColor.setRGB(ta.r, ta.g, ta.b));
    pool.mesh.instanceMatrix.needsUpdate = true;
    if (pool.mesh.instanceColor) pool.mesh.instanceColor.needsUpdate = true;
  }

  function addEntry(pool, entryId, rec, layer) {
    if (pool.count >= pool.capacity) grow(pool);
    const slot = pool.count;
    pool.count += 1;
    pool.ids[slot] = entryId;
    pool.slots.set(entryId, slot);
    pool.mesh.count = pool.count;
    writeEntry(pool, slot, rec, layer);
  }

  function removeEntry(pool, entryId) {
    const slot = pool.slots.get(entryId);
    if (slot == null) return;
    const last = pool.count - 1;
    if (slot !== last) {
      const lastId = pool.ids[last];
      pool.mesh.instanceMatrix.array.copyWithin(slot * 16, last * 16, last * 16 + 16);
      if (pool.mesh.instanceColor) {
        pool.mesh.instanceColor.array.copyWithin(slot * 3, last * 3, last * 3 + 3);
      }
      pool.uvT.array.copyWithin(slot * 4, last * 4, last * 4 + 4);
      pool.alpha.array[slot] = pool.alpha.array[last];
      pool.ids[slot] = lastId;
      pool.slots.set(lastId, slot);
    }
    pool.ids.length = last;
    pool.count = last;
    pool.mesh.count = last;
    pool.slots.delete(entryId);
    pool.uvT.needsUpdate = true;
    pool.alpha.needsUpdate = true;
    pool.mesh.instanceMatrix.needsUpdate = true;
    if (pool.mesh.instanceColor) pool.mesh.instanceColor.needsUpdate = true;
  }

  function disposePool(pool) {
    pools.delete(pool.key);
    scene.remove(pool.mesh);
    if (typeof pool.mesh.dispose === "function") pool.mesh.dispose();
    const mat = pool.mesh.material;
    if (mat) {
      if (mat.map && mat.map.dispose) mat.map.dispose();
      if (pool.savedMap && pool.savedMap.dispose) pool.savedMap.dispose();
      if (mat.dispose) mat.dispose();
    }
    if (pool.geometry && pool.geometry.dispose) pool.geometry.dispose();
  }


  function canHost(rec) {
    if (disposed || !rec || rec.kind !== "part") return false;
    if (!rec.appearance) return true;                   
    const layers = poolableLayers(rec.appearance);
    if (!layers) return false;
    const newKeys = new Set();
    for (const layer of layers) {
      const key = carrierKeyFor(layer);
      if (pools.has(key) || newKeys.has(key)) continue;
      if (pools.size + newKeys.size >= MAX_CARRIER_POOLS) return false;
      const tex = typeof makeTexture === "function" ? makeTexture(layer.texture) : null;
      if (!tex) return false;
      if (typeof tex.dispose === "function") tex.dispose();                      
      newKeys.add(key);
    }
    return true;
  }

  function removePart(id) {
    const cur = byPart.get(id);
    if (!cur) return false;
    const touched = new Set();
    for (const e of cur.entries) {
      removeEntry(e.pool, e.entryId);
      touched.add(e.pool);
    }
    byPart.delete(id);
    hiddenParts.delete(id);
    for (const pool of touched) {
      if (pool.count === 0) disposePool(pool);                                 
    }
    return true;
  }


  function sync(rec) {
    if (disposed || !rec) return false;
    const layers = rec.appearance ? poolableLayers(rec.appearance) : [];
    const cur = byPart.get(rec.id) || null;
    if (!layers || !layers.length) {
      if (cur) removePart(rec.id);
      return !!layers;                                             
    }
    const sig = partSignature(layers);
    if (cur && cur.sig === sig) {
      cur.rec = rec;
      for (let i = 0; i < cur.entries.length; i++) {
        const e = cur.entries[i];
        e.layer = layers[i];
        writeEntry(e.pool, e.pool.slots.get(e.entryId), rec, layers[i]);
      }
      return true;
    }


    const wasHidden = cur ? hiddenParts.has(rec.id) : false;
    if (cur) removePart(rec.id);
    if (wasHidden) hiddenParts.add(rec.id);
    const entries = [];
    for (let i = 0; i < layers.length; i++) {
      const pool = ensurePool(carrierKeyFor(layers[i]), layers[i]);
      if (!pool) {
        const touched = new Set();
        for (const e of entries) {
          removeEntry(e.pool, e.entryId);
          touched.add(e.pool);
        }
        for (const p of touched) {
          if (p.count === 0) disposePool(p);                                
        }
        hiddenParts.delete(rec.id);
        return false;
      }
      const entryId = rec.id + ":" + i;
      addEntry(pool, entryId, rec, layers[i]);
      entries.push({ pool, entryId, layer: layers[i] });
    }
    byPart.set(rec.id, { sig, rec, entries });
    if (typeof requestRender === "function") requestRender();
    return true;
  }

  function has(id) {
    return byPart.has(id);
  }

  function remove(id) {
    if (disposed) return false;
    return removePart(id);
  }


  function applyHidden(hidden) {
    if (disposed) return false;
    const want = hidden instanceof Set ? hidden : new Set(hidden || []);
    let changed = false;
    for (const [id, info] of byPart) {
      const h = want.has(id);
      if (h === hiddenParts.has(id)) continue;
      if (h) hiddenParts.add(id);
      else hiddenParts.delete(id);
      for (const e of info.entries) {
        writeEntry(e.pool, e.pool.slots.get(e.entryId), info.rec, e.layer);
      }
      changed = true;
    }
    return changed;
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
    flatMode = want;
    for (const pool of pools.values()) applyFlat(pool);
    return true;
  }

  function size() {
    return byPart.size;
  }

  function poolCount() {
    return pools.size;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const pool of [...pools.values()]) disposePool(pool);
    pools.clear();
    byPart.clear();
    hiddenParts.clear();
  }

  return {
    canHost,
    sync,
    has,
    remove,
    applyHidden,
    setFlatMode,
    size,
    poolCount,
    dispose,
  };
}
