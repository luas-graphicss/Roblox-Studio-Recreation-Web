export const PASS_IDS = Object.freeze([
  "principal",                                                                               
  "sombra-raster",                                                                       
  "sombra-paginas",                                                    
  "sombra-locais",                                                     
  "ao-sscs",                                                          
  "far",                                          
  "gi",                                  
  "vidro",                                                       
  "rt-cpu",                                          
  "postfx",                                                                                              
  "ledger",                                               
]);

export const DEFAULT_EMA_ALPHA = 0.1;

export const DEFAULT_BUDGET_MS = 33.3;
export const OVERHEAD_GATE_MS = 0.3;
export const MAX_SAMPLE_MS = 1000;

const KINDS = Object.freeze(["gpu", "cpu", "cpu-estimado", "derivado"]);

function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export function clampSampleMs(v) {
  const n = num(v, 0);
  return n <= 0 ? 0 : n > MAX_SAMPLE_MS ? MAX_SAMPLE_MS : n;
}


export function emaStep(prev, sample, alpha, samples) {
  const a = Math.min(Math.max(num(alpha, DEFAULT_EMA_ALPHA), 0.001), 1);
  const s = clampSampleMs(sample);
  const p = num(prev, 0);
  const n = Math.max(0, Math.floor(num(samples, 0)));
  return n === 0 ? s : p + (s - p) * a;
}

function round3(v) {
  return Math.round(num(v, 0) * 1000) / 1000;
}

export function createPassLedger(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const alpha = Math.min(Math.max(num(o.emaAlpha, DEFAULT_EMA_ALPHA), 0.001), 1);
  const budgetMs = Math.max(1, num(o.budgetMs, DEFAULT_BUDGET_MS));
  const passes = new Map();                                                      
  const acc = new Map();                                                 
  const flags = new Set();
  let open = false;
  let frames = 0;
  let dropped = 0;
  let mode = "desconhecido";
  let modeReason = "";
  let shadowFrames = 0;
  let postfxFrames = 0;

  let emaShadow = 0;
  let nShadow = 0;
  let emaClean = 0;
  let nClean = 0;

  function passOf(id) {
    let p = passes.get(id);
    if (!p) {
      p = { ema: 0, last: 0, max: 0, samples: 0, kind: "gpu", estimated: false };
      passes.set(id, p);
    }
    return p;
  }

  function sanitizeId(id) {
    const s = typeof id === "string" ? id.trim() : "";
    return s ? s.slice(0, 40) : "desconhecido";
  }

  function beginFrame() {
    if (open) {
      dropped += 1;
      acc.clear();
      flags.clear();
    }
    open = true;
  }

  function add(id, ms, addOpts) {
    if (!open) beginFrame();
    const key = sanitizeId(id);
    const v = clampSampleMs(ms);
    let slot = acc.get(key);
    if (!slot) {
      slot = { ms: 0, kind: "gpu", estimated: false };
      acc.set(key, slot);
    }
    slot.ms += v;
    const k =
      addOpts && typeof addOpts.kind === "string" && KINDS.indexOf(addOpts.kind) !== -1
        ? addOpts.kind
        : slot.kind;
    slot.kind = k;
    slot.estimated = slot.estimated || k === "cpu-estimado" || !!(addOpts && addOpts.estimated);
  }

  function setFlag(name) {
    if (!open) beginFrame();
    if (typeof name === "string" && name) flags.add(name);
  }

  function endFrame() {
    if (!open) return;
    recordResolvedFrame(acc, flags);
    if (flags.has("shadowRaster")) shadowFrames += 1;
    if (flags.has("postfx")) postfxFrames += 1;
    frames += 1;
    acc.clear();
    flags.clear();
    open = false;
  }


  function recordResolvedFrame(resolvedPasses, sourceFlags) {
    if (!(resolvedPasses instanceof Map)) return;
    for (const [id, slot] of resolvedPasses) {
      const p = passOf(sanitizeId(id));
      p.ema = emaStep(p.ema, slot.ms, alpha, p.samples);
      p.last = round3(slot.ms);
      if (slot.ms > p.max) p.max = round3(slot.ms);
      p.samples += 1;
      p.kind = slot.kind;
      p.estimated = slot.estimated;
    }
    const principal = resolvedPasses.get("principal");
    if (principal && principal.ms > 0) {
      if (sourceFlags?.has("shadowRaster")) {
        emaShadow = emaStep(emaShadow, principal.ms, alpha, nShadow);
        nShadow += 1;
      } else {
        emaClean = emaStep(emaClean, principal.ms, alpha, nClean);
        nClean += 1;
      }
    }
  }

  function setMode(m, reason) {
    mode = typeof m === "string" && m ? m : mode;
    modeReason = typeof reason === "string" ? reason : modeReason;
  }

  function getLedger() {
    const list = [];
    let totalMs = 0;
    const seen = new Set();
    const pushPass = (id) => {
      if (seen.has(id)) return;
      seen.add(id);
      if (id === "sombra-raster") {

        const okSplit = nShadow > 0 && nClean > 0;
        const est = okSplit ? Math.max(0, emaShadow - emaClean) : 0;
        list.push({
          id,
          emaMs: round3(est),
          lastMs: 0,
          maxMs: 0,
          samples: Math.min(nShadow, nClean),
          kind: "derivado",
          estimated: true,
          note: okSplit
            ? "EMA(principal com passe cheio) - EMA(principal sem): " + round3(emaShadow) + " - " + round3(emaClean)
            : "aguardando amostras com e sem passe cheio de sombra",
        });
        return;
      }
      const p = passes.get(id);
      if (!p) {
        list.push({ id, emaMs: 0, lastMs: 0, maxMs: 0, samples: 0, kind: "gpu", estimated: false });
        return;
      }
      const ema = round3(p.ema);
      totalMs += ema;
      list.push({ id, emaMs: ema, lastMs: p.last, maxMs: p.max, samples: p.samples, kind: p.kind, estimated: p.estimated });
    };
    for (const id of PASS_IDS) pushPass(id);
    for (const id of passes.keys()) pushPass(id);
    const overhead = passes.get("ledger");
    const total = round3(totalMs);
    return {
      mode,
      modeReason,
      frames,
      droppedFrames: dropped,
      budgetMs,
      emaAlpha: alpha,
      totalMs: total,
      headroomMs: round3(budgetMs - total),
      overBudget: total > budgetMs,
      overheadMs: overhead ? round3(overhead.ema) : 0,
      overheadGateMs: OVERHEAD_GATE_MS,
      flags: { shadowFrames, postfxFrames },
      passes: list,
    };
  }

  return { beginFrame, add, setFlag, endFrame, recordResolvedFrame, setMode, getLedger };
}
