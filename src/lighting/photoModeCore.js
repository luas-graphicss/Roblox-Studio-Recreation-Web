export const PHOTO_IDLE_MS = 300;                          
export const PHOTO_STEP_MS = 150;                                            
export const PHOTO_PANIC_FRAME_MS = 250;                                         
export const PHOTO_PANIC_HOLD_MS = 3000;                                     
export const PHOTO_TAPS = 17;                                                   
export const PHOTO_BLOCKERS = 16;
export const PHOTO_SCALE_ANCHORS = Object.freeze([0.75, 1]);

const EPS = 1e-3;

function saneMs(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}


export function photoLadder(baseScale) {
  const b = Number(baseScale);
  if (!Number.isFinite(b) || b <= 0 || b >= 1 - EPS) return [];
  const out = [];
  for (const s of PHOTO_SCALE_ANCHORS) if (s > b + EPS) out.push(s);
  return out;
}


export function createPhotoModeController(opts) {
  const o = opts || {};
  const idleMs = saneMs(o.idleMs, PHOTO_IDLE_MS);
  const stepMs = saneMs(o.stepMs, PHOTO_STEP_MS);
  const panicFrameMs = Math.max(1, saneMs(o.panicFrameMs, PHOTO_PANIC_FRAME_MS));
  const panicHoldMs = saneMs(o.panicHoldMs, PHOTO_PANIC_HOLD_MS);

  let phase = "off";                                
  let ladder = [];
  let baseMemo = NaN;
  let stepIdx = -1;                      
  let idleSince = -1;
  let stepAt = -1;                                                       
  let panicUntil = -1;
  let lastNow = -1;
  let panics = 0;
  let expectFrame = false;                                                   

  const out = {
    enabled: false,
    phase: "off",
    scale: 1,
    base: 1,
    stepIdx: -1,
    steps: 0,
    fullTaps: false,
    wantsFrame: false,
    reverted: false,
    panics: 0,
  };

  function fill(enabled, base, wantsFrame, reverted) {
    out.enabled = enabled;
    out.phase = phase;
    out.scale = stepIdx >= 0 && stepIdx < ladder.length ? ladder[stepIdx] : base;
    out.base = base;
    out.stepIdx = stepIdx;
    out.steps = ladder.length;
    out.fullTaps = enabled && (phase === "converge" || phase === "full");
    out.wantsFrame = wantsFrame;
    out.reverted = reverted;
    out.panics = panics;
    return out;
  }


  function drop(enabled, base) {
    const hadFx = phase === "converge" || phase === "full";
    phase = "off";
    stepIdx = -1;
    idleSince = -1;
    stepAt = -1;
    return fill(enabled, base, false, hadFx);
  }

  function update(input) {
    const a = input || {};
    const nRaw = Number(a.nowMs);
    const now = Number.isFinite(nRaw) && nRaw >= 0 ? nRaw : lastNow >= 0 ? lastNow : 0;
    const bRaw = Number(a.baseScale);
    const base = Number.isFinite(bRaw) && bRaw > 0 && bRaw <= 1 ? bRaw : 1;
    if (base !== baseMemo) {


      baseMemo = base;
      ladder = photoLadder(base);
      if (stepIdx >= 0) {
        stepIdx = -1;
        stepAt = now;
        if (phase === "full") phase = "converge";
      }
    }
    const enabled = !!a.enabled;
    if (!enabled) {
      lastNow = now;
      panicUntil = -1;
      expectFrame = false;
      return drop(false, base);
    }


    if ((phase === "converge" || phase === "full") && expectFrame && lastNow >= 0 && stepIdx >= 0 && now - lastNow > panicFrameMs) {
      stepIdx -= 1;
      stepAt = now;
      panicUntil = now + panicHoldMs;
      panics += 1;
      phase = "converge";
    }
    lastNow = now;

    if (a.moving) {
      expectFrame = false;                                                 
      return drop(true, base);                                   
    }

    if (idleSince < 0) idleSince = now;
    if (now - idleSince < idleMs) {
      phase = "wait";
      expectFrame = true;                                                
      return fill(true, base, true, false);
    }


    if (phase !== "converge" && phase !== "full") {
      phase = "converge";
      stepAt = -1;                                          
    }
    let stepped = false;
    if (stepIdx < ladder.length - 1 && (panicUntil < 0 || now >= panicUntil)) {
      if (stepAt < 0 || now - stepAt >= stepMs) {
        stepIdx += 1;
        stepAt = now;
        stepped = true;
      }
    }
    if (ladder.length === 0 || stepIdx === ladder.length - 1) phase = "full";


    expectFrame = phase !== "full" || stepped;
    return fill(true, base, phase !== "full", false);
  }

  function reset() {
    phase = "off";
    ladder = [];
    baseMemo = NaN;
    stepIdx = -1;
    idleSince = -1;
    stepAt = -1;
    panicUntil = -1;
    lastNow = -1;
    panics = 0;
    expectFrame = false;
    return fill(false, 1, false, false);
  }


  function snapshot() {
    return {
      enabled: out.enabled,
      phase: out.phase,
      scale: out.scale,
      base: out.base,
      stepIdx: out.stepIdx,
      steps: out.steps,
      fullTaps: out.fullTaps,
      wantsFrame: out.wantsFrame,
      reverted: out.reverted,
      panics: out.panics,
      idleSince,
      panicUntil,
      expectFrame,
    };
  }

  return { update, reset, snapshot };
}
