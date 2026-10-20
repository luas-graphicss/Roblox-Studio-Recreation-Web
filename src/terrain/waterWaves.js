export const WATER_CACHE_KEY = "rswWater91";


export const WATER_PLANAR_CACHE_SUFFIX = "|rswPlanar1";


const RAW_WAVES = [
  { dir: [1, 0.25], len: 26, steep: 0.28, speed: 1.0 },
  { dir: [-0.6, 1], len: 14, steep: 0.22, speed: 1.35 },
  { dir: [0.3, -1], len: 7, steep: 0.16, speed: 1.8 },
];
const TWO_PI = Math.PI * 2;
const steepSum = RAW_WAVES.reduce((s, w) => s + w.steep, 0);

export const WAVE_HORIZONTAL = 0.6;                                          


export const WAVE_HORIZ_MAX_AMP = 3;


export function waveStateFromTerrain(inst, timeSec) {
  if (!inst || typeof inst.getProperty !== "function") return null;
  let size = NaN;
  let speed = NaN;
  try { size = Number(inst.getProperty("WaterWaveSize")); } catch (_) { size = NaN; }
  try { speed = Number(inst.getProperty("WaterWaveSpeed")); } catch (_) { speed = NaN; }
  const size01 = Number.isFinite(size) ? Math.max(0, Math.min(1, size)) : 0;
  const amp = size01 * WAVE_AMP_STUDS;
  if (amp <= 0.001) return null;
  const speedClamped = Number.isFinite(speed) ? Math.max(0, Math.min(100, speed)) : 0;
  const spd = waveSpeedEffective(speedClamped) * WAVE_SPEED_FACTOR;
  const t = (Number.isFinite(timeSec) ? timeSec : 0) * spd;


  return { amp, t, size01, speed01: speedClamped / 100 };
}

export const WATER_WAVES = Object.freeze(
  RAW_WAVES.map((w) => {
    const l = Math.hypot(w.dir[0], w.dir[1]) || 1;
    return Object.freeze({
      dirX: w.dir[0] / l,
      dirZ: w.dir[1] / l,
      k: TWO_PI / w.len,
      weight: w.steep / steepSum,
      speed: w.speed,
    });
  }),
);


const W_N = WATER_WAVES.length;
const W_DIRX = new Float64Array(W_N);
const W_DIRZ = new Float64Array(W_N);
const W_K = new Float64Array(W_N);
const W_SPEED = new Float64Array(W_N);
const W_WEIGHT = new Float64Array(W_N);
const W_WH = new Float64Array(W_N);                            
for (let i = 0; i < W_N; i++) {
  const w = WATER_WAVES[i];
  W_DIRX[i] = w.dirX;
  W_DIRZ[i] = w.dirZ;
  W_K[i] = w.k;
  W_SPEED[i] = w.speed;
  W_WEIGHT[i] = w.weight;
  W_WH[i] = w.weight * WAVE_HORIZONTAL;
}

let dspX = 0;
let dspY = 0;
let dspZ = 0;
function displaceInto(x, z, t) {
  let dx = 0, dy = 0, dz = 0;
  for (let i = 0; i < W_N; i++) {
    const f = W_K[i] * (W_DIRX[i] * x + W_DIRZ[i] * z) - t * W_SPEED[i];
    const c = Math.cos(f) * W_WH[i];
    dy += Math.sin(f) * W_WEIGHT[i];
    dx += W_DIRX[i] * c;
    dz += W_DIRZ[i] * c;
  }
  dspX = dx;
  dspY = dy;
  dspZ = dz;
}


export function gerstnerDisplace(x, z, t) {
  displaceInto(x, z, t);
  return { dx: dspX, dy: dspY, dz: dspZ };
}


export function gerstnerSlope(x, z, t) {
  let sx = 0, sz = 0;
  for (const w of WATER_WAVES) {
    const f = w.k * (w.dirX * x + w.dirZ * z) - t * w.speed;
    const c = Math.cos(f) * w.weight * w.k;
    sx += w.dirX * c;
    sz += w.dirZ * c;
  }
  return { sx, sz };
}


export const WAVE_AMP_STUDS = 5;
export const WAVE_SPEED_FACTOR = 0.12;


export const WAVE_SPEED_SOFT_KNEE = 10;
export const WAVE_SPEED_SOFT_GAIN = 0.25;
export function waveSpeedEffective(speed) {
  const s = Number.isFinite(speed) ? Math.max(0, Math.min(100, speed)) : 0;
  if (s <= WAVE_SPEED_SOFT_KNEE) return s;
  return WAVE_SPEED_SOFT_KNEE + (s - WAVE_SPEED_SOFT_KNEE) * WAVE_SPEED_SOFT_GAIN;
}


export function gerstnerHeight(x, z, t) {
  let dy = 0;
  for (const w of WATER_WAVES) {
    dy += Math.sin(w.k * (w.dirX * x + w.dirZ * z) - t * w.speed) * w.weight;
  }
  return dy;
}


export const GERSTNER_INVERT_PLAIN_MAX = 2;                            
const INVERT_SEED_SCALE = 0.44;                                               
const INVERT_RES_OK = 0.15;                                           


let invH = 0;
let invRes2 = 0;


function invertRest(px, pz, t, ampEff, hAmp, sx, sz, iters, lambda) {
  let rx = px + sx;
  let rz = pz + sz;
  for (let i = 0; i < iters; i++) {
    displaceInto(rx, rz, t);
    rx += lambda * (px - hAmp * dspX - rx);
    rz += lambda * (pz - hAmp * dspZ - rz);
  }
  displaceInto(rx, rz, t);
  const ex = rx + hAmp * dspX - px;
  const ez = rz + hAmp * dspZ - pz;
  invH = ampEff * dspY;
  invRes2 = ex * ex + ez * ez;
}

const INVERT_RES_OK2 = INVERT_RES_OK * INVERT_RES_OK;
const SEED_X = [0, 1, -1, 0, 0];
const SEED_Z = [0, 0, 0, 1, -1];


const HCACHE_N = 16;
const hcX = new Float64Array(HCACHE_N);
const hcZ = new Float64Array(HCACHE_N);
const hcT = new Float64Array(HCACHE_N);
const hcA = new Float64Array(HCACHE_N);
const hcH = new Float64Array(HCACHE_N);
let hcHead = 0;

export function gerstnerSurfaceHeight(x, z, t, ampEff) {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(t)) return 0;
  if (!Number.isFinite(ampEff) || ampEff <= 0) return 0;
  for (let i = 0; i < HCACHE_N; i++) {
    if (hcX[i] === x && hcZ[i] === z && hcT[i] === t && hcA[i] === ampEff) return hcH[i];
  }


  const hAmp = Math.min(ampEff, WAVE_HORIZ_MAX_AMP);
  let out;
  if (ampEff <= GERSTNER_INVERT_PLAIN_MAX) {
    invertRest(x, z, t, ampEff, hAmp, 0, 0, 4, 1);
    out = invH;
  } else {
    const s = INVERT_SEED_SCALE * hAmp;
    let bestH = 0;
    let bestRes2 = Infinity;
    let found = false;
    for (let i = 0; i < SEED_X.length; i++) {
      invertRest(x, z, t, ampEff, hAmp, SEED_X[i] * s, SEED_Z[i] * s, 6, 0.5);
      if (invRes2 < INVERT_RES_OK2) {
        if (!found || invH > bestH) { bestH = invH; found = true; }
      } else if (!found && invRes2 < bestRes2) {
        bestRes2 = invRes2;
        bestH = invH;
      }
    }
    out = bestH;
  }
  hcX[hcHead] = x;
  hcZ[hcHead] = z;
  hcT[hcHead] = t;
  hcA[hcHead] = ampEff;
  hcH[hcHead] = out;
  hcHead = (hcHead + 1) % HCACHE_N;
  return out;
}


export const WATER_FLOW_MAX_SPEED = 8;                                             
export const WATER_FLOW_DEPTH_SCALE = 6;                                                 

let flowDx = 0;
let flowDz = 0;
for (let i = 0; i < W_N; i++) {
  flowDx += W_WEIGHT[i] * W_DIRX[i];
  flowDz += W_WEIGHT[i] * W_DIRZ[i];
}
const flowLen = Math.hypot(flowDx, flowDz) || 1;
export const WATER_FLOW_DIR_X = flowDx / flowLen;
export const WATER_FLOW_DIR_Z = flowDz / flowLen;


export function waterFlowSpeed(waves, depthStuds) {
  if (!waves) return 0;
  const s = Number(waves.size01);
  const v = Number(waves.speed01);
  if (!(s > 0) || !(v > 0)) return 0;
  if (!Number.isFinite(depthStuds)) return 0;
  const s1 = Math.min(1, s);
  const v1 = Math.min(1, v);
  const d = Math.max(0, depthStuds);
  return WATER_FLOW_MAX_SPEED * s1 * s1 * v1 * Math.exp(-d / WATER_FLOW_DEPTH_SCALE);
}


export function waveAttenuation(depth01, upY) {
  const d = Math.min(1, Math.max(0, depth01) * 1.4);
  const u = Math.min(1, Math.max(0, upY));
  return d * u;
}


export function foamFactor(shore, crest, time, phase) {
  const s = Math.min(1, Math.max(0, shore));
  const c = Math.min(1, Math.max(0, crest));
  const pulse = 0.62 + 0.38 * Math.sin(time * 1.3 + phase);
  return Math.min(1, s * pulse + c * c * c * 0.5);
}


export const DEPTH_RANGE = 4;
export const SHORE_RADIUS = 2;

export function computeShoreDepth(solidOccAt, waterOccAt, wx, wy, wz) {
  const cx = Math.floor(wx), cy = Math.floor(wy), cz = Math.floor(wz);
  let col = 0;
  for (let i = 0; i < DEPTH_RANGE; i++) {
    col += Math.max(0, Math.min(1, waterOccAt(cx, cy - 1 - i, cz)));
  }
  const depth = Math.min(1, col / DEPTH_RANGE);
  let best = Infinity;
  for (let dz = -SHORE_RADIUS; dz <= SHORE_RADIUS; dz++) {
    for (let dx = -SHORE_RADIUS; dx <= SHORE_RADIUS; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (solidOccAt(cx + dx, cy + dy, cz + dz) >= 0.5) {
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d < best) best = d;
        }
      }
    }
  }
  const shore = best === Infinity ? 0 : Math.max(0, Math.min(1, 1 - best / (SHORE_RADIUS + 1)));
  return { shore, depth };
}


const f = (v) => {
  const s = String(Math.round(v * 1e6) / 1e6);
  return s.includes(".") || s.includes("e") ? s : s + ".0";
};


export function buildWaterPlanarImports() {


  return null;                                                  
}

export function buildWaterVertexPars() {
  const lines = [
    "attribute float rswShore;",
    "attribute float rswDepth;",
    "uniform float uRswTime;",
    "uniform float uRswWaveAmp;",
    "uniform float uRswWaveSpeed;",
    "varying vec4 vRswWater;",
    "vec3 rswGerstner(const in vec2 p, const in float t) {",
    "\tvec3 d = vec3(0.0);",
  ];
  for (const w of WATER_WAVES) {
    lines.push(
      "\t{",
      `\t\tfloat f = ${f(w.k)} * dot(vec2(${f(w.dirX)}, ${f(w.dirZ)}), p) - t * ${f(w.speed)};`,
      `\t\tfloat c = cos(f) * ${f(w.weight * WAVE_HORIZONTAL)};`,
      `\t\td += vec3(${f(w.dirX)} * c, sin(f) * ${f(w.weight)}, ${f(w.dirZ)} * c);`,
      "\t}",
    );
  }
  lines.push("\treturn d;", "}");
  lines.push("vec2 rswGerstnerSlope(const in vec2 p, const in float t) {", "\tvec2 s = vec2(0.0);");
  for (const w of WATER_WAVES) {
    lines.push(
      "\t{",
      `\t\tfloat f = ${f(w.k)} * dot(vec2(${f(w.dirX)}, ${f(w.dirZ)}), p) - t * ${f(w.speed)};`,
      `\t\tfloat c = cos(f) * ${f(w.weight * w.k)};`,
      `\t\ts += vec2(${f(w.dirX)} * c, ${f(w.dirZ)} * c);`,
      "\t}",
    );
  }
  lines.push("\treturn s;", "}");
  return lines.join("\n");
}


export function buildWaterNormalMain() {
  return [
    "{",
    "\tfloat rswT = uRswTime * uRswWaveSpeed;",
    "\tvec2 rswS = rswGerstnerSlope(position.xz, rswT) * uRswWaveAmp;",
    "\tfloat rswA = clamp(rswDepth * 1.4, 0.0, 1.0) * clamp(objectNormal.y, 0.0, 1.0);",
    "\tobjectNormal = normalize(mix(objectNormal, normalize(vec3(-rswS.x, 1.0, -rswS.y)), rswA));",
    "}",
  ].join("\n");
}


export function buildWaterVertexMain() {
  return [
    "{",
    "\tfloat rswT = uRswTime * uRswWaveSpeed;",
    "\tfloat rswA = clamp(rswDepth * 1.4, 0.0, 1.0) * clamp(normal.y, 0.0, 1.0);",
    "\tvec3 rswD = rswGerstner(transformed.xz, rswT);",
    "\tvRswWater = vec4(rswShore, rswDepth, clamp(rswD.y * 0.5 + 0.5, 0.0, 1.0), dot(transformed.xz, vec2(0.35, 0.27)));",


    "\tfloat rswAE = uRswWaveAmp * rswA;",
    `\tfloat rswHA = min(rswAE, ${f(WAVE_HORIZ_MAX_AMP)});`,
    "\ttransformed += vec3(rswD.x * rswHA, rswD.y * rswAE, rswD.z * rswHA);",
    "}",
  ].join("\n");
}

export function buildWaterFragPars() {
  return [
    "uniform float uRswTime;",
    "uniform sampler2D uRswGrab;",
    "uniform vec2 uRswGrabSize;",
    "uniform float uRswGrabOn;",
    "varying vec4 vRswWater;",
    "vec3 rswRefracted = vec3(0.0);",
  ].join("\n");
}


export function buildWaterFragMain() {
  return [
    "{",
    "\tfloat rswDepthF = clamp(vRswWater.y, 0.0, 1.0);",
    "\tfloat rswCrest = clamp(vRswWater.z * 2.0 - 1.0, 0.0, 1.0);",
    "\tfloat rswFoam = clamp(vRswWater.x * (0.62 + 0.38 * sin(uRswTime * 1.3 + vRswWater.w)) + rswCrest * rswCrest * rswCrest * 0.5, 0.0, 1.0);",
    "\tif (uRswGrabOn > 0.5) {",
    "\t\tvec3 rswN = normalize(vNormal);",
    "\t\tvec2 rswUv = gl_FragCoord.xy / uRswGrabSize;",
    "\t\trswUv += rswN.xy * (0.012 + 0.05 * rswDepthF);",
    "\t\trswUv = clamp(rswUv, vec2(0.002), vec2(0.998));",
    "\t\tvec4 rswGrabS = texture2D(uRswGrab, rswUv);",
    "\t\tvec3 rswDeepTint = diffuseColor.rgb * vec3(0.55, 0.78, 0.92);",
    "\t\tvec3 rswGrabCol = mix(rswDeepTint, rswGrabS.rgb, clamp(rswGrabS.a, 0.0, 1.0));",
    "\t\tfloat rswAbs = clamp(rswDepthF * mix(0.45, 1.0, diffuseColor.a), 0.0, 0.9);",
    "\t\trswRefracted = rswGrabCol * mix(vec3(1.0), rswDeepTint * 1.6, rswAbs) * (1.0 - 0.5 * rswAbs);",
    "\t\trswRefracted *= 1.0 - rswFoam * 0.9;",


    "\t\tfloat rswOpaq = smoothstep(0.05, 0.35, diffuseColor.a);",
    "\t\trswRefracted = mix(rswGrabCol, rswRefracted, rswOpaq);",
    "\t\tdiffuseColor.rgb *= (0.22 + 0.3 * rswAbs) * rswOpaq;",
    "\t\tdiffuseColor.a = 1.0;",
    "\t} else {",
    "\t\tdiffuseColor.a *= mix(0.42, 1.0, rswDepthF);",
    "\t\tdiffuseColor.rgb *= mix(vec3(1.0), vec3(0.55, 0.78, 0.92), rswDepthF * 0.65);",
    "\t}",
    "\tdiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.97, 1.0), rswFoam * 0.85);",
    "\tdiffuseColor.a = mix(diffuseColor.a, 1.0, rswFoam * 0.55);",
    "}",
  ].join("\n");
}


export function buildWaterEmissiveMain() {
  return [
    "{",
    "\ttotalEmissiveRadiance += rswRefracted;",
    "}",
  ].join("\n");
}
