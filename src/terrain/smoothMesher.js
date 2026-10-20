const EPS = 1e-6;


const MIN_KEEP = 0.55;


const FULL_KEEP = 0.75;
const FULL_OCC = 0.999;                                                         

const RELAX_MAX_VERTICES = 400000;


const cube_edges = new Int32Array(24);
const edge_table = new Int32Array(256);
(function init() {
  let k = 0;
  for (let i = 0; i < 8; ++i) {
    for (let j = 1; j <= 4; j <<= 1) {
      const p = i ^ j;
      if (i <= p) { cube_edges[k++] = i; cube_edges[k++] = p; }
    }
  }
  for (let i = 0; i < 256; ++i) {
    let em = 0;
    for (let j = 0; j < 24; j += 2) {
      const a = !!(i & (1 << cube_edges[j]));
      const b = !!(i & (1 << cube_edges[j + 1]));
      em |= a !== b ? (1 << (j >> 1)) : 0;
    }
    edge_table[i] = em;
  }
})();


export function blurOccupancy(raw, dims) {
  const nx = dims[0], ny = dims[1], nz = dims[2];
  const n = nx * ny * nz;
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  const id = (x, y, z) => x + nx * (y + ny * z);

  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const x0 = x > 0 ? x - 1 : x, x1 = x < nx - 1 ? x + 1 : x;
        a[id(x, y, z)] = (raw[id(x0, y, z)] + 2 * raw[id(x, y, z)] + raw[id(x1, y, z)]) * 0.25;
      }

  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++) {
      const y0 = y > 0 ? y - 1 : y, y1 = y < ny - 1 ? y + 1 : y;
      for (let x = 0; x < nx; x++)
        b[id(x, y, z)] = (a[id(x, y0, z)] + 2 * a[id(x, y, z)] + a[id(x, y1, z)]) * 0.25;
    }

  for (let z = 0; z < nz; z++) {
    const z0 = z > 0 ? z - 1 : z, z1 = z < nz - 1 ? z + 1 : z;
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++)
        a[id(x, y, z)] = (b[id(x, y, z0)] + 2 * b[id(x, y, z)] + b[id(x, y, z1)]) * 0.25;
  }
  return a;
}


export function fieldFromOccupancy(raw, dims) {
  const blur = blurOccupancy(raw, dims);
  for (let i = 0; i < blur.length; i++) {
    const keep = raw[i] >= FULL_OCC ? FULL_KEEP : raw[i] * MIN_KEEP;
    const dens = blur[i] > keep ? blur[i] : keep;
    blur[i] = 0.5 - dens;
  }
  return blur;
}


function sampleField(field, dims, x, y, z) {
  const nx = dims[0], ny = dims[1], nz = dims[2];
  x = x < 0 ? 0 : x > nx - 1 ? nx - 1 : x;
  y = y < 0 ? 0 : y > ny - 1 ? ny - 1 : y;
  z = z < 0 ? 0 : z > nz - 1 ? nz - 1 : z;
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const x1 = x0 + 1 < nx ? x0 + 1 : x0;
  const y1 = y0 + 1 < ny ? y0 + 1 : y0;
  const z1 = z0 + 1 < nz ? z0 + 1 : z0;
  const fx = x - x0, fy = y - y0, fz = z - z0;
  const id = (X, Y, Z) => X + nx * (Y + ny * Z);
  const c00 = field[id(x0, y0, z0)] * (1 - fx) + field[id(x1, y0, z0)] * fx;
  const c10 = field[id(x0, y1, z0)] * (1 - fx) + field[id(x1, y1, z0)] * fx;
  const c01 = field[id(x0, y0, z1)] * (1 - fx) + field[id(x1, y0, z1)] * fx;
  const c11 = field[id(x0, y1, z1)] * (1 - fx) + field[id(x1, y1, z1)] * fx;
  const c0 = c00 * (1 - fy) + c10 * fy;
  const c1 = c01 * (1 - fy) + c11 * fy;
  return c0 * (1 - fz) + c1 * fz;
}


export function meshSmoothField(field, dims) {
  const vertices = [];
  const faces = [];
  const n_ptr = new Int32Array(3);
  const R = new Int32Array([1, dims[0] + 1, (dims[0] + 1) * (dims[1] + 1)]);
  const grid = new Float32Array(8);
  let buf_no = 1;
  const buffer = new Int32Array(R[2] * 2);
  let n = 0;

  for (n_ptr[2] = 0; n_ptr[2] < dims[2] - 1; ++n_ptr[2], n += dims[0], buf_no ^= 1, R[2] = -R[2]) {
    let m = 1 + (dims[0] + 1) * (1 + buf_no * (dims[1] + 1));
    for (n_ptr[1] = 0; n_ptr[1] < dims[1] - 1; ++n_ptr[1], ++n, m += 2)
    for (n_ptr[0] = 0; n_ptr[0] < dims[0] - 1; ++n_ptr[0], ++n, ++m) {
      let mask = 0, g = 0, idx = n;
      for (let k = 0; k < 2; ++k, idx += dims[0] * (dims[1] - 2))
      for (let j = 0; j < 2; ++j, idx += dims[0] - 2)
      for (let i = 0; i < 2; ++i, ++g, ++idx) {
        const p = field[idx];
        grid[g] = p;
        mask |= (p < 0) ? (1 << g) : 0;
      }
      if (mask === 0 || mask === 0xff) continue;
      const edge_mask = edge_table[mask];
      const v = [0.0, 0.0, 0.0];
      let e_count = 0;
      for (let i = 0; i < 12; ++i) {
        if (!(edge_mask & (1 << i))) continue;
        ++e_count;
        const e0 = cube_edges[i << 1];
        const e1 = cube_edges[(i << 1) + 1];
        const g0 = grid[e0];
        const g1 = grid[e1];
        let t = g0 - g1;
        if (Math.abs(t) > EPS) t = g0 / t; else continue;
        for (let j = 0, kk = 1; j < 3; ++j, kk <<= 1) {
          const a = e0 & kk;
          const b = e1 & kk;
          if (a !== b) v[j] += a ? 1.0 - t : t;
          else v[j] += a ? 1.0 : 0.0;
        }
      }
      const s = 1.0 / e_count;
      for (let i = 0; i < 3; ++i) v[i] = n_ptr[i] + s * v[i];
      buffer[m] = vertices.length;
      vertices.push(v);
      for (let i = 0; i < 3; ++i) {
        if (!(edge_mask & (1 << i))) continue;
        const iu = (i + 1) % 3;
        const iv = (i + 2) % 3;
        if (n_ptr[iu] === 0 || n_ptr[iv] === 0) continue;
        const du = R[iu];
        const dv = R[iv];


        if (mask & 1) {
          faces.push([buffer[m], buffer[m - du], buffer[m - du - dv]]);
          faces.push([buffer[m], buffer[m - du - dv], buffer[m - dv]]);
        } else {
          faces.push([buffer[m], buffer[m - dv], buffer[m - du - dv]]);
          faces.push([buffer[m], buffer[m - du - dv], buffer[m - du]]);
        }
      }
    }
  }

  const vcount = vertices.length;
  const positions = new Float32Array(vcount * 3);
  const normals = new Float32Array(vcount * 3);


  const H = 0.6;
  for (let i = 0; i < vcount; i++) {
    const v = vertices[i];
    positions[i * 3] = v[0];
    positions[i * 3 + 1] = v[1];
    positions[i * 3 + 2] = v[2];
    const gx = sampleField(field, dims, v[0] + H, v[1], v[2]) - sampleField(field, dims, v[0] - H, v[1], v[2]);
    const gy = sampleField(field, dims, v[0], v[1] + H, v[2]) - sampleField(field, dims, v[0], v[1] - H, v[2]);
    const gz = sampleField(field, dims, v[0], v[1], v[2] + H) - sampleField(field, dims, v[0], v[1], v[2] - H);
    const len = Math.hypot(gx, gy, gz);
    if (len > EPS) {
      normals[i * 3] = gx / len;
      normals[i * 3 + 1] = gy / len;
      normals[i * 3 + 2] = gz / len;
    } else {
      normals[i * 3 + 1] = 1;                                  
    }
  }
  const indices = new Uint32Array(faces.length * 3);
  for (let i = 0; i < faces.length; i++) {
    indices[i * 3] = faces[i][0];
    indices[i * 3 + 1] = faces[i][1];
    indices[i * 3 + 2] = faces[i][2];
  }
  return { positions, normals, indices };
}


export function relaxPositions(positions, indices, opts = {}) {
  const amount = Number.isFinite(opts.amount) ? Math.max(0, Math.min(1, opts.amount)) : 0.35;
  const maxOffset = Number.isFinite(opts.maxOffset) ? Math.max(0, opts.maxOffset) : 0.45;
  const passes = Number.isFinite(opts.passes) ? Math.max(1, Math.min(4, Math.floor(opts.passes))) : 1;
  const vcount = (positions.length / 3) | 0;
  if (!vcount || vcount > RELAX_MAX_VERTICES) return positions;
  const orig = positions.slice();
  const acc = new Float32Array(positions.length);
  const cnt = new Float32Array(vcount);
  for (let p = 0; p < passes; p++) {
    acc.fill(0);
    cnt.fill(0);
    for (let i = 0; i < indices.length; i += 3) {
      const ia = indices[i], ib = indices[i + 1], ic = indices[i + 2];

      acc[ia * 3] += positions[ib * 3]; acc[ia * 3 + 1] += positions[ib * 3 + 1]; acc[ia * 3 + 2] += positions[ib * 3 + 2]; cnt[ia]++;
      acc[ib * 3] += positions[ia * 3]; acc[ib * 3 + 1] += positions[ia * 3 + 1]; acc[ib * 3 + 2] += positions[ia * 3 + 2]; cnt[ib]++;
      acc[ib * 3] += positions[ic * 3]; acc[ib * 3 + 1] += positions[ic * 3 + 1]; acc[ib * 3 + 2] += positions[ic * 3 + 2]; cnt[ib]++;
      acc[ic * 3] += positions[ib * 3]; acc[ic * 3 + 1] += positions[ib * 3 + 1]; acc[ic * 3 + 2] += positions[ib * 3 + 2]; cnt[ic]++;
      acc[ic * 3] += positions[ia * 3]; acc[ic * 3 + 1] += positions[ia * 3 + 1]; acc[ic * 3 + 2] += positions[ia * 3 + 2]; cnt[ic]++;
      acc[ia * 3] += positions[ic * 3]; acc[ia * 3 + 1] += positions[ic * 3 + 1]; acc[ia * 3 + 2] += positions[ic * 3 + 2]; cnt[ia]++;
    }
    for (let v = 0; v < vcount; v++) {
      if (!cnt[v]) continue;
      for (let c = 0; c < 3; c++) {
        const i3 = v * 3 + c;
        const target = acc[i3] / cnt[v];
        let nv = positions[i3] + (target - positions[i3]) * amount;
        const lo = orig[i3] - maxOffset, hi = orig[i3] + maxOffset;
        positions[i3] = nv < lo ? lo : nv > hi ? hi : nv;
      }
    }
  }
  return positions;
}
