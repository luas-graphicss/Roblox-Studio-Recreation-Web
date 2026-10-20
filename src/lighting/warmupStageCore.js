export const WARMUP_STAGE_ORDER = Object.freeze([
  "csm",
  "pcss",
  "gi",
  "far",
  "ao",
  "contact",
  "trans",
  "megalights",
]);

export const WARMUP_STAGE_LABELS = Object.freeze({
  csm: "cascatas do sol",
  pcss: "penumbra (PCSS)",
  gi: "iluminação global",
  far: "sombras distantes",
  ao: "oclusão ambiente",
  contact: "sombras de contato",
  trans: "vidro colorido",
  megalights: "luzes extras",
});


export function createWarmupStager(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const order = Array.isArray(o.order) && o.order.length ? o.order.slice() : WARMUP_STAGE_ORDER.slice();
  const pos = new Map();
  for (let i = 0; i < order.length; i++) pos.set(order[i], i);
  let active = false;
  let idx = 0;                                       
  let tech = "";
  let startedAt = 0;
  let pausedFrames = 0;
  let ticks = 0;
  return {
    order: order.slice(),
    arm(a) {
      const args = a && typeof a === "object" ? a : {};
      active = true;
      idx = 0;
      ticks = 0;
      pausedFrames = 0;
      tech = typeof args.tech === "string" ? args.tech : "";
      startedAt = Number.isFinite(Number(args.nowMs)) ? Number(args.nowMs) : 0;
      return true;
    },
    isActive() {
      return active;
    },


    holds(feature) {
      if (!active) return false;
      const p = pos.get(feature);
      return p != null && p >= idx;
    },


    tick() {
      if (!active) return { advanced: false, done: false, idx, total: order.length };
      if (pausedFrames > 0) {
        pausedFrames -= 1;
        return { advanced: false, paused: true, done: false, idx, total: order.length };
      }
      const feature = order[idx];
      idx += 1;
      ticks += 1;
      const done = idx >= order.length;
      if (done) active = false;
      return { advanced: true, feature, done, idx, total: order.length };
    },

    pause(frames) {
      if (!active) return;
      const f = Math.max(1, Math.floor(Number(frames) || 0));
      if (f > pausedFrames) pausedFrames = f;
    },


    cancel() {
      active = false;
      pausedFrames = 0;
    },
    progress() {
      return {
        idx,
        total: order.length,
        pct: order.length ? idx / order.length : 1,
        next: active ? order[idx] || null : null,
      };
    },
    elapsed(nowMs) {
      const n = Number(nowMs);
      return active && Number.isFinite(n) && startedAt > 0 ? Math.max(0, n - startedAt) : 0;
    },
    debug() {
      return {
        active,
        idx,
        total: order.length,
        next: active ? order[idx] || null : null,
        tech,
        ticks,
        pausedFrames,
      };
    },
  };
}


export function createTdrWatchdog(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const slowMs = Number.isFinite(Number(o.slowMs)) && Number(o.slowMs) > 0 ? Number(o.slowMs) : 150;
  const slowRun = Math.max(1, Math.floor(Number(o.slowRun) || 3));
  const panicMs = Number.isFinite(Number(o.panicMs)) && Number(o.panicMs) > 0 ? Number(o.panicMs) : 700;
  const idleGapMs = Number.isFinite(Number(o.idleGapMs)) && Number(o.idleGapMs) > 0 ? Number(o.idleGapMs) : 10000;
  let run = 0;
  let slowTrips = 0;
  let panics = 0;
  let worstMs = 0;
  let contextLosses = 0;
  return {
    limits: { slowMs, slowRun, panicMs, idleGapMs },
    sample(frameMs) {
      const ms = Number(frameMs);
      if (!Number.isFinite(ms) || ms <= 0 || ms >= idleGapMs) {
        return { slow: false, slowTripped: false, panic: false, runLength: run };
      }
      if (ms > worstMs) worstMs = ms;
      const panic = ms >= panicMs;
      if (panic) panics += 1;
      let slowTripped = false;
      if (ms >= slowMs) {
        run += 1;
        if (run === slowRun) {
          slowTrips += 1;
          slowTripped = true;                                             


          run = 0;
        }
      } else {
        run = 0;
      }
      return { slow: ms >= slowMs, slowTripped, panic, runLength: run };
    },
    noteContextLost() {
      contextLosses += 1;
      return contextLosses;
    },
    reset() {
      run = 0;
      worstMs = 0;
    },
    debug() {
      return {
        worstMs: Math.round(worstMs * 10) / 10,
        slowTrips,
        panics,
        contextLosses,
        runLength: run,
      };
    },
  };
}


export function stageToastMessage(a) {
  const s = a && typeof a === "object" ? a : {};
  const tech = typeof s.tech === "string" && s.tech ? s.tech : "Future";
  if (s.compiling) {
    const ready = Math.max(0, Math.floor(Number(s.ready) || 0));
    const total = Math.max(0, Math.floor(Number(s.totalPrograms) || 0));
    const suffix = total > 0 ? " (" + Math.min(ready, total) + "/" + total + " programas)" : "…";
    return "Preparando iluminação " + tech + " — compilando shaders" + suffix;
  }
  const idx = Math.max(0, Math.floor(Number(s.idx) || 0));
  const total = Math.max(1, Math.floor(Number(s.total) || 1));
  if (idx >= total) return "Iluminação " + tech + " pronta.";
  const label = s.next && WARMUP_STAGE_LABELS[s.next] ? WARMUP_STAGE_LABELS[s.next] : null;
  return "Ativando efeitos do " + tech + " (" + idx + "/" + total + (label ? " — próximo: " + label : "") + ")";
}


export function warmupProgress(a) {
  const s = a && typeof a === "object" ? a : {};
  const idx = Math.max(0, Number(s.idx) || 0);
  const total = Math.max(1, Number(s.total) || 1);
  const base = Math.max(0, Math.min(1, idx / total));
  if (!s.compiling) return base;
  const ready = Math.max(0, Number(s.ready) || 0);
  const progs = Math.max(0, Number(s.totalPrograms) || 0);
  const frac = progs > 0 ? Math.max(0, Math.min(1, ready / progs)) : 0;
  return Math.max(0, Math.min(1, base + frac / total));
}


export function buildTdrReport(a) {
  const s = a && typeof a === "object" ? a : {};
  const lines = [];
  lines.push("[Iluminação] Relatório anti-TDR (F21) — " + (s.kind || "evento"));
  lines.push("  • Technology: " + (s.tech || "?") + (s.gpuReason ? " · GPU: " + s.gpuReason : ""));
  const st = s.stage && typeof s.stage === "object" ? s.stage : null;
  lines.push(
    "  • Warmup: " +
      (st && st.active
        ? "estágio " + st.idx + "/" + st.total + (st.next ? " (próximo: " + (WARMUP_STAGE_LABELS[st.next] || st.next) + ")" : "")
        : "inativo"),
  );
  const w = s.watchdog && typeof s.watchdog === "object" ? s.watchdog : {};
  lines.push(
    "  • Pior frame: " +
      (Number.isFinite(Number(w.worstMs)) ? Math.round(Number(w.worstMs)) : "?") +
      " ms · sequências lentas: " + (w.slowTrips || 0) +
      " · quase-TDR: " + (w.panics || 0) +
      " · contextos perdidos: " + (w.contextLosses || 0),
  );
  if (s.action) lines.push("  • Ação: " + s.action);
  return lines.join("\n");
}
