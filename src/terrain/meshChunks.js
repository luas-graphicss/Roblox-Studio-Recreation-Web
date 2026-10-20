export const DEFAULT_CELL_STUDS = 128;
export const MIN_SPLIT_TRIANGLES = 4096;                                         
export const MIN_SPLIT_INSTANCES = 2048;

const KEY_HALF = 4096;                                                 
const KEY_SPAN = KEY_HALF * 2;

function cellKey(cx, cz) {
  const kx = (cx < -KEY_HALF ? -KEY_HALF : cx >= KEY_HALF ? KEY_HALF - 1 : cx) + KEY_HALF;
  const kz = (cz < -KEY_HALF ? -KEY_HALF : cz >= KEY_HALF ? KEY_HALF - 1 : cz) + KEY_HALF;
  return kx * KEY_SPAN + kz;
}

function boundsOfPositions(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      const v = positions[i + c];
      if (v < min[c]) min[c] = v;
      if (v > max[c]) max[c] = v;
    }
  }
  return { min, max };
}

function sphereFromBounds(bounds) {
  const center = [
    (bounds.min[0] + bounds.max[0]) * 0.5,
    (bounds.min[1] + bounds.max[1]) * 0.5,
    (bounds.min[2] + bounds.max[2]) * 0.5,
  ];
  const dx = (bounds.max[0] - bounds.min[0]) * 0.5;
  const dy = (bounds.max[1] - bounds.min[1]) * 0.5;
  const dz = (bounds.max[2] - bounds.min[2]) * 0.5;
  return { center, radius: Math.hypot(dx, dy, dz) };
}


export function splitTriangleSoup(input, opts = {}) {
  if (!input) return null;
  const { positions, normals, colors, mats, weights } = input;
  if (!positions || !positions.length || positions.length % 9 !== 0) return null;
  const n = positions.length;
  if (!normals || normals.length !== n) return null;
  if (!colors || colors.length !== n) return null;
  if (!mats || mats.length !== n) return null;
  if (!weights || weights.length !== n) return null;
  const triCount = n / 9;
  const cellSize = opts.cellSize > 0 ? opts.cellSize : DEFAULT_CELL_STUDS;
  const minSplit = Number.isFinite(opts.minSplit) ? Math.max(0, opts.minSplit) : MIN_SPLIT_TRIANGLES;
  const single = () => [{ positions, normals, colors, mats, weights, triCount, bounds: boundsOfPositions(positions) }];
  if (triCount <= minSplit) return single();

  const inv = 1 / cellSize;
  const keys = new Float64Array(triCount);
  const counts = new Map();
  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    const cx = (positions[o] + positions[o + 3] + positions[o + 6]) / 3;
    const cz = (positions[o + 2] + positions[o + 5] + positions[o + 8]) / 3;
    const key = cellKey(Math.floor(cx * inv), Math.floor(cz * inv));
    keys[t] = key;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (counts.size <= 1) return single();

  const chunks = new Map();
  for (const [key, c] of counts) {
    chunks.set(key, {
      positions: new Float32Array(c * 9),
      normals: new Float32Array(c * 9),
      colors: new Float32Array(c * 9),
      mats: new Float32Array(c * 9),
      weights: new Float32Array(c * 9),
      triCount: c,
      bounds: { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] },
      cursor: 0,
    });
  }
  for (let t = 0; t < triCount; t++) {
    const ch = chunks.get(keys[t]);
    const src = t * 9;
    const dst = ch.cursor * 9;
    for (let k = 0; k < 9; k++) {
      ch.positions[dst + k] = positions[src + k];
      ch.normals[dst + k] = normals[src + k];
      ch.colors[dst + k] = colors[src + k];
      ch.mats[dst + k] = mats[src + k];
      ch.weights[dst + k] = weights[src + k];
    }
    const bmin = ch.bounds.min, bmax = ch.bounds.max;
    for (let v = 0; v < 9; v += 3) {
      for (let c = 0; c < 3; c++) {
        const val = positions[src + v + c];
        if (val < bmin[c]) bmin[c] = val;
        if (val > bmax[c]) bmax[c] = val;
      }
    }
    ch.cursor++;
  }
  const out = [];
  for (const ch of chunks.values()) {
    delete ch.cursor;
    out.push(ch);
  }
  return out;
}


export function splitInstancesIntoCells(inst, opts = {}) {
  if (!inst || !inst.data || !(inst.count > 0)) return [];
  const stride = inst.stride | 0;
  if (stride < 3) return [];
  const count = Math.min(inst.count | 0, Math.floor(inst.data.length / stride));
  if (count <= 0) return [];
  const data = inst.data;
  const cellSize = opts.cellSize > 0 ? opts.cellSize : DEFAULT_CELL_STUDS;
  const minSplit = Number.isFinite(opts.minSplit) ? Math.max(0, opts.minSplit) : MIN_SPLIT_INSTANCES;

  const boundsOfRange = (arr, cnt, str) => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < cnt; i++) {
      const o = i * str;
      for (let c = 0; c < 3; c++) {
        const v = arr[o + c];
        if (v < min[c]) min[c] = v;
        if (v > max[c]) max[c] = v;
      }
    }
    return { min, max };
  };
  const single = () => {
    const s = sphereFromBounds(boundsOfRange(data, count, stride));
    return [{ count, stride, data, center: s.center, radius: s.radius }];
  };
  if (count <= minSplit) return single();

  const inv = 1 / cellSize;
  const keys = new Float64Array(count);
  const counts = new Map();
  for (let i = 0; i < count; i++) {
    const o = i * stride;
    const key = cellKey(Math.floor(data[o] * inv), Math.floor(data[o + 2] * inv));
    keys[i] = key;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (counts.size <= 1) return single();

  const chunks = new Map();
  for (const [key, c] of counts) {
    chunks.set(key, {
      count: c,
      stride,
      data: new Float32Array(c * stride),
      bounds: { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] },
      cursor: 0,
    });
  }
  for (let i = 0; i < count; i++) {
    const ch = chunks.get(keys[i]);
    const src = i * stride;
    const dst = ch.cursor * stride;
    for (let k = 0; k < stride; k++) ch.data[dst + k] = data[src + k];
    const bmin = ch.bounds.min, bmax = ch.bounds.max;
    for (let c = 0; c < 3; c++) {
      const v = data[src + c];
      if (v < bmin[c]) bmin[c] = v;
      if (v > bmax[c]) bmax[c] = v;
    }
    ch.cursor++;
  }
  const out = [];
  for (const ch of chunks.values()) {
    const s = sphereFromBounds(ch.bounds);
    out.push({ count: ch.count, stride: ch.stride, data: ch.data, center: s.center, radius: s.radius });
  }
  return out;
}


export const REMESH_BUDGET_MS = 6;                                       
export const REMESH_MAX_PER_DRAIN = 64;                                  
const DEFAULT_CHUNK_STUDS = 64;                                              


export function parseChunkKey(key) {
  if (typeof key !== "string") return null;
  const parts = key.split("|");
  if (parts.length !== 3) return null;
  const cx = Number(parts[0]), cy = Number(parts[1]), cz = Number(parts[2]);
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)) return null;
  return [cx, cy, cz];
}

export function createRemeshQueue(opts = {}) {
  const chunkStuds = opts.chunkStuds > 0 ? opts.chunkStuds : DEFAULT_CHUNK_STUDS;
  const pending = new Map();                                                          
  let focus = null;                                                    
  let dirty = false;                                                        
  let order = [];                                                               

  function distSq(item) {
    if (!focus) return 0;
    const dx = (item.cx + 0.5) * chunkStuds - focus.x;
    const dz = (item.cz + 0.5) * chunkStuds - focus.z;
    return dx * dx + dz * dz;
  }

  return {
    size() { return pending.size; },
    has(key) { return pending.has(key); },


    enqueue(a, b, c) {
      let key, cx, cy, cz;
      if (typeof a === "string") {
        const p = parseChunkKey(a);
        if (!p) return false;
        key = a; cx = p[0]; cy = p[1]; cz = p[2];
      } else {
        if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return false;
        cx = Math.floor(a); cy = Math.floor(b); cz = Math.floor(c);
        key = cx + "|" + cy + "|" + cz;
      }
      if (pending.has(key)) return true;
      pending.set(key, { key, cx, cy, cz });
      dirty = true;
      return true;
    },


    setFocus(x, z) {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return;
      if (focus && Math.abs(focus.x - x) < chunkStuds * 0.5 && Math.abs(focus.z - z) < chunkStuds * 0.5) return;
      focus = { x, z };
      dirty = true;
    },
    clear() { pending.clear(); order = []; dirty = false; },


    drain(fn, opts2 = {}) {
      const out = { processed: 0, remaining: pending.size };
      if (typeof fn !== "function" || pending.size === 0) return out;
      const budgetMs = Number.isFinite(opts2.budgetMs) ? Math.max(0, opts2.budgetMs) : REMESH_BUDGET_MS;
      const maxItems = Number.isFinite(opts2.maxItems) ? Math.max(1, Math.floor(opts2.maxItems)) : REMESH_MAX_PER_DRAIN;
      const now = typeof opts2.now === "function" ? opts2.now : Date.now;
      if (dirty) {
        order = [...pending.values()];
        if (focus) order.sort((p, q) => distSq(q) - distSq(p));                            
        else order.reverse();                                     
        dirty = false;
      }
      const t0 = now();
      while (order.length > 0 && out.processed < maxItems) {
        const item = order.pop();
        if (!pending.delete(item.key)) continue;                                
        fn(item.key, item.cx, item.cy, item.cz);
        out.processed++;
        if (now() - t0 >= budgetMs) break;
      }
      out.remaining = pending.size;
      return out;
    },
  };
}
