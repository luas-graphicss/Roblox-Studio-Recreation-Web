export const ILF1_BENCH_VERSION = 1;


export const ILF1_SCENES = Object.freeze([
  Object.freeze({ id: "chart_pbr", nome: "Chart PBR: esferas rough×metal + escada de Reflectance", clockTime: 14 }),
  Object.freeze({ id: "exterior_meiodia", nome: "Exterior meio-dia (sol a pino)", clockTime: 12.2 }),
  Object.freeze({ id: "golden_hour", nome: "Golden hour (sol raso dourado)", clockTime: 17.6 }),
  Object.freeze({ id: "noite_neon", nome: "Noite com letreiros neon + luzes locais", clockTime: 0 }),
  Object.freeze({ id: "interior_contraste", nome: "Interior contraste alto (abertura única)", clockTime: 14 }),
  Object.freeze({ id: "piso_molhado", nome: "Piso molhado/espelho (Reflectance alta)", clockTime: 15 }),
  Object.freeze({ id: "vidro_agua", nome: "Vidro e água (transmissão/refração)", clockTime: 14 }),
  Object.freeze({ id: "emissivos", nome: "Emissivos à noite (escada de Neon)", clockTime: 0.5 }),
]);
export const ILF1_SCENE_IDS = Object.freeze(ILF1_SCENES.map((s) => s.id));


export const ILF1_HIST_BINS = 32;


export const ILF1_MID_GREY = 0.18;

export const ILF1_EV_MIN = -20;
export const ILF1_EV_MAX = 20;
const LUMA_EPS = 1e-6;


export function srgbByteToLinear(b) {
  const c = (Number(b) || 0) / 255;
  const x = c < 0 ? 0 : c > 1 ? 1 : c;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}


export function lumaRec709(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}



export function evFromLuma(y) {
  if (!Number.isFinite(y) || y <= LUMA_EPS) return ILF1_EV_MIN;
  const ev = Math.log2(y / ILF1_MID_GREY);
  return ev < ILF1_EV_MIN ? ILF1_EV_MIN : ev > ILF1_EV_MAX ? ILF1_EV_MAX : ev;
}



export function sanitizeCaptureOpts(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const w = Math.round(Number(o.sampleWidth));
  const cov = Number(o.minCoverage);
  const a = Math.round(Number(o.minAlpha));
  return {

    sampleWidth: Number.isFinite(w) ? Math.min(Math.max(w, 16), 512) : 192,


    minCoverage: Number.isFinite(cov) ? Math.min(Math.max(cov, 0.05), 1) : 0.5,

    minAlpha: Number.isFinite(a) ? Math.min(Math.max(a, 1), 255) : 8,
  };
}


export function analyzeRgba(data, width, height, opts) {
  const o = sanitizeCaptureOpts(opts);
  const w = Math.max(0, Math.round(Number(width) || 0));
  const h = Math.max(0, Math.round(Number(height) || 0));
  const total = w * h;
  const out = {
    valid: false,
    reason: "",
    width: w,
    height: h,
    pixels: total,
    drawn: 0,
    coverage: 0,
    hist: new Array(ILF1_HIST_BINS).fill(0),
    histBins: ILF1_HIST_BINS,
    avgLuma: 0,                                          
    logAvgLuma: 0,                                                        
    evMean: ILF1_EV_MIN,                          
    evLog: ILF1_EV_MIN,                                                    
    p05: 0,                                                   
    p50: 0,
    p95: 0,
    clipLow: 0,                                                  
    clipHigh: 0,                                                      
  };
  if (!data || typeof data.length !== "number" || total === 0 || data.length < total * 4) {
    out.reason = "dados ausentes/curtos";
    return out;
  }
  let drawn = 0;
  let sum = 0;
  let sumLog = 0;
  let clipLo = 0;
  let clipHi = 0;
  for (let i = 0; i < total; i++) {
    const j = i * 4;
    if ((data[j + 3] | 0) < o.minAlpha) continue;
    drawn += 1;
    const rb = data[j] | 0;
    const gb = data[j + 1] | 0;
    const bb = data[j + 2] | 0;

    const yByte = 0.2126 * rb + 0.7152 * gb + 0.0722 * bb;
    const bin = Math.min(ILF1_HIST_BINS - 1, (yByte / 8) | 0);
    out.hist[bin] += 1;
    if (yByte <= 2) clipLo += 1;
    if (yByte >= 253) clipHi += 1;

    const y = lumaRec709(srgbByteToLinear(rb), srgbByteToLinear(gb), srgbByteToLinear(bb));
    sum += y;
    sumLog += Math.log2(y > LUMA_EPS ? y : LUMA_EPS);
  }
  out.drawn = drawn;
  out.coverage = total > 0 ? drawn / total : 0;
  if (drawn === 0 || out.coverage < o.minCoverage) {
    out.reason = "coverage baixa (buffer vazio/invalidado)";
    return out;
  }
  out.valid = true;
  out.avgLuma = sum / drawn;
  out.logAvgLuma = Math.pow(2, sumLog / drawn);
  out.evMean = evFromLuma(out.avgLuma);
  out.evLog = evFromLuma(out.logAvgLuma);
  out.clipLow = clipLo / drawn;
  out.clipHigh = clipHi / drawn;

  const pct = (q) => {
    const alvo = q * drawn;
    let acc = 0;
    for (let b = 0; b < ILF1_HIST_BINS; b++) {
      acc += out.hist[b];
      if (acc >= alvo) return (b * 8 + 4) / 255;
    }
    return 1;
  };
  out.p05 = pct(0.05);
  out.p50 = pct(0.5);
  out.p95 = pct(0.95);
  return out;
}


export function compactStats(st) {
  if (!st || st.valid !== true) return null;
  const r4 = (x) => Math.round((Number(x) || 0) * 10000) / 10000;
  return {
    evMean: r4(st.evMean),
    evLog: r4(st.evLog),
    avgLuma: r4(st.avgLuma),
    p05: r4(st.p05),
    p50: r4(st.p50),
    p95: r4(st.p95),
    clipLow: r4(st.clipLow),
    clipHigh: r4(st.clipHigh),
    coverage: r4(st.coverage),
  };
}


export function summarizeBaseline(results) {
  const byScene = {};
  let done = 0;
  const missing = [];
  for (const id of ILF1_SCENE_IDS) {
    const st = results && typeof results === "object" ? results[id] : null;
    const c = st && st.valid === true ? compactStats(st) : st && typeof st.evMean === "number" && st.valid === undefined ? st : null;
    if (c) {
      byScene[id] = c;
      done += 1;
    } else {
      missing.push(id);
    }
  }
  return { version: ILF1_BENCH_VERSION, scenes: ILF1_SCENE_IDS.length, done, missing, byScene };
}








export function baselineRows(results) {
  const rows = [];
  for (const id of ILF1_SCENE_IDS) {
    const st = results && typeof results === "object" ? results[id] : null;
    const c = st && st.valid === true ? compactStats(st) : st && typeof st.evMean === "number" && st.valid === undefined ? st : null;
    if (!c) continue;
    const fps = Number(st.fpsParado);
    rows.push({
      cena: id,
      fpsParado: Number.isFinite(fps) && fps > 0 ? Math.round(fps * 10) / 10 : null,
      evMean: c.evMean,
      evLog: c.evLog,
      p50: c.p50,
      clipLow: c.clipLow,
      clipHigh: c.clipHigh,
      coverage: c.coverage,
    });
  }
  return rows;
}


export function compareStats(a, b) {
  if (!a || !b) return null;
  const d = (x, y) => Math.round(((Number(y) || 0) - (Number(x) || 0)) * 10000) / 10000;
  return {
    dEvMean: d(a.evMean, b.evMean),
    dEvLog: d(a.evLog, b.evLog),
    dP50: d(a.p50, b.p50),
    dClipLow: d(a.clipLow, b.clipLow),
    dClipHigh: d(a.clipHigh, b.clipHigh),
  };
}
