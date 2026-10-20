export const SHADOW_HARD_MAX = 32;                                       
export const SHADOW_MIN_ACTIVE = 2;                                      
export const FRAME_GAP_MS = 250;                                             
export const FRAME_CLAMP_MS = 100;                                             
export const RESERVED_TEXTURES = 6;                                              
export const IDLE_AFTER_MS = 1500;                                          
export const IDLE_UP_AFTER_MS = 1000;                                       
export const IDLE_SELF_MS = 700;                                                                    

function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}


export function hardCapFromGpu(caps) {
  const maxTextures = Math.floor(num(caps && caps.maxTextures, 8));
  const maxTextureSize = num(caps && caps.maxTextureSize, 2048);
  let cap = maxTextures - RESERVED_TEXTURES;
  if (maxTextureSize < 4096) cap = Math.min(cap, 6);               
  if (cap < SHADOW_MIN_ACTIVE) cap = SHADOW_MIN_ACTIVE;
  if (cap > SHADOW_HARD_MAX) cap = SHADOW_HARD_MAX;
  return cap;
}


export function localShadowCap(hardCap, extraGlobalTextures) {
  const cap = Math.floor(num(hardCap, SHADOW_MIN_ACTIVE));
  const extra = Math.max(0, Math.floor(num(extraGlobalTextures, 0)));
  let out = cap - extra;
  if (out < SHADOW_MIN_ACTIVE) out = SHADOW_MIN_ACTIVE;
  if (out > SHADOW_HARD_MAX) out = SHADOW_HARD_MAX;
  return out;
}


export function createBudgetController(opts) {
  const o = opts || {};
  const hardCap = Math.max(
    SHADOW_MIN_ACTIVE,
    Math.min(SHADOW_HARD_MAX, Math.floor(num(o.hardCap, 8))),
  );
  const targetMs = Math.min(50, Math.max(4, num(o.targetMs, 16.7)));
  const upAfterMs = Math.max(100, num(o.upAfterMs, 800));
  const downAfterMs = Math.max(50, num(o.downAfterMs, 250));
  const start = Math.max(SHADOW_MIN_ACTIVE, Math.min(hardCap, Math.floor(num(o.start, 4))));
  let budget = start;
  let ema = 0;
  let lastChange = 0;
  let streak = 0;
  let lastSampleAt = 0;
  let idleGraceUntil = 0;

  function sample(dtMs, nowMs) {
    const dt = num(dtMs, NaN);
    const now = num(nowMs, NaN);
    const isolated = !Number.isFinite(dt) || dt <= 0 || dt > FRAME_GAP_MS;


    if (Number.isFinite(now) && !(isolated && now < idleGraceUntil)) lastSampleAt = now;


    if (isolated || !Number.isFinite(now)) {
      streak = 0;
      return budget;
    }


    streak += 1;
    if (streak < 2) return budget;


    const dtc = dt > FRAME_CLAMP_MS ? FRAME_CLAMP_MS : dt;
    ema = ema === 0 ? dtc : ema * 0.9 + dtc * 0.1;
    if (ema > targetMs * 1.2) {
      if (now - lastChange >= downAfterMs && budget > SHADOW_MIN_ACTIVE) {
        budget = Math.max(SHADOW_MIN_ACTIVE, budget - Math.max(1, Math.ceil(budget * 0.25)));
        lastChange = now;
      }
    } else if (ema < targetMs * 0.7) {
      if (now - lastChange >= upAfterMs && budget < hardCap) {
        budget += 1;
        lastChange = now;
      }
    }
    return budget;
  }


  function idleTick(nowMs) {
    const now = num(nowMs, NaN);
    if (!Number.isFinite(now)) return { budget, changed: false };
    if (lastSampleAt > 0 && now - lastSampleAt < IDLE_AFTER_MS) return { budget, changed: false };
    if (budget >= hardCap || now - lastChange < IDLE_UP_AFTER_MS) return { budget, changed: false };
    budget += 1;
    lastChange = now;
    idleGraceUntil = now + IDLE_SELF_MS;
    ema = 0;
    streak = 0;
    return { budget, changed: true };
  }

  function reset() {
    budget = start;
    ema = 0;
    lastChange = 0;
    streak = 0;
    lastSampleAt = 0;
    idleGraceUntil = 0;
  }

  return {
    sample,
    idleTick,
    reset,
    getBudget: () => budget,
    getEma: () => ema,
    getHardCap: () => hardCap,
  };
}


export function shadowResFor(rank, budget) {
  const r = Math.max(0, Math.floor(num(rank, 0)));
  const b = Math.max(0, Math.floor(num(budget, 0)));
  if (b > 12) return r < 2 ? 512 : 256;
  if (r === 0) return 1024;
  return r < 4 ? 512 : 256;
}
