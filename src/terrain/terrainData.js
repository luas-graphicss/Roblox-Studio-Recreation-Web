import { clampNumber } from "../utils/validate.js";
import { VOXEL_SIZE } from "./materials.js";

export const CHUNK = 16;
const CHUNK_VOLUME = CHUNK * CHUNK * CHUNK;


export const IMPORT_BULK_MAX_CHUNKS = 65536;

function floorDiv(a, b) { return Math.floor(a / b); }
function chunkKey(cx, cy, cz) { return cx + "|" + cy + "|" + cz; }
function localIndex(lx, ly, lz) { return lx + CHUNK * (ly + CHUNK * lz); }

export class TerrainData {
  constructor() {
    this.chunks = new Map();
    this._min = null;
    this._max = null;
    this._version = 0;


    this._editMin = null;
    this._editMax = null;
    this._editAll = false;
  }
  get version() { return this._version; }
  isEmpty() { return this.chunks.size === 0; }

  _getChunk(cx, cy, cz, create) {
    const key = chunkKey(cx, cy, cz);
    let c = this.chunks.get(key);
    if (!c && create) {
      c = { mat: new Uint8Array(CHUNK_VOLUME), occ: new Uint8Array(CHUNK_VOLUME), count: 0 };
      this.chunks.set(key, c);
    }
    return c || null;
  }
  _growBounds(x, y, z) {
    if (!this._min) { this._min = [x, y, z]; this._max = [x, y, z]; return; }
    if (x < this._min[0]) this._min[0] = x;
    if (y < this._min[1]) this._min[1] = y;
    if (z < this._min[2]) this._min[2] = z;
    if (x > this._max[0]) this._max[0] = x;
    if (y > this._max[1]) this._max[1] = y;
    if (z > this._max[2]) this._max[2] = z;
  }
  _growEdit(x, y, z) {
    if (!this._editMin) { this._editMin = [x, y, z]; this._editMax = [x, y, z]; return; }
    if (x < this._editMin[0]) this._editMin[0] = x;
    if (y < this._editMin[1]) this._editMin[1] = y;
    if (z < this._editMin[2]) this._editMin[2] = z;
    if (x > this._editMax[0]) this._editMax[0] = x;
    if (y > this._editMax[1]) this._editMax[1] = y;
    if (z > this._editMax[2]) this._editMax[2] = z;
  }


  takeEditedRegion() {
    if (this._editAll) {
      this._editAll = false;
      this._editMin = null;
      this._editMax = null;
      return { all: true };
    }
    if (!this._editMin) return null;
    const r = { min: this._editMin.slice(), max: this._editMax.slice() };
    this._editMin = null;
    this._editMax = null;
    return r;
  }

  getOcc(x, y, z) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return 0;
    const cx = floorDiv(x, CHUNK), cy = floorDiv(y, CHUNK), cz = floorDiv(z, CHUNK);
    const c = this._getChunk(cx, cy, cz, false);
    if (!c) return 0;
    return c.occ[localIndex(x - cx * CHUNK, y - cy * CHUNK, z - cz * CHUNK)] / 255;
  }
  getMat(x, y, z) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return 0;
    const cx = floorDiv(x, CHUNK), cy = floorDiv(y, CHUNK), cz = floorDiv(z, CHUNK);
    const c = this._getChunk(cx, cy, cz, false);
    if (!c) return 0;
    return c.mat[localIndex(x - cx * CHUNK, y - cy * CHUNK, z - cz * CHUNK)];
  }

  set(x, y, z, mat, occ01) {


    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    const occ = Math.round(clampNumber(occ01, 0, 1, 0) * 255);
    const cx = floorDiv(x, CHUNK), cy = floorDiv(y, CHUNK), cz = floorDiv(z, CHUNK);
    const idx = localIndex(x - cx * CHUNK, y - cy * CHUNK, z - cz * CHUNK);
    if (occ <= 0) {
      const c = this._getChunk(cx, cy, cz, false);
      if (!c) return;
      if (c.occ[idx] > 0) {
        c.occ[idx] = 0;
        c.count--;
        if (c.count <= 0) this.chunks.delete(chunkKey(cx, cy, cz));
        this._growEdit(x, y, z);                                     


        this._version++;
      }
      return;
    }
    const c = this._getChunk(cx, cy, cz, true);
    const m8 = mat & 0xff;


    if (c.occ[idx] === occ && c.mat[idx] === m8) return;
    if (c.occ[idx] === 0) c.count++;
    c.occ[idx] = occ;
    c.mat[idx] = m8;
    this._growBounds(x, y, z);
    this._growEdit(x, y, z);
    this._version++;
  }

  paint(x, y, z, mat) {
    const cx = floorDiv(x, CHUNK), cy = floorDiv(y, CHUNK), cz = floorDiv(z, CHUNK);
    const c = this._getChunk(cx, cy, cz, false);
    if (!c) return false;
    const idx = localIndex(x - cx * CHUNK, y - cy * CHUNK, z - cz * CHUNK);
    if (c.occ[idx] === 0) return false;
    const m8 = mat & 0xff;


    if (c.mat[idx] === m8) return true;
    c.mat[idx] = m8;
    this._growEdit(x, y, z);
    this._version++;
    return true;
  }

  getBounds() {
    if (!this._min) return null;
    return { min: this._min.slice(), max: this._max.slice() };
  }
  getSizeStuds() {
    if (!this._min) return { x: 0, y: 0, z: 0 };
    return {
      x: (this._max[0] - this._min[0] + 1) * VOXEL_SIZE,
      y: (this._max[1] - this._min[1] + 1) * VOXEL_SIZE,
      z: (this._max[2] - this._min[2] + 1) * VOXEL_SIZE,
    };
  }
  clear() { this.chunks.clear(); this._min = null; this._max = null; this._editAll = true; this._version++; }


  snapshotRegion(x0, y0, z0, x1, y1, z1) {
    const w = x1 - x0 + 1, h = y1 - y0 + 1, d = z1 - z0 + 1;
    const mat = new Uint8Array(w * h * d);
    const occ = new Uint8Array(w * h * d);
    let i = 0;
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++, i++) {
          mat[i] = this.getMat(x, y, z);
          occ[i] = Math.round(this.getOcc(x, y, z) * 255);
        }
    return { x0, y0, z0, x1, y1, z1, w, h, d, mat, occ };
  }
  restoreRegion(snap) {
    if (!snap) return;
    let i = 0;
    for (let z = snap.z0; z <= snap.z1; z++)
      for (let y = snap.y0; y <= snap.y1; y++)
        for (let x = snap.x0; x <= snap.x1; x++, i++)
          this.set(x, y, z, snap.mat[i], snap.occ[i] / 255);
  }


  voxelsPerChunk() { return CHUNK_VOLUME; }

  getChunkEntries() {
    const out = [];
    for (const [key, c] of this.chunks) out.push({ key, mat: c.mat, occ: c.occ, count: c.count });
    return out;
  }


  setChunkRaw(cx, cy, cz, mat, occ) {
    if (!(mat instanceof Uint8Array) || !(occ instanceof Uint8Array)) return;
    if (mat.length !== CHUNK_VOLUME || occ.length !== CHUNK_VOLUME) return;
    this._editAll = true;                                                  
    let count = 0;
    for (let i = 0; i < CHUNK_VOLUME; i++) if (occ[i] > 0) count++;
    if (count === 0) { this.chunks.delete(chunkKey(cx, cy, cz)); this._version++; return; }
    this.chunks.set(chunkKey(cx, cy, cz), { mat: mat.slice(), occ: occ.slice(), count });
    for (let i = 0; i < CHUNK_VOLUME; i++) {
      if (occ[i] === 0) continue;
      const lx = i % CHUNK;
      const ly = Math.floor(i / CHUNK) % CHUNK;
      const lz = Math.floor(i / (CHUNK * CHUNK));
      this._growBounds(cx * CHUNK + lx, cy * CHUNK + ly, cz * CHUNK + lz);
    }
    this._version++;
  }


  importChunksBulk(chunks) {
    const result = { chunks: 0, voxels: 0 };
    if (!Array.isArray(chunks) || chunks.length === 0) return result;
    this._editAll = true;                                                    
    const limit = chunks.length > IMPORT_BULK_MAX_CHUNKS ? IMPORT_BULK_MAX_CHUNKS : chunks.length;
    let changed = false;
    let min = this._min, max = this._max;
    for (let n = 0; n < limit; n++) {
      const ch = chunks[n];
      if (!ch) continue;
      const cx = ch.cx, cy = ch.cy, cz = ch.cz;
      if (!Number.isInteger(cx) || !Number.isInteger(cy) || !Number.isInteger(cz)) continue;
      const mat = ch.mat, occ = ch.occ;
      if (!(mat instanceof Uint8Array) || !(occ instanceof Uint8Array)) continue;
      if (mat.length !== CHUNK_VOLUME || occ.length !== CHUNK_VOLUME) continue;


      let count = 0;
      let lx0 = CHUNK, ly0 = CHUNK, lz0 = CHUNK, lx1 = -1, ly1 = -1, lz1 = -1;
      for (let i = 0; i < CHUNK_VOLUME; i++) {
        if (occ[i] === 0) continue;
        count++;
        const lx = i & 15, ly = (i >> 4) & 15, lz = i >> 8;
        if (lx < lx0) lx0 = lx;
        if (lx > lx1) lx1 = lx;
        if (ly < ly0) ly0 = ly;
        if (ly > ly1) ly1 = ly;
        if (lz < lz0) lz0 = lz;
        if (lz > lz1) lz1 = lz;
      }
      const key = chunkKey(cx, cy, cz);
      if (count === 0) {
        if (this.chunks.delete(key)) changed = true;                                      
        continue;
      }
      this.chunks.set(key, { mat, occ, count });                    
      const x0 = cx * CHUNK + lx0, y0 = cy * CHUNK + ly0, z0 = cz * CHUNK + lz0;
      const x1 = cx * CHUNK + lx1, y1 = cy * CHUNK + ly1, z1 = cz * CHUNK + lz1;
      if (!min) { min = [x0, y0, z0]; max = [x1, y1, z1]; }
      else {
        if (x0 < min[0]) min[0] = x0;
        if (y0 < min[1]) min[1] = y0;
        if (z0 < min[2]) min[2] = z0;
        if (x1 > max[0]) max[0] = x1;
        if (y1 > max[1]) max[1] = y1;
        if (z1 > max[2]) max[2] = z1;
      }
      result.chunks++;
      result.voxels += count;
      changed = true;
    }
    this._min = min;
    this._max = max;
    if (changed) this._version++;                                       
    return result;
  }


  exportAll() {
    const chunks = [];
    for (const [k, c] of this.chunks)
      chunks.push([k, c.mat.slice(), c.occ.slice(), c.count]);
    return {
      chunks,
      min: this._min ? this._min.slice() : null,
      max: this._max ? this._max.slice() : null,
    };
  }
  importAll(snap) {
    this._editAll = true;                                                    
    this.chunks.clear();
    if (snap && snap.chunks)
      for (const [k, mat, occ, count] of snap.chunks)
        this.chunks.set(k, { mat: mat.slice(), occ: occ.slice(), count });
    this._min = snap && snap.min ? snap.min.slice() : null;
    this._max = snap && snap.max ? snap.max.slice() : null;
    this._version++;
  }

  worldToVoxel(wx, wy, wz) {
    return [floorDiv(wx, VOXEL_SIZE), floorDiv(wy, VOXEL_SIZE), floorDiv(wz, VOXEL_SIZE)];
  }
  voxelCenterWorld(x, y, z) {
    return [(x + 0.5) * VOXEL_SIZE, (y + 0.5) * VOXEL_SIZE, (z + 0.5) * VOXEL_SIZE];
  }
}
