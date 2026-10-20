export function isIdentityMatrix(mat) {
  const e = mat && mat.elements;
  if (!e) return false;
  for (let i = 0; i < 16; i++) {
    const want = i % 5 === 0 ? 1 : 0;
    if (Math.abs(e[i] - want) > 1e-9) return false;
  }
  return true;
}

function pickMaterial(mats, idx) {
  const i = Number.isInteger(idx) ? idx : 0;
  if (i >= 0 && i < mats.length && mats[i]) return mats[i];
  for (const m of mats) if (m) return m;                                      
  return null;
}

export function buildNodeSubmeshes(THREE, node, opts = {}) {
  if (!THREE || !node || !node.geometry || !node.material) return null;
  const maxCount = Number.isFinite(opts.maxCount) ? opts.maxCount : Infinity;
  const stripSkin = !!opts.stripSkin;
  const isMulti = Array.isArray(node.material);
  const mats = isMulti ? node.material : [node.material];
  const srcGeo = node.geometry;
  const groups = isMulti && Array.isArray(srcGeo.groups) ? srcGeo.groups : null;
  if (isMulti && (!groups || !groups.length)) return null;                               
  const need = isMulti ? groups.length : 1;
  if (need > maxCount) return null;                                 


  let baseGeo = srcGeo;
  if (node.matrixWorld && !isIdentityMatrix(node.matrixWorld)) {
    baseGeo = srcGeo.clone();
    baseGeo.applyMatrix4(node.matrixWorld);
  }
  if (stripSkin && typeof baseGeo.deleteAttribute === "function") {
    baseGeo.deleteAttribute("skinIndex");
    baseGeo.deleteAttribute("skinWeight");
  }
  if (!baseGeo.userData) baseGeo.userData = {};
  baseGeo.userData.__rswShared = true;

  if (!isMulti) {
    const material = pickMaterial(mats, 0);
    if (!material) return null;
    return [{ geometry: baseGeo, material }];
  }

  const index = baseGeo.index || null;
  const posAttr =
    baseGeo.attributes && baseGeo.attributes.position
      ? baseGeo.attributes.position
      : typeof baseGeo.getAttribute === "function"
        ? baseGeo.getAttribute("position")
        : null;
  const cap = index ? index.count : posAttr ? posAttr.count : 0;
  if (!cap) return null;

  const out = [];
  for (const group of groups) {
    if (!group) continue;
    const start = Math.max(0, Math.floor(group.start || 0));
    let count = Number.isFinite(group.count) ? Math.floor(group.count) : cap - start;
    count = Math.min(count, cap - start);                                      
    if (count <= 0) continue;                          
    const material = pickMaterial(mats, group.materialIndex);
    if (!material) continue;
    const sub = new THREE.BufferGeometry();
    const attrs = baseGeo.attributes || {};
    for (const name of Object.keys(attrs)) sub.setAttribute(name, attrs[name]);
    if (index) {
      const arr = index.array;
      sub.setIndex(new THREE.BufferAttribute(arr.slice(start, start + count), 1));
    } else {
      const range = new Uint32Array(count);
      for (let i = 0; i < count; i++) range[i] = start + i;
      sub.setIndex(new THREE.BufferAttribute(range, 1));
    }
    if (!sub.userData) sub.userData = {};
    sub.userData.__rswShared = true;
    out.push({ geometry: sub, material });
  }
  return out.length ? out : null;
}
