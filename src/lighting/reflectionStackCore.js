export const REFL_SOURCE_IDS = Object.freeze({ sky: 0, probe: 1, ssr: 2, planar: 3 });
export const REFL_SOURCE_NAMES = Object.freeze(["sky", "probe", "ssr", "planar"]);

export const REFL_PRIORITY = Object.freeze(["planar", "ssr", "probe", "sky"]);
export const REFL_PROBE_FEATHER_DEFAULT = 0.15;                            
export const REFL_FEATHER_MIN = 0.01;
export const REFL_FEATHER_MAX = 0.5;


export function reflClamp01(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}


export function smoothstep01(t) {
  const x = reflClamp01(t);
  return x * x * (3 - 2 * x);
}

export function sanitizeFeather(feather) {
  const f = typeof feather === "number" && Number.isFinite(feather)
    ? feather
    : REFL_PROBE_FEATHER_DEFAULT;
  return f < REFL_FEATHER_MIN ? REFL_FEATHER_MIN : f > REFL_FEATHER_MAX ? REFL_FEATHER_MAX : f;
}


export function probeConfidenceFromDistance(distNorm, feather) {
  const f = sanitizeFeather(feather);
  const d = typeof distNorm === "number" && Number.isFinite(distNorm) ? distNorm : 2;
  if (d >= 1) return 0;
  if (d <= 1 - f) return 1;
  return smoothstep01((1 - d) / f);
}


export function reflStackWeightsJs(planarA, ssrA, probeA, stackOn, out) {
  const on = reflClamp01(stackOn);
  const w = out && typeof out === "object" ? out : {};
  const wPlanar = reflClamp01(planarA) * on;
  let rem = 1 - wPlanar;
  const wSsr = reflClamp01(ssrA) * rem * on;
  rem = rem - wSsr;
  const wProbe = reflClamp01(probeA) * rem * on;
  const wSky = 1 - wPlanar - wSsr - wProbe;
  w.planar = wPlanar;
  w.ssr = wSsr;
  w.probe = wProbe;
  w.sky = wSky;
  return w;
}

const COMPOSE_SCRATCH = {};



export function reflStackComposeJs(planarC, planarA, ssrC, ssrA, probeC, probeA, skyC, stackOn) {
  const w = reflStackWeightsJs(planarA, ssrA, probeA, stackOn, COMPOSE_SCRATCH);
  const c = (v, i) => {
    const x = Array.isArray(v) ? v[i] : 0;
    return typeof x === "number" && Number.isFinite(x) ? x : 0;
  };
  const outC = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    outC[i] = c(planarC, i) * w.planar + c(ssrC, i) * w.ssr + c(probeC, i) * w.probe + c(skyC, i) * w.sky;
  }
  return outC;
}


export function resolveReflectionWeights(layers, out) {
  const l = layers && typeof layers === "object" ? layers : {};
  const a = (layer) => (layer && typeof layer === "object" && layer.on === true ? layer.conf : 0);
  const on = l.stackOn === false ? 0 : 1;
  return reflStackWeightsJs(a(l.planar), a(l.ssr), a(l.probe), on, out);
}


export function classifyDominantSource(weights) {
  const w = weights && typeof weights === "object" ? weights : {};
  let bestId = REFL_SOURCE_IDS.sky;
  let bestW = 0;
  for (let i = 0; i < REFL_PRIORITY.length; i++) {
    const name = REFL_PRIORITY[i];
    const val = reflClamp01(w[name]);
    if (val > bestW) {
      bestId = REFL_SOURCE_IDS[name];
      bestW = val;
    }
  }
  return bestId;
}


export function aggregateStackDistribution(counts, out) {
  const c = counts && typeof counts === "object" ? counts : {};
  const n = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
  const planar = n(c.planar);
  const ssr = n(c.ssr);
  const probe = n(c.probe);
  const sky = n(c.sky);
  const total = planar + ssr + probe + sky;
  const pct = (v) => (total > 0 ? Math.round((v / total) * 1000) / 10 : 0);
  const o = out && typeof out === "object" ? out : {};
  o.total = total;
  o.planarPct = pct(planar);
  o.ssrPct = pct(ssr);
  o.probePct = pct(probe);
  o.skyPct = pct(sky);
  return o;
}


export function makeStackTelemetry() {
  return {
    on: false,
    generation: 0,
    layers: { planar: false, ssr: false, probe: false, sky: true },
    distribution: { planarPct: 0, ssrPct: 0, probePct: 0, skyPct: 0, total: 0 },
  };
}


export function reflectionStackGlslChunk() {
  return [
    "vec4 rswReflStackWeights(float planarA, float ssrA, float probeA, float stackOn) {",
    "  float on = clamp(stackOn, 0.0, 1.0);",
    "  float wPlanar = clamp(planarA, 0.0, 1.0) * on;",
    "  float rem = 1.0 - wPlanar;",
    "  float wSsr = clamp(ssrA, 0.0, 1.0) * rem * on;",
    "  rem = rem - wSsr;",
    "  float wProbe = clamp(probeA, 0.0, 1.0) * rem * on;",
    "  float wSky = 1.0 - wPlanar - wSsr - wProbe;",
    "  return vec4(wPlanar, wSsr, wProbe, wSky);",
    "}",
    "vec3 rswReflStackCompose(vec3 planarC, float planarA, vec3 ssrC, float ssrA, vec3 probeC, float probeA, vec3 skyC, float stackOn) {",
    "  vec4 w = rswReflStackWeights(planarA, ssrA, probeA, stackOn);",
    "  vec3 outC = planarC * w.x + ssrC * w.y + probeC * w.z + skyC * w.w;",
    "  return outC;",
    "}",
  ].join("\n");
}
