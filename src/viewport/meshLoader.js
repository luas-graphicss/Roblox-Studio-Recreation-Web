import { logger } from "../core/logger.js";
import { assetStore } from "../assets/assetStore.js";
import { parseObjAsync } from "../assets/objParser.js";
import { meshRegistry } from "../assets/meshRegistry.js";
import { buildMeshCollision, normalizeSoup } from "../physics/collisionGeometry.js";            
import { registerSkin } from "../assets/skinRegistry.js";            
import { buildNodeSubmeshes, isIdentityMatrix } from "./gltfProtoSplit.js";             
import { extractPosePaletteMeta } from "./skinnedPaletteCore.js";             


import { applyStandardPhysics, hasMaterialPhysics } from "../lighting/materialPhysicsTable.js";

const GLTF_URL =
  "https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/loaders/GLTFLoader.js";

let _loaderPromise = null;

async function getGLTFLoaderClass() {
  if (!_loaderPromise) {
    _loaderPromise = import(                   GLTF_URL)
      .then((m) => m.GLTFLoader)
      .catch((err) => {
        _loaderPromise = null;
        throw err;
      });
  }
  return _loaderPromise;
}


export function isLoadableMeshExt(ext) {
  const e = String(ext || "").toLowerCase();
  return e === "glb" || e === "gltf" || e === "obj";
}


export function resolveMeshData(meshId) {
  if (!meshId) return null;
  let rec = null;
  try {
    rec = assetStore.getById(meshId);
  } catch (_) {
    rec = null;
  }
  if (!rec || !rec.dataUri || !rec.local) return null;
  if (!isLoadableMeshExt(rec.ext)) return null;
  return {
    id: String(meshId),
    dataUri: rec.dataUri,
    ext: String(rec.ext).toLowerCase(),
    name: rec.name,
  };
}

function dataUriToArrayBuffer(dataUri) {
  const comma = dataUri.indexOf(",");
  const payload = dataUri.slice(comma + 1);
  const bytes = atob(payload);
  const len = bytes.length;
  const buf = new ArrayBuffer(len);
  const view = new Uint8Array(buf);
  for (let i = 0; i < len; i++) view[i] = bytes.charCodeAt(i);
  return buf;
}

function dataUriToText(dataUri) {
  const comma = dataUri.indexOf(",");
  const meta = dataUri.slice(0, comma);
  const payload = dataUri.slice(comma + 1);
  if (meta.indexOf(";base64") !== -1) {
    const raw = atob(payload);
    try {

      return decodeURIComponent(escape(raw));
    } catch (_) {
      return raw;
    }
  }
  try {
    return decodeURIComponent(payload);
  } catch (_) {
    return payload;
  }
}


function normalizeToUnit(THREE, object) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const s = 1 / maxDim;
  object.position.sub(center);
  const wrapper = new THREE.Group();
  wrapper.add(object);
  wrapper.scale.setScalar(s);
  return wrapper;
}


function removePlaceholder(group) {
  const placeholder = group.userData.__placeholder;
  if (!placeholder) return;
  group.remove(placeholder);
  const visit = (node) => {
    if (node.geometry && node.geometry.dispose) node.geometry.dispose();
    if (node.material && node.material.dispose) node.material.dispose();
  };
  if (typeof placeholder.traverse === "function") placeholder.traverse(visit);
  else visit(placeholder);
  group.userData.__placeholder = null;
}


const objGeoCache = new Map();                                                            

export function getSharedObjGeometry(THREE, meshData) {
  const key = meshData.id || meshData.dataUri;
  if (!objGeoCache.has(key)) {
    objGeoCache.set(
      key,
      buildObjGeometry(THREE, meshData).catch((err) => {
        logger.warn(
          `Falha no parse do .obj "${meshData.name || "?"}": ${err && err.message}.`,
        );
        return null;
      }),
    );
  }
  return objGeoCache.get(key);
}

async function buildObjGeometry(THREE, meshData) {
  const text = dataUriToText(meshData.dataUri);
  const parsed = await parseObjAsync(text);
  if (!parsed.ok) {
    logger.warn(`Mesh "${meshData.name || "?"}": ${parsed.error}`);
    return null;
  }
  for (const w of parsed.warnings || []) {
    logger.warn(`Mesh "${meshData.name || "?"}": ${w}`);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(parsed.positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(parsed.normals, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(parsed.uvs, 2));
  geo.userData.__rswShared = true;
  const center = {
    x: (parsed.bounds.min.x + parsed.bounds.max.x) / 2,
    y: (parsed.bounds.min.y + parsed.bounds.max.y) / 2,
    z: (parsed.bounds.min.z + parsed.bounds.max.z) / 2,
  };
  if (meshData.id) {

    let collision = null;
    try {
      const maxDim = Math.max(parsed.size.x, parsed.size.y, parsed.size.z) || 1;
      const soup = normalizeSoup(parsed.positions, center, maxDim);
      collision = soup ? buildMeshCollision(soup) : null;
    } catch (_) {
      collision = null;
    }
    meshRegistry.register(meshData.id, {
      size: parsed.size,
      triangles: parsed.triangleCount,
      collision,
    });
  }
  return { geometry: geo, size: parsed.size, center, triangles: parsed.triangleCount };
}

async function loadObjInto(THREE, group, meshData, onReady) {
  try {
    const data = await getSharedObjGeometry(THREE, meshData);
    if (!data) return false;
    if (group.userData.__disposed) return false;
    const mat = new THREE.MeshStandardMaterial({
      color: 0xdfe3e8,
      roughness: 0.85,
      metalness: 0.05,
    });
    applyStandardPhysics(mat, "Plastic");                                 
    const mesh = new THREE.Mesh(data.geometry, mat);
    mesh.frustumCulled = true;
    mesh.userData.rswMeshChild = true;
    mesh.position.set(-data.center.x, -data.center.y, -data.center.z);
    const wrapper = new THREE.Group();
    const maxDim = Math.max(data.size.x, data.size.y, data.size.z) || 1;
    wrapper.scale.setScalar(1 / maxDim);
    wrapper.add(mesh);
    removePlaceholder(group);
    group.add(wrapper);
    group.userData.__meshLoaded = true;
    group.userData.__meshContent = wrapper;

    group.userData.__rswUvChannels = 1;
    if (typeof onReady === "function") {
      onReady({ size: data.size, triangles: data.triangles });
    }
    return true;
  } catch (err) {
    logger.warn(
      `Falha ao carregar mesh "${(meshData && meshData.name) || "?"}": ${err && err.message}.`,
    );
    return false;
  }
}


function extractSkinFromGltf(scene, meshId) {
  if (!scene || !meshId) return null;
  let node = null;
  scene.traverse((n) => {
    if (!node && n.isSkinnedMesh && n.skeleton && n.geometry) node = n;
  });
  if (!node) return null;
  const geo = node.geometry;
  const posAttr = geo.getAttribute("position");
  const skinIdx = geo.getAttribute("skinIndex");
  const skinW = geo.getAttribute("skinWeight");
  if (!posAttr || !skinIdx || !skinW) return null;
  const bones = node.skeleton.bones || [];
  if (!bones.length) return null;
  const order = [];
  const seen = new Set();
  const visit = (b) => {
    if (!b || seen.has(b)) return;
    if (b.parent && bones.indexOf(b.parent) !== -1) visit(b.parent);
    seen.add(b);
    order.push(b);
  };
  for (const b of bones) visit(b);
  const remap = new Map();
  order.forEach((b, i) => remap.set(bones.indexOf(b), i));
  const joints = order.map((b, i) => {
    const r = b.rotation || { x: 0, y: 0, z: 0 };
    const pIdx = b.parent ? order.indexOf(b.parent) : -1;
    return {
      name: b.name || `Bone${i}`,
      parent: pIdx,
      pos: { x: b.position.x, y: b.position.y, z: b.position.z },
      rot: { x: (r.x * 180) / Math.PI, y: (r.y * 180) / Math.PI, z: (r.z * 180) / Math.PI },
    };
  });
  const normAttr = geo.getAttribute("normal");
  const uvAttr = geo.getAttribute("uv");
  return registerSkin(meshId, {
    joints,
    positions: Array.from(posAttr.array),
    normals: normAttr ? Array.from(normAttr.array) : [],
    uvs: uvAttr ? Array.from(uvAttr.array) : [],
    indices: geo.index ? Array.from(geo.index.array) : [],
    skinIndex: Array.from(skinIdx.array, (v) => (remap.has(v) ? remap.get(v) : 0)),
    skinWeight: Array.from(skinW.array),
  });
}


const gltfParseCache = new Map();                                    

async function parseGltf(THREE, meshData, skipCollision = false) {
  const GLTFLoader = await getGLTFLoaderClass();
  const loader = new GLTFLoader();
  const buffer = dataUriToArrayBuffer(meshData.dataUri);
  const gltf = await new Promise((resolve, reject) => {
    try {
      loader.parse(buffer, "", resolve, reject);
    } catch (err) {
      reject(err);
    }
  });
  const scene = gltf && gltf.scene ? gltf.scene : null;
  if (!scene) throw new Error("glTF sem cena");


  let skin = null;
  try {
    skin = extractSkinFromGltf(scene, meshData.id);
  } catch (_) {
    skin = null;
  }

  let hasSkin = false;
  scene.traverse((node) => {
    if (node.isSkinnedMesh) hasSkin = true;
    if (node.isMesh) {


      node.frustumCulled = !node.isSkinnedMesh;
      node.userData.rswMeshChild = true;
      if (node.material) {
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        for (const m of mats) {
          if (!m) continue;
          m.side = THREE.FrontSide;


          if (!m.userData) m.userData = {};
          if (!m.userData.__rswMatName && hasMaterialPhysics(m.name)) {
            m.userData.__rswMatName = m.name;
          }
        }
      }
    }
  });
  if (!hasSkin) {
    scene.traverse((node) => {
      if (node.isMesh && node.geometry) node.geometry.userData.__rswShared = true;
    });
  }


  const preBox = new THREE.Box3().setFromObject(scene);
  const preSize = new THREE.Vector3(1, 1, 1);
  if (!preBox.isEmpty()) preBox.getSize(preSize);
  const nativeSize = {
    x: preSize.x || 1,
    y: preSize.y || 1,
    z: preSize.z || 1,
  };




  const collision = skipCollision ? null : buildGltfCollision(scene);
  return { scene, nativeSize, skin, hasSkin, consumed: false, collision };
}

function getGltfEntry(THREE, meshData) {
  const key = meshData.id || meshData.dataUri;
  let hit = gltfParseCache.get(key);
  if (!hit) {
    hit = parseGltf(THREE, meshData).catch((err) => {
      gltfParseCache.delete(key);                                     
      throw err;
    });
    gltfParseCache.set(key, hit);
  }
  return hit;
}


function cloneGltfScene(scene) {
  const clone = scene.clone(true);
  clone.traverse((node) => {
    if (node.isMesh && node.material) {
      node.material = Array.isArray(node.material)
        ? node.material.map((m) => (m && m.clone ? m.clone() : m))
        : node.material.clone
          ? node.material.clone()
          : node.material;
    }
  });
  return clone;
}


const GLTF_PROTO_MAX_SUBMESHES = 12;                                            
const gltfProtoCache = new Map();                                         

export function getSharedGltfProto(THREE, meshData) {
  const key = meshData.id || meshData.dataUri;
  let hit = gltfProtoCache.get(key);
  if (hit) return hit;
  hit = getGltfEntry(THREE, meshData)
    .then(async (entry) => {
      if (!entry) return null;
      const skinned = !!entry.hasSkin;


      const scene = skinned ? (await parseGltf(THREE, meshData, true)).scene : entry.scene;
      scene.updateMatrixWorld(true);


      const posePool = skinned ? extractPosePaletteMeta(scene) : null;
      const box = new THREE.Box3().setFromObject(scene);
      if (box.isEmpty()) return null;
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      const submeshes = [];
      let bad = false;
      scene.traverse((node) => {
        if (bad || !node.isMesh || !node.geometry) return;


        const subs = buildNodeSubmeshes(THREE, node, {
          maxCount: GLTF_PROTO_MAX_SUBMESHES - submeshes.length,
          stripSkin: skinned && !posePool,
        });
        if (!subs) {
          bad = true;                                                       
          return;
        }
        for (const s of subs) submeshes.push(s);
      });
      if (bad || !submeshes.length) return null;
      return {
        submeshes,
        skinned,                                                       
        posePool,                                                            
        center: { x: center.x, y: center.y, z: center.z },
        size: { x: size.x || 1, y: size.y || 1, z: size.z || 1 },
      };
    })
    .catch(() => null);
  gltfProtoCache.set(key, hit);
  return hit;
}


function buildGltfCollision(scene) {
  try {
    scene.updateMatrixWorld(true);
    const soup = [];
    const MAX_TRIS = 60000;
    let full = false;
    scene.traverse((node) => {
      if (full || !node.isMesh || !node.geometry) return;
      const pos = node.geometry.getAttribute("position");
      if (!pos) return;
      const e = node.matrixWorld.elements;
      const idx = node.geometry.index ? node.geometry.index.array : null;
      const count = idx ? idx.length : pos.count;
      const triCount = Math.floor(count / 3);
      for (let t = 0; t < triCount; t++) {
        if (soup.length >= MAX_TRIS * 9) {
          full = true;
          return;
        }
        for (let k = 0; k < 3; k++) {
          const vi = idx ? idx[t * 3 + k] : t * 3 + k;
          const x = pos.getX(vi), y = pos.getY(vi), z = pos.getZ(vi);
          soup.push(
            e[0] * x + e[4] * y + e[8] * z + e[12],
            e[1] * x + e[5] * y + e[9] * z + e[13],
            e[2] * x + e[6] * y + e[10] * z + e[14],
          );
        }
      }
    });
    if (soup.length < 9) return null;
    let loX = Infinity, loY = Infinity, loZ = Infinity;
    let hiX = -Infinity, hiY = -Infinity, hiZ = -Infinity;
    for (let i = 0; i < soup.length; i += 3) {
      if (soup[i] < loX) loX = soup[i];
      if (soup[i] > hiX) hiX = soup[i];
      if (soup[i + 1] < loY) loY = soup[i + 1];
      if (soup[i + 1] > hiY) hiY = soup[i + 1];
      if (soup[i + 2] < loZ) loZ = soup[i + 2];
      if (soup[i + 2] > hiZ) hiZ = soup[i + 2];
    }
    const maxDim = Math.max(hiX - loX, hiY - loY, hiZ - loZ) || 1;
    const center = { x: (loX + hiX) / 2, y: (loY + hiY) / 2, z: (loZ + hiZ) / 2 };
    const norm = normalizeSoup(soup, center, maxDim);
    return norm ? buildMeshCollision(norm) : null;
  } catch (_) {
    return null;
  }
}

async function loadGltfInto(THREE, group, meshData, onReady) {
  try {
    const entry = await getGltfEntry(THREE, meshData);
    if (group.userData.__disposed) return false;
    let scene;
    let skin = entry.skin;
    let nativeSize = entry.nativeSize;
    if (entry.hasSkin) {


      if (entry.consumed) {


        const fresh = await parseGltf(THREE, meshData, true);
        if (group.userData.__disposed) return false;
        scene = fresh.scene;
        skin = fresh.skin;
        nativeSize = fresh.nativeSize;
      } else {
        entry.consumed = true;
        scene = entry.scene;
      }
    } else {
      scene = cloneGltfScene(entry.scene);
    }
    if (meshData.id) {


      meshRegistry.register(meshData.id, {
        size: nativeSize,
        triangles: 0,
        collision: entry.collision || null,
      });
    }
    const normalized = normalizeToUnit(THREE, scene) || scene;
    removePlaceholder(group);
    group.add(normalized);
    group.userData.__meshLoaded = true;
    group.userData.__meshContent = normalized;


    let saUvCh = 0;
    normalized.traverse((n) => {
      if (n.isMesh && n.geometry) {
        if (n.geometry.getAttribute("uv")) saUvCh = Math.max(saUvCh, 1);
        if (n.geometry.getAttribute("uv1")) saUvCh = Math.max(saUvCh, 2);
      }


      if (n.isMesh && n.material) {
        const nMats = Array.isArray(n.material) ? n.material : [n.material];
        for (const m of nMats) {
          if (m && m.userData && m.userData.__rswMatName) {
            applyStandardPhysics(m, m.userData.__rswMatName);
          }
        }
      }
    });
    group.userData.__rswUvChannels = saUvCh;
    if (typeof onReady === "function") onReady({ size: nativeSize, triangles: 0, skin, hasSkin: entry.hasSkin });
    return true;
  } catch (err) {
    logger.warn(
      `Falha ao carregar mesh "${(meshData && meshData.name) || "?"}": ${err && err.message}.`,
    );
    return false;
  }
}


export async function loadMeshInto(THREE, group, meshData, onReady) {
  if (!THREE || !group || !meshData) return false;
  if (meshData.ext === "obj") return loadObjInto(THREE, group, meshData, onReady);
  return loadGltfInto(THREE, group, meshData, onReady);
}
