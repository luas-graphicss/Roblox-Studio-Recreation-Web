export const SKY_W_UP = 0.4;
export const SKY_W_TILT = 0.15;
export const SKY_TILT_DIRS = Object.freeze([
  Object.freeze([1, 0]),
  Object.freeze([-1, 0]),
  Object.freeze([0, 1]),
  Object.freeze([0, -1]),
]);

export const SKY_TILT_SLOPE = 1;
export const SKY_TILT_STEPS = 12;

export const SKY_BLOCK_TRANSMISSION = 0.15;


export const IGN_FRAME_STEP = 0.618033988749895;


export const SKY_W_LAT = 0.1;                                                
export const SKY_LAT_DIRS = Object.freeze([
  Object.freeze([1, 0]),
  Object.freeze([-1, 0]),
  Object.freeze([0, 1]),
  Object.freeze([0, -1]),
  Object.freeze([1, 1]),
  Object.freeze([-1, 1]),
  Object.freeze([1, -1]),
  Object.freeze([-1, -1]),
]);
export const SKY_LAT_STEPS = 8;                                                     

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function clamp01(v, d) {
  const n = num(v, d);
  return n < 0 ? 0 : n > 1 ? 1 : n;
}


export function buildColumnTops(grid) {
  const { dim, occ } = grid;
  const tops = new Int16Array(dim * dim).fill(-1);
  for (let z = 0; z < dim; z++) {
    for (let x = 0; x < dim; x++) {
      for (let y = dim - 1; y >= 0; y--) {
        if (occ[x + dim * (y + dim * z)]) {
          tops[x + dim * z] = y;
          break;
        }
      }
    }
  }
  return tops;
}


function lateralSkyOpen(grid, tops, x, y, z) {
  const { dim, occ } = grid;
  let sum = 0;
  for (let d = 0; d < SKY_LAT_DIRS.length; d++) {
    const dx = SKY_LAT_DIRS[d][0];
    const dz = SKY_LAT_DIRS[d][1];
    const diag = dx !== 0 && dz !== 0;
    let open = 0;
    for (let k = 1; k <= SKY_LAT_STEPS; k++) {
      const cx = x + dx * k;
      const cz = z + dz * k;
      if (cx < 0 || cz < 0 || cx >= dim || cz >= dim) {
        open = 1;                       
        break;
      }
      if (occ[cx + dim * (y + dim * cz)]) break;                             
      if (diag) {
        const px = x + dx * (k - 1);
        const pz = z + dz * (k - 1);
        if (occ[cx + dim * (y + dim * pz)] && occ[px + dim * (y + dim * cz)]) break;
      }
      if (tops[cx + dim * cz] <= y) {
        open = 1;                                                 
        break;
      }
    }
    sum += SKY_W_LAT * open;
  }
  return sum;
}


export function skyVisCell(grid, tops, x, y, z, hfSample, lateralRays) {
  const { dim, occ } = grid;

  let tv = 1;
  for (let yy = y + 1; yy < dim; yy++) {
    if (occ[x + dim * (yy + dim * z)]) {
      tv *= SKY_BLOCK_TRANSMISSION;
      if (tv < 0.004) {
        tv = 0;
        break;
      }
    }
  }
  let v = SKY_W_UP * tv;


  if (typeof hfSample === "function") {
    const cell = grid.cell;
    const org = grid.origin;
    for (let d = 0; d < SKY_TILT_DIRS.length; d++) {
      const dx = SKY_TILT_DIRS[d][0];
      const dz = SKY_TILT_DIRS[d][1];
      let open = 1;
      for (let k = 1; k <= SKY_TILT_STEPS; k++) {
        const wx = org[0] + (x + dx * k + 0.5) * cell;
        const wy = org[1] + (y + k * SKY_TILT_SLOPE + 0.5) * cell;
        const wz = org[2] + (z + dz * k + 0.5) * cell;
        if (hfSample(wx, wz) > wy) {
          open = 0;
          break;
        }
      }
      v += SKY_W_TILT * open;
    }


    if (lateralRays) v += lateralSkyOpen(grid, tops, x, y, z);
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  for (let d = 0; d < SKY_TILT_DIRS.length; d++) {
    const dx = SKY_TILT_DIRS[d][0];
    const dz = SKY_TILT_DIRS[d][1];
    let open = 1;
    for (let k = 1; k <= SKY_TILT_STEPS; k++) {
      const cx = x + dx * k;
      const cz = z + dz * k;
      if (cx < 0 || cz < 0 || cx >= dim || cz >= dim) break;              
      const h = tops[cx + dim * cz];
      if (h >= 0 && h > y + k * SKY_TILT_SLOPE) {
        open = 0;
        break;
      }
    }
    v += SKY_W_TILT * open;
  }


  if (lateralRays) v += lateralSkyOpen(grid, tops, x, y, z);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}


export function computeSkyVis(grid, tops, out, from = 0, to = Infinity, hfSample, lateralRays) {
  const { dim, n, occ } = grid;
  const dd = dim * dim;
  const end = Math.min(n, to);
  for (let i = Math.max(0, from); i < end; i++) {
    if (occ[i]) {
      out[i] = 0;
      continue;
    }
    const iz = (i / dd) | 0;
    const iy = ((i / dim) | 0) % dim;
    const ix = i % dim;
    out[i] = skyVisCell(grid, tops, ix, iy, iz, hfSample, lateralRays);
  }
  return end;
}


export function bakeSkyVisAlpha(grid, skyVis, out, from = 0, to = Infinity) {
  const { dim, n, occ } = grid;
  const dd = dim * dim;

  const end = Math.min(n, to);
  for (let i = Math.max(0, from); i < end; i++) {
    let v;
    if (occ[i]) {
      const iz = (i / dd) | 0;
      const iy = ((i / dim) | 0) % dim;
      const ix = i % dim;
      let m = Infinity;
      if (ix > 0 && !occ[i - 1] && skyVis[i - 1] < m) m = skyVis[i - 1];
      if (ix < dim - 1 && !occ[i + 1] && skyVis[i + 1] < m) m = skyVis[i + 1];
      if (iy > 0 && !occ[i - dim] && skyVis[i - dim] < m) m = skyVis[i - dim];
      if (iy < dim - 1 && !occ[i + dim] && skyVis[i + dim] < m) m = skyVis[i + dim];
      if (iz > 0 && !occ[i - dd] && skyVis[i - dd] < m) m = skyVis[i - dd];
      if (iz < dim - 1 && !occ[i + dd] && skyVis[i + dd] < m) m = skyVis[i + dd];
      v = Number.isFinite(m) ? m : 0;
    } else {
      v = skyVis[i];
    }
    out[i * 4 + 3] = Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 255);
  }
  return out;
}


export function sanitizeSkyBentSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {

    skyAmount: clamp01(src.skyAmount, 0.85),

    bentStrength: clamp01(src.bentStrength, 0.7),
  };
}


export function skyMixJs(skyVis, amount) {
  const s = clamp01(skyVis, 1);
  const a = clamp01(amount, 0);
  return 1 - a * (1 - s);
}


export function bentAoJs(bentDotUp, normalDotUp, hemiFrac, strength) {
  const bd = Math.min(Math.max(num(bentDotUp, 1), -1), 1);
  const nd = Math.min(Math.max(num(normalDotUp, 1), -1), 1);
  const skyB = 0.5 + 0.5 * bd;
  const skyN = Math.max(0.5 + 0.5 * nd, 0.05);
  const ratio = Math.min(Math.max(skyB / skyN, 0), 1);
  const k = clamp01(hemiFrac, 0) * clamp01(strength, 0);
  return 1 - k * (1 - ratio);
}


export function frameJitter(frame) {
  const f = Math.max(0, Math.floor(num(frame, 0)));
  const j = f * IGN_FRAME_STEP;
  return j - Math.floor(j);
}
