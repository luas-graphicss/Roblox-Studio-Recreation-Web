import { FRAME_GAP_MS, RESERVED_TEXTURES, SHADOW_MIN_ACTIVE } from "./shadowBudget.js";

function toFiniteNumber(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export const SHADOW_TIER_FULL = "full";
export const SHADOW_TIER_LITE = "lite";

export function computeShadowTier(input) {
  const src = input && typeof input === "object" ? input : {};


  const weak = src.weak !== false;
  const maxTextures = toFiniteNumber(src.maxTextures, 16);
  const cascades = weak ? 2 : maxTextures >= 16 ? 4 : 2;
  return Object.freeze({
    tier: weak ? SHADOW_TIER_LITE : SHADOW_TIER_FULL,


    csmCascades: cascades < 2 ? 2 : cascades > 4 ? 4 : cascades,
    temporal: !weak,                                                     
    ao: !weak,                                                 
    contact: !weak,                                                          
    rt: !weak,                                
  });
}


export const SHADOW_TIERS = Object.freeze(["micro", "lite", "low", "medium", "high", "ultra"]);

export const TIER_TARGET_MS = 25;                                        
export const TIER_DOWN_RATIO = 1.35;                                     
export const TIER_UP_RATIO = 0.6;                                          
export const TIER_MIN_HOLD_MS = 1000;                                   
export const TIER_UP_HOLD_MS = 3000;                                 
export const TIER_MOTION_DECAY = 0.75;                                  


export const TIER_COST_CLAMP_MS = 1000;
export const TIER_COST_ALPHA = 0.3;
export const TIER_PANIC_RATIO = 3;


export const TIER_REGRET_WINDOW_MS = 15000;
export const TIER_REGRET_BASE_MS = 15000;
export const TIER_REGRET_MAX_MS = 300000;


export const TIER_UP_CADENCE_MS = 18.5;
export const TIER_BOOT_GRACE_MS = 5000;


export const TIER_IDLE_COST_RATIO = 6;


















































































export const TIER_TABLE = Object.freeze({
  micro: Object.freeze({ tier: "micro", csm: false, csmRodizio: true, rodizioCascades: 2, csmCascades: 2, csmRes: 1024, csmRes0: 1024, sunRes: 1024, sunTexelTarget: 0.35, renderScale: 1, renderScaleWeak: 1, temporal: false, temporalWeak: false, temporalWeakMask: true, gtao: false, gtaoLite: false, contact: false, contactSteps: 8, rt: false, motionTaps: 0, pcssTaps: 8, pcssBlockers: 6, far: false, farLite: false, trans: false, transLite: true, capsule: true, capsuleWWeak: 1 }),
  lite: Object.freeze({ tier: "lite", csm: true, rodizioCascades: 4, csmCascades: 2, csmRes: 2048, csmRes0: 1024, sunRes: 0, renderScale: 1, renderScaleWeak: 1, temporal: false, temporalWeak: true, gtao: false, gtaoLite: false, contact: false, contactSteps: 8, rt: false, motionTaps: 0, pcssTaps: 9, pcssBlockers: 8, far: false, farLite: true, trans: false, transLite: true, capsule: true, capsuleWWeak: 0.85 }),
  low: Object.freeze({ tier: "low", csm: true, rodizioCascades: 4, csmCascades: 2, csmRes: 2048, csmRes0: 1024, sunRes: 0, renderScale: 1, renderScaleWeak: 1, temporal: false, temporalWeak: true, gtao: false, gtaoLite: true, contact: true, contactSteps: 8, rt: false, motionTaps: 0, pcssTaps: 12, pcssBlockers: 10, far: false, farLite: true, trans: true, transLite: false, capsule: true, capsuleWWeak: 0.85 }),
  medium: Object.freeze({ tier: "medium", csm: true, csmCascades: 3, csmRes: 2048, csmRes0: 2048, sunRes: 0, renderScale: 1, renderScaleWeak: 1, temporal: true, temporalWeak: false, gtao: true, gtaoLite: false, contact: true, contactSteps: 12, rt: false, motionTaps: 4, pcssTaps: 17, pcssBlockers: 16, far: true, farLite: false, trans: true, transLite: false, capsule: true, capsuleWWeak: 1 }),
  high: Object.freeze({ tier: "high", csm: true, csmCascades: 4, csmRes: 2048, csmRes0: 2048, sunRes: 0, renderScale: 1, renderScaleWeak: 1, temporal: true, temporalWeak: false, gtao: true, gtaoLite: false, contact: true, contactSteps: 12, rt: false, motionTaps: 6, pcssTaps: 17, pcssBlockers: 16, far: true, farLite: false, trans: true, transLite: false, capsule: true, capsuleWWeak: 1 }),
  ultra: Object.freeze({ tier: "ultra", csm: true, csmCascades: 4, csmRes: 2048, csmRes0: 2048, sunRes: 0, renderScale: 1, renderScaleWeak: 1, temporal: true, temporalWeak: false, gtao: true, gtaoLite: false, contact: true, contactSteps: 12, rt: true, motionTaps: 6, pcssTaps: 17, pcssBlockers: 16, far: true, farLite: false, trans: true, transLite: false, capsule: true, capsuleWWeak: 1 }),
});

export function tierIndex(tier) {
  return SHADOW_TIERS.indexOf(tier);
}


export function tierConfig(tier) {
  return TIER_TABLE[tier] || TIER_TABLE.lite;
}


export function effectiveRenderScale(cfg, weak) {


  if (!cfg || typeof cfg !== "object") return 1;
  return 1;
}


export function tierCapsuleEnabled(cfg) {
  if (!cfg || typeof cfg !== "object") return true;
  return cfg.capsule !== false;
}


export function tierCapsuleW(cfg, weak) {
  if (weak !== true || !cfg || typeof cfg !== "object") return 1;
  const n = toFiniteNumber(cfg.capsuleWWeak, 1);
  if (!(n > 0)) return 1;
  return n < 0.5 ? 0.5 : n > 1 ? 1 : n;
}


export function initialTierFor(weak) {
  return weak !== false ? "low" : "ultra";
}


export function maxTierFor(weak) {
  return weak !== false ? "low" : "ultra";
}


export function minTierFor(weak) {
  return weak !== false ? "micro" : "lite";
}


export function tierFarEnabled(cfg, weak) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  if (c.far === true) return true;
  return c.farLite === true && weak === true;
}


export function tierTransEnabled(cfg, weak) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  if (c.trans === true) return true;
  return c.transLite === true && weak === true;
}


export function tierTemporalEnabled(cfg, weak, opts) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  if (c.temporal === true) return true;
  if (c.temporalWeak === true && weak === true) return true;







  const o = opts && typeof opts === "object" ? opts : {};
  return c.temporalWeakMask === true && weak === true && o.sunMask === true;
}


export function tierCsmWanted(cfg, opts) {
  const c = cfg && typeof cfg === "object" ? cfg : TIER_TABLE.lite;
  const o = opts && typeof opts === "object" ? opts : {};
  if (c.csm !== false) return true;
  return c.csmRodizio === true && o.rodizio === true;
}


export function tierRodizioCascades(cfg) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  const n = Math.round(toFiniteNumber(c.rodizioCascades, 4));
  return n < 2 ? 2 : n > 4 ? 4 : n;
}


export function tierSunTexelTarget(cfg, weak) {
  if (weak !== true || !cfg || typeof cfg !== "object") return 0;
  const n = toFiniteNumber(cfg.sunTexelTarget, 0);
  return n > 0 && n <= 4 ? n : 0;
}


export function tierExtraTextures(cfg, opts) {
  const c = cfg && typeof cfg === "object" ? cfg : TIER_TABLE.lite;
  const o = opts && typeof opts === "object" ? opts : {};
  const casc = c.csm
    ? Math.max(1, toFiniteNumber(c.csmCascades, 1)) - 1
    : c.csmRodizio === true && o.rodizio === true
      ? tierRodizioCascades(c) - 1
      : 0;


  const farUnits = toFiniteNumber(o.farUnits, 2) === 1 ? 1 : 2;
  return casc + (o.far ? farUnits : 0) + (o.rt && c.rt ? 1 : 0) + (o.mask === true ? 1 : 0);
}


export function tierFitsTexUnits(cfg, maxTextures, opts) {
  const maxTex = toFiniteNumber(maxTextures, 16);
  return RESERVED_TEXTURES + SHADOW_MIN_ACTIVE + tierExtraTextures(cfg, opts) <= maxTex;
}


export function motionBoostStep(prev, moved) {
  if (moved) return 1;
  const p = toFiniteNumber(prev, 0) * TIER_MOTION_DECAY;
  return p < 0.02 ? 0 : p;
}

export function createTierController(options) {
  const opts = options && typeof options === "object" ? options : {};
  const maxTier = tierIndex(opts.maxTier) >= 0 ? opts.maxTier : "ultra";
  const initialRaw = tierIndex(opts.initial) >= 0 ? opts.initial : "lite";
  const targetMs = Math.max(1, toFiniteNumber(opts.targetMs, TIER_TARGET_MS));
  const minHoldMs = Math.max(0, toFiniteNumber(opts.minHoldMs, TIER_MIN_HOLD_MS));
  const upHoldMs = Math.max(minHoldMs, toFiniteNumber(opts.upHoldMs, TIER_UP_HOLD_MS));

  const regretWindowMs = Math.max(0, toFiniteNumber(opts.regretWindowMs, TIER_REGRET_WINDOW_MS));
  const regretBaseMs = Math.max(0, toFiniteNumber(opts.regretBaseMs, TIER_REGRET_BASE_MS));
  const regretMaxMs = Math.max(regretBaseMs, toFiniteNumber(opts.regretMaxMs, TIER_REGRET_MAX_MS));

  const upCadenceMs = Math.max(0, toFiniteNumber(opts.upCadenceMs, 0));
  const bootGraceMs = Math.max(0, toFiniteNumber(opts.bootGraceMs, 0));
  const maxIdx = tierIndex(maxTier);


  const minIdxRaw = tierIndex(opts.minTier);
  const minIdx = Math.min(minIdxRaw >= 0 ? minIdxRaw : 0, maxIdx);
  let idx = Math.min(Math.max(tierIndex(initialRaw), minIdx), maxIdx);
  let lastChangeMs = -Infinity;                                               
  let streak = 0;
  let costEma = 0;                                                           

  let lastUpAtMs = -Infinity;
  let regretCount = 0;
  let upBlockUntilMs = -Infinity;
  let firstSampleMs = -Infinity;                                                         

  function result(from, direction, reason, changed) {
    return {
      tier: SHADOW_TIERS[idx],
      from,
      changed: !!changed,
      direction: direction || "none",
      reason: reason || "",
    };
  }


  function sample(input) {
    const a = input && typeof input === "object" ? input : {};
    const from = SHADOW_TIERS[idx];
    if (a.hold) {
      streak = 0;
      return result(from, "none", "", false);
    }


    const cost = toFiniteNumber(a.costMs, 0);
    const costOk = cost > 0;
    if (costOk) {
      const c = Math.min(cost, TIER_COST_CLAMP_MS);
      costEma = costEma > 0 ? costEma * (1 - TIER_COST_ALPHA) + c * TIER_COST_ALPHA : c;
    }
    const dt = toFiniteNumber(a.dtMs, 0);
    const dtOk = dt > 0 && dt <= FRAME_GAP_MS;
    if (!dtOk && !costOk) {
      streak = 0;
      return result(from, "none", "", false);
    }
    const ema = toFiniteNumber(a.emaMs, 0);


    const press = Math.max(dtOk && ema > 0 ? ema : 0, costOk ? costEma : 0);
    streak++;
    if (streak < 2 || press <= 0) return result(from, "none", "", false);
    const now = toFiniteNumber(a.nowMs, 0);


    if (bootGraceMs > 0 && firstSampleMs === -Infinity && now > 0) firstSampleMs = now;
    const inBootGrace = bootGraceMs > 0 && firstSampleMs !== -Infinity && now - firstSampleMs < bootGraceMs;


    if (lastUpAtMs !== -Infinity && now - lastUpAtMs > regretWindowMs) {
      lastUpAtMs = -Infinity;
      regretCount = 0;
    }
    const downAt = targetMs * TIER_DOWN_RATIO;
    const upAt = targetMs * TIER_UP_RATIO;


    const bodyIdle =
      costOk && dtOk && costEma > 0 && ema > 0 &&
      upAt > costEma && ema >= TIER_IDLE_COST_RATIO * costEma;


    const panic = press >= targetMs * TIER_PANIC_RATIO && !bodyIdle;


    const classicOk = dtOk && ema > 0;


    const cadenceOk = upCadenceMs > 0 && dtOk && ema > 0 && ema <= upCadenceMs && costOk && costEma > 0 && costEma < upAt;


    if (press > downAt && !cadenceOk && !bodyIdle && idx > minIdx && (panic || !inBootGrace) && (panic || now - lastChangeMs >= minHoldMs)) {
      idx--;
      lastChangeMs = now;
      streak = 0;


      let regretNote = "";
      if (lastUpAtMs !== -Infinity && now - lastUpAtMs <= regretWindowMs) {
        regretCount++;
        const blockMs = Math.min(regretBaseMs * Math.pow(2, regretCount - 1), regretMaxMs);
        upBlockUntilMs = now + blockMs;
        lastUpAtMs = -Infinity;
        regretNote = "; arrependimento " + regretCount + "× — nova subida em ≥" + Math.round(blockMs / 1000) + " s";
      }
      return result(
        from,
        "down",
        "pressão " + (Math.round(press * 10) / 10) + " ms > " + (Math.round(downAt * 10) / 10) + " ms (alvo " + targetMs + " ms" + (panic ? "; pânico ≥3×" : "") + ") — GPU sob pressão" + regretNote,
        true
      );
    }


    if (((classicOk && press < upAt) || cadenceOk || bodyIdle) && idx < maxIdx && now - lastChangeMs >= upHoldMs && now >= upBlockUntilMs) {
      idx++;
      lastChangeMs = now;
      lastUpAtMs = now;                                                     
      streak = 0;
      const upNote = classicOk && press < upAt
        ? "pressão " + (Math.round(press * 10) / 10) + " ms < " + (Math.round(upAt * 10) / 10) + " ms (alvo " + targetMs + " ms) — folga sustentada"
        : cadenceOk
          ? "cadência " + (Math.round(ema * 10) / 10) + " ms ≤ " + upCadenceMs + " ms e custo " + (Math.round(costEma * 10) / 10) + " ms < " + (Math.round(upAt * 10) / 10) + " ms (alvo " + targetMs + " ms) — folga sustentada (F34)"
          : "custo real " + (Math.round(costEma * 100) / 100) + " ms com dt-EMA " + (Math.round(ema * 10) / 10) + " ms (ócio do render sob demanda, não pressão de GPU) — folga real";
      return result(from, "up", upNote, true);
    }
    return result(from, "none", "", false);
  }

  function getTier() {
    return SHADOW_TIERS[idx];
  }

  function getMaxTier() {
    return SHADOW_TIERS[maxIdx];
  }

  function reset(tier) {
    const t = tierIndex(tier);
    idx = t >= 0 ? Math.min(t, maxIdx) : Math.min(tierIndex(initialRaw), maxIdx);
    idx = Math.max(idx, minIdx);                    
    lastChangeMs = -Infinity;
    streak = 0;
    costEma = 0;             
    lastUpAtMs = -Infinity;                                       
    regretCount = 0;
    upBlockUntilMs = -Infinity;
    firstSampleMs = -Infinity;                                                     
  }


  function getRegret() {
    return { count: regretCount, blockedUntilMs: upBlockUntilMs, lastUpAtMs };
  }

  return { sample, getTier, getMaxTier, reset, getRegret };
}
