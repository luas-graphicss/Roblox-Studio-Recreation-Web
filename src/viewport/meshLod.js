import { buildLodLevels } from "./csgLod.js";


const MESH_SMALL_TRIS = 300;
const SMALL_NEAR_CELLS_MIN = 3;
const SMALL_FAR_CELLS_MIN = 2;
const MAX_VERTICES = 600000;
const lodCache = new WeakMap();

function buildAnySizeLods(THREE, geometry) {
  const pos = geometry.getAttribute("position");
  const idx = typeof geometry.getIndex === "function" ? geometry.getIndex() : null;
  const tris = Math.floor((idx ? idx.count : pos.count) / 3);
  const opts =
    tris < MESH_SMALL_TRIS
      ? { nearCellsMin: SMALL_NEAR_CELLS_MIN, farCellsMin: SMALL_FAR_CELLS_MIN }
      : {};
  return buildLodLevels(THREE, geometry, opts);
}

export function getSharedMeshLods(THREE, geometry) {
  if (!THREE || !geometry || typeof geometry.getAttribute !== "function") return null;
  if (!geometry.userData || geometry.userData.__rswShared !== true) return null;
  if (lodCache.has(geometry)) return lodCache.get(geometry);
  let levels = null;
  const pos = geometry.getAttribute("position");
  const skinned = !!(geometry.getAttribute("skinIndex") || geometry.getAttribute("skinWeight"));
  if (pos && pos.count <= MAX_VERTICES && !skinned) {
    try {
      levels = buildAnySizeLods(THREE, geometry);
    } catch (_) {
      levels = null;
    }
  }
  if (levels) {
    for (const lvl of levels) {
      if (lvl && lvl.geo && lvl.geo !== geometry) {
        if (!lvl.geo.userData) lvl.geo.userData = {};
        lvl.geo.userData.__rswShared = true;
      }
    }
  }
  lodCache.set(geometry, levels);
  return levels;
}

const submeshLodCache = new WeakMap();

export function getSharedSubmeshLods(THREE, submeshes) {
  if (!THREE || !Array.isArray(submeshes) || !submeshes.length) return null;
  if (submeshLodCache.has(submeshes)) return submeshLodCache.get(submeshes);
  let result = null;
  const perSub = [];
  let maxLevels = 1;
  let valid = true;
  for (const sub of submeshes) {
    const geo = sub && sub.geometry ? sub.geometry : null;
    if (!geo || !geo.userData || geo.userData.__rswShared !== true) {
      valid = false;
      break;
    }


    const levels = getSharedMeshLods(THREE, geo);
    const usable = levels && levels.length >= 2 && levels[0].geo === geo ? levels : null;
    perSub.push({ geo, levels: usable });
    if (usable && usable.length > maxLevels) maxLevels = usable.length;
  }
  if (valid && maxLevels >= 2) {
    const unified = [];
    let prev = 0;
    for (let k = 0; k < maxLevels; k++) {
      let minDist = 0;
      const geos = new Array(perSub.length);
      for (let i = 0; i < perSub.length; i++) {
        const s = perSub[i];
        if (!s.levels) {
          geos[i] = s.geo;
          continue;
        }
        const idx = Math.min(k, s.levels.length - 1);
        geos[i] = s.levels[idx].geo;
        if (s.levels.length > k && s.levels[k].minDist > minDist) {
          minDist = s.levels[k].minDist;
        }
      }
      if (k > 0 && !(minDist > prev)) minDist = Math.max(prev * 2.5, prev + 60);
      prev = minDist;
      unified.push({ minDist, geo: geos[0], extraGeos: geos.slice(1) });
    }
    result = unified;
  }
  submeshLodCache.set(submeshes, result);
  return result;
}


const skinnedLodCache = new WeakMap();

export function getSkinnedGeoLods(THREE, geometry) {
  if (!THREE || !geometry || typeof geometry.getAttribute !== "function") return null;
  if (skinnedLodCache.has(geometry)) return skinnedLodCache.get(geometry);
  let result = null;
  const pos = geometry.getAttribute("position");
  const skinned = !!(geometry.getAttribute("skinIndex") && geometry.getAttribute("skinWeight"));
  const morphs = !!(geometry.morphAttributes && Object.keys(geometry.morphAttributes).length);
  if (pos && pos.count <= MAX_VERTICES && skinned && !morphs) {
    let levels = null;
    try {


      levels = buildAnySizeLods(THREE, geometry);
    } catch (_) {
      levels = null;
    }
    if (levels && levels.length > 1) {
      let near = null;
      let far = null;
      for (const lvl of levels) {
        if (!lvl || !lvl.geo || lvl.geo === geometry) continue;
        if (!lvl.geo.userData) lvl.geo.userData = {};
        lvl.geo.userData.__rswShared = true;
        if (lvl.role === "far") far = lvl.geo;
        else if (lvl.role === "near") near = lvl.geo;
      }
      if (near || far) result = [geometry, near || geometry, far || near || geometry];
    }
  }
  skinnedLodCache.set(geometry, result);
  return result;
}
