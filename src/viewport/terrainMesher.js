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


export function surfaceNets(data, dims) {
  const vertices = [];
  const faces = [];
  const n_ptr = new Int32Array(3);
  const R = new Int32Array([1, dims[0] + 1, (dims[0] + 1) * (dims[1] + 1)]);
  const grid = new Float32Array(8);
  let buf_no = 1;
  let buffer = new Int32Array(R[2] * 2);
  let n = 0;

  for (n_ptr[2] = 0; n_ptr[2] < dims[2] - 1; ++n_ptr[2], n += dims[0], buf_no ^= 1, R[2] = -R[2]) {
    let m = 1 + (dims[0] + 1) * (1 + buf_no * (dims[1] + 1));
    for (n_ptr[1] = 0; n_ptr[1] < dims[1] - 1; ++n_ptr[1], ++n, m += 2)
    for (n_ptr[0] = 0; n_ptr[0] < dims[0] - 1; ++n_ptr[0], ++n, ++m) {
      let mask = 0, g = 0, idx = n;
      for (let k = 0; k < 2; ++k, idx += dims[0] * (dims[1] - 2))
      for (let j = 0; j < 2; ++j, idx += dims[0] - 2)
      for (let i = 0; i < 2; ++i, ++g, ++idx) {
        const p = data[idx];
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
        if (Math.abs(t) > 1e-6) t = g0 / t; else continue;
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
          faces.push([buffer[m], buffer[m - du - dv], buffer[m - du]]);
          faces.push([buffer[m], buffer[m - dv], buffer[m - du - dv]]);
        } else {
          faces.push([buffer[m], buffer[m - du - dv], buffer[m - dv]]);
          faces.push([buffer[m], buffer[m - du], buffer[m - du - dv]]);
        }
      }
    }
  }
  return { vertices, faces };
}
