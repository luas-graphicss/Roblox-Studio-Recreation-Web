const RES_LO = 64;
const RES_HI = 128;

export const PROBE_EXTRA_TEX_UNITS = 0;
export const PROBE_RESOLUTIONS = Object.freeze([RES_LO, RES_HI]);
export const PROBE_CAPTURE_BUDGET_MS = 150;
export const PROBE_FACES = 6;

function num(v, def) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : def;
}

function vec3Of(v, dx, dy, dz) {
  if (Array.isArray(v)) return [num(v[0], dx), num(v[1], dy), num(v[2], dz)];
  if (v && typeof v === "object") return [num(v.x, dx), num(v.y, dy), num(v.z, dz)];
  return [dx, dy, dz];
}


export function sanitizeProbe(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const size = vec3Of(r.size, 16, 16, 16).map((s) => Math.min(2048, Math.max(0.05, Math.abs(s))));
  const resRaw = num(r.resolution, RES_LO);
  return {
    key: r.key === undefined ? null : r.key,
    name: typeof r.name === "string" && r.name ? r.name : "ReflectionProbe",
    enabled: r.enabled !== false,
    shape: r.shape === "Sphere" ? "Sphere" : "Box",
    pos: vec3Of(r.position === undefined ? r.pos : r.position, 0, 0, 0),
    size,
    priority: Math.round(num(r.priority, 0)),

    resolution: resRaw >= (RES_LO + RES_HI) / 2 ? RES_HI : RES_LO,
    blend: Math.max(0, Math.min(64, num(r.blend, 2))),
  };
}


export function probeSignature(p) {
  const q = (x) => Math.round(x * 100) / 100;
  return [
    p.shape, p.resolution, p.enabled ? 1 : 0, p.priority, q(p.blend),
    q(p.pos[0]), q(p.pos[1]), q(p.pos[2]),
    q(p.size[0]), q(p.size[1]), q(p.size[2]),
  ].join("|");
}


export function resolveProbesFlag(raw, ctx) {
  const c = ctx || {};
  if (c.basic || c.patchesDisabled) return false;
  if (raw === true) return true;
  if (raw === false) return false;
  return !!c.realistic && !c.weak;
}


export function probeBudget(opts) {
  const o = opts || {};
  if (o.weak) return o.forced ? 1 : 0;
  const maxTex = num(o.maxTex, 8);
  return maxTex >= 16 ? 4 : 2;
}

function halfOf(p) {
  return [p.size[0] / 2, p.size[1] / 2, p.size[2] / 2];
}


function sphereRadius(p) {
  return p.size[0] / 2;
}

function volumeOf(p) {
  if (p.shape === "Sphere") {
    const r = sphereRadius(p);
    return (4 / 3) * Math.PI * r * r * r;
  }
  return p.size[0] * p.size[1] * p.size[2];
}


export function probeContains(p, pt) {
  const d = [pt[0] - p.pos[0], pt[1] - p.pos[1], pt[2] - p.pos[2]];
  if (p.shape === "Sphere") {
    const r = sphereRadius(p);
    return d[0] * d[0] + d[1] * d[1] + d[2] * d[2] <= r * r + 1e-9;
  }
  const h = halfOf(p);
  return (
    Math.abs(d[0]) <= h[0] + 1e-9 &&
    Math.abs(d[1]) <= h[1] + 1e-9 &&
    Math.abs(d[2]) <= h[2] + 1e-9
  );
}


export function probeBlendWeight(p, pt) {
  const d = [pt[0] - p.pos[0], pt[1] - p.pos[1], pt[2] - p.pos[2]];
  if (p.shape === "Sphere") {
    const r = sphereRadius(p);
    const len = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
    if (len > r) return 0;
    const margin = Math.max(1e-6, Math.min(p.blend, r));
    return Math.max(0, Math.min(1, (r - len) / margin));
  }
  const h = halfOf(p);
  const e0 = h[0] - Math.abs(d[0]);
  const e1 = h[1] - Math.abs(d[1]);
  const e2 = h[2] - Math.abs(d[2]);
  if (e0 < 0 || e1 < 0 || e2 < 0) return 0;
  const edge = Math.min(e0, e1, e2);
  const margin = Math.max(1e-6, Math.min(p.blend, Math.min(h[0], h[1], h[2])));
  return Math.max(0, Math.min(1, edge / margin));
}


export function pickProbeForPoint(probes, pt) {
  let best = null;
  let bestW = 0;
  for (const p of probes || []) {
    if (!p || p.enabled === false) continue;
    const w = probeBlendWeight(p, pt);
    if (w <= 0) continue;
    if (!best) { best = p; bestW = w; continue; }
    if (w > bestW + 1e-9) { best = p; bestW = w; continue; }
    if (Math.abs(w - bestW) <= 1e-9) {
      if (p.priority > best.priority) { best = p; bestW = w; continue; }
      if (p.priority === best.priority && volumeOf(p) < volumeOf(best)) { best = p; bestW = w; }
    }
  }
  return best ? { probe: best, weight: bestW } : null;
}


export function pickTopTwoProbes(probes, pt) {
  const a = pickProbeForPoint(probes, pt);
  if (!a) return null;
  const rest = [];
  for (const p of probes || []) {
    if (!p || p === a.probe) continue;
    if (p.key !== null && p.key !== undefined && p.key === a.probe.key) continue;
    rest.push(p);
  }
  const b = rest.length ? pickProbeForPoint(rest, pt) : null;
  return { a, b };
}


export function selectActiveProbes(probes, pt, budget) {
  const b = Math.max(0, Math.floor(num(budget, 0)));
  if (b === 0) return [];
  const dist2 = (p) => {
    const dx = p.pos[0] - pt[0];
    const dy = p.pos[1] - pt[1];
    const dz = p.pos[2] - pt[2];
    return dx * dx + dy * dy + dz * dz;
  };
  return (probes || [])
    .filter((p) => p && p.enabled !== false)
    .map((p) => ({ p, c: probeContains(p, pt) ? 1 : 0, d: dist2(p) }))
    .sort((a, b2) => (b2.c - a.c) || (b2.p.priority - a.p.priority) || (a.d - b2.d))
    .slice(0, b)
    .map((e) => e.p);
}


export function pickCaptureTarget(records) {
  let firstDirty = null;
  for (const r of records || []) {
    if (!r || r.enabled === false) continue;
    const done = num(r.facesDone, 0);
    if (done > 0 && done < PROBE_FACES) return r.key;
    if (firstDirty === null && r.dirty) firstDirty = r.key;
  }
  return firstDirty;
}


export function boxProjectDir(dir, wp, boxMin, boxMax, probePos) {
  const d = [num(dir[0], 0), num(dir[1], 0), num(dir[2], 0)];
  const len0 = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
  if (len0 > 1e-6) {
    d[0] /= len0; d[1] /= len0; d[2] /= len0;
  } else {
    d[0] = 1; d[1] = 0; d[2] = 0;
  }
  const safe = d.map((x) => (Math.abs(x) > 1e-5 ? x : x >= 0 ? 1e-5 : -1e-5));
  let t = Infinity;
  for (let i = 0; i < 3; i++) {
    const t1 = (boxMax[i] - wp[i]) / safe[i];
    const t2 = (boxMin[i] - wp[i]) / safe[i];
    t = Math.min(t, Math.max(t1, t2));
  }
  t = Math.max(t, 0);
  const hit = [wp[0] + d[0] * t, wp[1] + d[1] * t, wp[2] + d[2] * t];
  const corr = [hit[0] - probePos[0], hit[1] - probePos[1], hit[2] - probePos[2]];
  const cl = Math.sqrt(corr[0] * corr[0] + corr[1] * corr[1] + corr[2] * corr[2]);
  if (cl <= 1e-6) return d;
  return [corr[0] / cl, corr[1] / cl, corr[2] / cl];
}


export function capturePlanMs(opts) {
  const o = opts || {};
  const faces = Math.max(1, Math.round(num(o.faces, PROBE_FACES)));
  return faces * Math.max(0, num(o.perFaceMs, 0)) + Math.max(0, num(o.pmremMs, 0));
}

export function captureFits(totalMs, budgetMs) {
  return num(totalMs, Infinity) <= num(budgetMs, PROBE_CAPTURE_BUDGET_MS);
}


export function probeParallaxGlsl() {
  return [
    "uniform float uRswPrbOn;",
    "uniform float uRswPrbBlend;",
    "uniform vec3 uRswPrbBoxMin;",
    "uniform vec3 uRswPrbBoxMax;",
    "uniform vec3 uRswPrbPos;",


    "vec3",
    "rswPrbReflect(",
    "\tvec3 dir,",
    "\tvec3 wp",
    ") {",
    "\tfloat rswPrbGate = clamp( uRswPrbOn * uRswPrbBlend, 0.0, 1.0 );",
    "\tif ( rswPrbGate <= 0.0 ) { return dir; }",
    "\tvec3 rswPrbD = dir;",
    "\tfloat rswPrbL0 = length( rswPrbD );",
    "\trswPrbD = rswPrbL0 > 1e-6 ? rswPrbD / rswPrbL0 : vec3( 1.0, 0.0, 0.0 );",
    "\tvec3 rswPrbSafe = vec3(",
    "\t\tabs( rswPrbD.x ) > 1e-5 ? rswPrbD.x : ( rswPrbD.x >= 0.0 ? 1e-5 : -1e-5 ),",
    "\t\tabs( rswPrbD.y ) > 1e-5 ? rswPrbD.y : ( rswPrbD.y >= 0.0 ? 1e-5 : -1e-5 ),",
    "\t\tabs( rswPrbD.z ) > 1e-5 ? rswPrbD.z : ( rswPrbD.z >= 0.0 ? 1e-5 : -1e-5 ) );",
    "\tvec3 rswPrbT1 = ( uRswPrbBoxMax - wp ) / rswPrbSafe;",
    "\tvec3 rswPrbT2 = ( uRswPrbBoxMin - wp ) / rswPrbSafe;",
    "\tvec3 rswPrbFar = max( rswPrbT1, rswPrbT2 );",
    "\tfloat rswPrbT = max( min( min( rswPrbFar.x, rswPrbFar.y ), rswPrbFar.z ), 0.0 );",
    "\tvec3 rswPrbHit = wp + rswPrbD * rswPrbT;",
    "\tvec3 rswPrbCorr = rswPrbHit - uRswPrbPos;",
    "\tfloat rswPrbCL = length( rswPrbCorr );",
    "\tvec3 rswPrbDir2 = rswPrbCL > 1e-6 ? rswPrbCorr / rswPrbCL : rswPrbD;",
    "\tvec3 rswPrbMixv = mix( rswPrbD, rswPrbDir2, rswPrbGate );",
    "\tfloat rswPrbML = length( rswPrbMixv );",
    "\treturn rswPrbML > 1e-5 ? rswPrbMixv / rswPrbML : rswPrbDir2;",
    "}",
  ].join("\n");
}
