export const ENV_FACE_SIZE = 16;


export const ENV_FACE_ORDER = ["px", "nx", "py", "ny", "pz", "nz"];

function fin(v, d) {
  return Number.isFinite(v) ? v : d;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function col(c, d) {
  if (!c || typeof c !== "object") return [d, d, d];
  return [clamp01(fin(c.r, d)), clamp01(fin(c.g, d)), clamp01(fin(c.b, d))];
}


export function envSkySignature(st) {
  const s = st || {};
  const t = col(s.skyTop, 0.5);
  const h = col(s.skyHorizon, 0.7);
  const a = clamp01(fin(s.ambientFactor, 1));
  const q = (v) => Math.round(v * 32);
  return q(t[0]) + "," + q(t[1]) + "," + q(t[2]) + "," + q(h[0]) + "," + q(h[1]) + "," + q(h[2]) + "," + q(a);
}


export function envColorForDir(y, st) {
  const s = st || {};
  const top = col(s.skyTop, 0.5);
  const hor = col(s.skyHorizon, 0.7);
  const a = clamp01(fin(s.ambientFactor, 1));
  const gnd = [hor[0] * 0.42, hor[1] * 0.4, hor[2] * 0.36];
  let r;
  let g;
  let b;
  if (y >= 0) {
    const t = Math.pow(clamp01(y), 0.6);
    r = hor[0] + (top[0] - hor[0]) * t;
    g = hor[1] + (top[1] - hor[1]) * t;
    b = hor[2] + (top[2] - hor[2]) * t;
  } else {
    const t = Math.pow(clamp01(-y), 0.5);
    r = hor[0] + (gnd[0] - hor[0]) * t;
    g = hor[1] + (gnd[1] - hor[1]) * t;
    b = hor[2] + (gnd[2] - hor[2]) * t;
  }
  const gain = 0.25 + 0.75 * a;
  return [clamp01(r * gain), clamp01(g * gain), clamp01(b * gain)];
}


export function envDirForTexel(face, u, v) {
  const a = 2 * u - 1;
  const b = 2 * v - 1;
  switch (face) {
    case "px": return [1, -b, -a];
    case "nx": return [-1, -b, a];
    case "py": return [a, 1, b];
    case "ny": return [a, -1, -b];
    case "pz": return [a, -b, 1];
    case "nz": return [-a, -b, -1];
    default: return [0, 1, 0];
  }
}


export function fillEnvFace(data, face, size, st) {
  const n = Math.max(1, size | 0);
  for (let py = 0; py < n; py++) {
    for (let px = 0; px < n; px++) {
      const d = envDirForTexel(face, (px + 0.5) / n, (py + 0.5) / n);
      const len = Math.hypot(d[0], d[1], d[2]) || 1;
      const c = envColorForDir(d[1] / len, st);
      const o = (py * n + px) * 4;
      data[o] = Math.round(c[0] * 255);
      data[o + 1] = Math.round(c[1] * 255);
      data[o + 2] = Math.round(c[2] * 255);
      data[o + 3] = 255;
    }
  }
  return data;
}
