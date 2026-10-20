const TAU = 6.283185307179586;

export const CLOUDS_DEFAULTS = Object.freeze({
  enabled: true,
  cover: 0.5,
  density: 0.7,
  color: Object.freeze({ r: 1, g: 1, b: 1 }),
});


export const CLOUD_TEX_SIZE = 128;


export const CLOUD_TEX_UNITS = 1;

export const CLOUD_WIND = Object.freeze([0.01, 0.0062]);

export const CLOUD_ANIM_MIN_MS = 33;

export const MOON_PHASE_DEFAULT = 0.5;                                   
export const MOON_EARTHSHINE = 0.045;                                     

export const MILKY_WAY_NORMAL = Object.freeze([0.3602, 0.2201, 0.9065]);


export const CLOUD_TEX_OCTAVES = Object.freeze({
  r: Object.freeze([4, 8, 16, 32]),
  g: Object.freeze([8, 16, 32, 64]),
  b: Object.freeze([8, 32]),
});

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function clamp01(v, d) {
  const n = num(v, d);
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function ss(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}


export function sanitizeCloudsProps(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const c = src.color && typeof src.color === "object" ? src.color : CLOUDS_DEFAULTS.color;
  return {
    enabled: src.enabled !== false,
    cover: clamp01(src.cover, CLOUDS_DEFAULTS.cover),
    density: clamp01(src.density, CLOUDS_DEFAULTS.density),
    color: {
      r: clamp01(c.r, 1),
      g: clamp01(c.g, 1),
      b: clamp01(c.b, 1),
    },
  };
}


export function resolveCloudsGate(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  if (!o.hasInstance) return { on: false, reason: "sem-instancia" };
  if (o.enabled === false) return { on: false, reason: "disabled" };
  if (!(num(o.cover, 0) > 0.001)) return { on: false, reason: "cover-zero" };
  if (!(num(o.density, 0) > 0.001)) return { on: false, reason: "density-zero" };
  if (String(o.tier || "") === "micro") return { on: false, reason: "tier-micro" };
  return { on: true, reason: "on" };
}

export function sanitizeMoonPhase(v) {
  return clamp01(v, MOON_PHASE_DEFAULT);
}


export function latticeRand(ix, iy, seed) {
  let h = (Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263) + Math.imul(seed | 0, 1274126177)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967295;
}

function fade5(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}


export function valueNoiseTile(x, y, period, seed) {
  const p = Math.max(1, period | 0);
  const xf = Math.floor(x);
  const yf = Math.floor(y);
  const tx = x - xf;
  const ty = y - yf;
  const wrap = (v) => ((v % p) + p) % p;
  const x0 = wrap(xf);
  const y0 = wrap(yf);
  const x1 = wrap(xf + 1);
  const y1 = wrap(yf + 1);
  const a = latticeRand(x0, y0, seed);
  const b = latticeRand(x1, y0, seed);
  const c = latticeRand(x0, y1, seed);
  const d = latticeRand(x1, y1, seed);
  const u = fade5(tx);
  const v = fade5(ty);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}


export function fbmTile(u, v, periods, seed) {
  const ps = Array.isArray(periods) && periods.length ? periods : [4, 8];
  let sum = 0;
  let norm = 0;
  let amp = 1;
  for (let i = 0; i < ps.length; i++) {
    const p = Math.max(1, ps[i] | 0);
    sum += valueNoiseTile(u * p, v * p, p, (seed + i * 101) | 0) * amp;
    norm += amp;
    amp *= 0.5;
  }
  return norm > 0 ? sum / norm : 0;
}


export function makeCloudNoiseData(size, seed) {
  const s = Math.max(8, (size | 0) || CLOUD_TEX_SIZE);
  const sd = seed | 0;
  const data = new Uint8Array(s * s * 4);
  let k = 0;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const u = x / s;
      const v = y / s;
      const r = fbmTile(u, v, CLOUD_TEX_OCTAVES.r, sd + 17);
      const g = fbmTile(u, v, CLOUD_TEX_OCTAVES.g, sd + 907);
      const b = fbmTile(u, v, CLOUD_TEX_OCTAVES.b, sd + 5741);
      data[k] = Math.max(0, Math.min(255, Math.round(((r - 0.5) * 1.9 + 0.5) * 255)));
      data[k + 1] = Math.max(0, Math.min(255, Math.round(((g - 0.5) * 1.9 + 0.5) * 255)));
      data[k + 2] = Math.max(0, Math.min(255, Math.round(((b - 0.5) * 1.9 + 0.5) * 255)));
      data[k + 3] = 255;
      k += 4;
    }
  }
  return data;
}


export function cloudFadeJs(h) {
  return ss(0.03, 0.14, h);
}

export function cloudCoverageJs(n, cover, density) {
  const lo = 0.92 - 0.78 * Math.max(0, Math.min(1, cover));
  return ss(lo, lo + 0.16, n) * Math.max(0, Math.min(1, density));
}


export function moonLitFracJs(phase) {
  const p = clamp01(phase, MOON_PHASE_DEFAULT);
  return 0.5 - 0.5 * Math.cos(TAU * p);
}



export function moonShadeJs(lx, ly, phase) {
  const r2 = lx * lx + ly * ly;
  const nz = Math.sqrt(Math.max(1 - Math.min(r2, 1), 0));
  const a = (1 - 2 * clamp01(phase, MOON_PHASE_DEFAULT)) * Math.PI;
  const d = lx * Math.sin(a) + nz * Math.cos(a);
  return Math.max(ss(-0.06, 0.22, d), MOON_EARTHSHINE);
}


export function starMagAmpJs(u) {
  const t = Math.max(0, Math.min(1, u));
  return 0.08 + 0.92 * t * t * t;
}


export function starColorJs(u) {
  const t = Math.max(0, Math.min(1, u));
  const q = t * t;
  return [
    0.72 + (1 - 0.72) * q,
    0.82 + (0.86 - 0.82) * q,
    1 + (0.66 - 1) * q,
  ];
}


export function starLayer2AmpJs(u) {
  const t = Math.max(0, Math.min(1, u));
  return 0.05 + 0.37 * t * t;
}


export function milkyWayJs(x, y, z) {
  const d = x * MILKY_WAY_NORMAL[0] + y * MILKY_WAY_NORMAL[1] + z * MILKY_WAY_NORMAL[2];
  const band = Math.exp(-d * d * 18);
  const lump = 0.75 + 0.25 * Math.sin(x * 7.3 + y * 5.1 + z * 9.7);
  return band * lump;
}


export function buildCloudsGlsl() {
  return `
                                                                        
vec2 rswCloudUv(vec3 dir) {
  float y = max(dir.y, 0.06);
  return dir.xz * (0.62 / y);
}
float rswCloudFade(float h) {
  return smoothstep(0.03, 0.14, h);
}
float rswCloudField(sampler2D tex, vec2 uv, float t, vec2 wind) {
  vec2 w = wind * t;
  float n = texture2D(tex, uv * 0.055 + w).r * 0.55;
  n += texture2D(tex, uv * 0.131 - w * 1.6).g * 0.3;
  n += texture2D(tex, uv * 0.317 + vec2(w.y, -w.x) * 0.7).b * 0.15;
  return n;
}
float rswCloudCoverage(float n, float cover, float density) {
  float lo = 0.92 - 0.78 * clamp(cover, 0.0, 1.0);
  return smoothstep(lo, lo + 0.16, n) * clamp(density, 0.0, 1.0);
}
vec4 rswClouds(sampler2D tex, vec3 dir, vec3 sunDir, vec3 sunColor, vec3 tint, float cover, float density, float t, vec2 wind, float night) {
  vec4 res = vec4(0.0);
  float fade = rswCloudFade(dir.y);
  if (fade < 0.002) { return res; }
  vec2 uv = rswCloudUv(dir);
  float n = rswCloudField(tex, uv, t, wind);
  float a = rswCloudCoverage(n, cover, density) * fade;
  if (a < 0.003) { return res; }
  vec2 toSun = vec2(sunDir.x, sunDir.z) * 0.05;
  float n2 = rswCloudField(tex, uv + toSun, t, wind);
  float shade = clamp(1.0 - (n2 - n) * 2.6, 0.3, 1.0);
  float sunH = clamp(sunDir.y * 1.6 + 0.1, 0.0, 1.0);
  float dayW = clamp(1.0 - night, 0.0, 1.0);
  vec3 base = tint * mix(0.16, 0.98, sunH);
  base = mix(tint * vec3(0.045, 0.055, 0.095), base, dayW);
  float sunFace = pow(clamp(dot(dir, sunDir), 0.0, 1.0), 3.0);
  float golden = (1.0 - sunH) * dayW;
  vec3 col = base * mix(0.55, 1.0, shade);
  col += sunColor * shade * (0.22 + 0.5 * sunFace) * dayW * (0.6 + 0.9 * golden);
  float silver = pow(clamp(dot(dir, sunDir), 0.0, 1.0), 24.0) * (1.0 - a * 0.75);
  col += sunColor * silver * 0.8 * dayW;
  col += vec3(0.8, 0.85, 1.0) * (night * 0.05 * shade);
  res = vec4(col, a);
  return res;
}
`;
}

export function buildNightSkyGlsl() {
  return `
                                                                 
float rswMoonLitFrac(float phase) {
  float p = clamp(phase, 0.0, 1.0);
  return 0.5 - 0.5 * cos(6.28318530718 * p);
}
float rswMoonShade(vec2 loc, float phase) {
  float r2 = dot(loc, loc);
  float nz = sqrt(max(1.0 - min(r2, 1.0), 0.0));
  float a = (1.0 - 2.0 * clamp(phase, 0.0, 1.0)) * 3.14159265359;
  float d = loc.x * sin(a) + nz * cos(a);
  return max(smoothstep(-0.06, 0.22, d), 0.045);
}
float rswStarMagAmp(float u) {
  float t = clamp(u, 0.0, 1.0);
  return 0.08 + 0.92 * t * t * t;
}
vec3 rswStarColor(float u) {
  float t = clamp(u, 0.0, 1.0);
  float q = t * t;
  return mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.86, 0.66), q);
}
float rswMilkyWay(vec3 dir) {
  float d = dot(dir, vec3(0.3602, 0.2201, 0.9065));
  float band = exp(-d * d * 18.0);
  float lump = 0.75 + 0.25 * sin(dir.x * 7.3 + dir.y * 5.1 + dir.z * 9.7);
  return band * lump;
}
float rswStarLayer2Amp(float u) {
  float t = clamp(u, 0.0, 1.0);
  return 0.05 + 0.37 * t * t;
}
`;
}
