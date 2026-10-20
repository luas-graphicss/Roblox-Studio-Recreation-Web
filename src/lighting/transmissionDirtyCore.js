import { TRANS_RT_SIZE } from "./transmissionShadowCore.js";


export const TRANS_RT_SIZE_WEAK = 512;

export const TRANS_WEAK_MIN_FRAMES = 2;


export const TRANS_DRIFT_FRAC = 0.2;

export const TRANS_HALF_RATIO = 1.15;


export const TRANS_DIR_MIN_DOT = 0.9998;


export function transRtSizeFor(weak) {
  return weak === true ? TRANS_RT_SIZE_WEAK : TRANS_RT_SIZE;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}


function fnvMix(h, v) {
  const q = Math.round(num(v) * 1000);
  h ^= q & 0xff;
  h = Math.imul(h, 16777619);
  h ^= (q >>> 8) & 0xff;
  h = Math.imul(h, 16777619);
  h ^= (q >>> 16) & 0xff;
  h = Math.imul(h, 16777619);
  h ^= (q >>> 24) & 0xff;
  h = Math.imul(h, 16777619);
  return h;
}

export function transListSignature(list) {
  const arr = Array.isArray(list) ? list : [];
  let h = 0x811c9dc5 | 0;
  h = fnvMix(h, arr.length);
  for (let i = 0; i < arr.length; i++) {
    const it = arr[i] && typeof arr[i] === "object" ? arr[i] : null;
    const m = it && it.m ? it.m : null;
    if (m) {
      for (let k = 0; k < 16; k++) h = fnvMix(h, m[k]);
    }
    const t = it && it.tint && typeof it.tint === "object" ? it.tint : null;
    if (t) {

      if (typeof t.r === "number" || typeof t.g === "number" || typeof t.b === "number") {
        h = fnvMix(h, t.r);
        h = fnvMix(h, t.g);
        h = fnvMix(h, t.b);
      } else {
        h = fnvMix(h, t[0]);
        h = fnvMix(h, t[1]);
        h = fnvMix(h, t[2]);
      }
    }
  }

  return arr.length + ":" + (h >>> 0).toString(16);
}


export function transWindowDirty(prev, cur) {
  if (!prev || typeof prev !== "object") return { dirty: true, reason: "primeiro render" };
  const pc = prev.center && typeof prev.center === "object" ? prev.center : {};
  const cc = cur && cur.center && typeof cur.center === "object" ? cur.center : {};
  const ph = num(prev.half);
  const ch = num(cur && cur.half);
  const half = ph > 1 ? ph : 1;
  const dx = num(cc.x) - num(pc.x);
  const dy = num(cc.y) - num(pc.y);
  const dz = num(cc.z) - num(pc.z);
  if (Math.sqrt(dx * dx + dy * dy + dz * dz) > half * TRANS_DRIFT_FRAC) {
    return { dirty: true, reason: "janela: centro derivou" };
  }
  const ratio = ph > 0 && ch > 0 ? (ch > ph ? ch / ph : ph / ch) : 1e9;
  if (ratio > TRANS_HALF_RATIO) return { dirty: true, reason: "janela: tamanho mudou" };
  const pd = prev.dirToSun && typeof prev.dirToSun === "object" ? prev.dirToSun : {};
  const cd = cur && cur.dirToSun && typeof cur.dirToSun === "object" ? cur.dirToSun : {};
  const dot = num(pd.x) * num(cd.x) + num(pd.y) * num(cd.y) + num(pd.z) * num(cd.z);
  if (dot < TRANS_DIR_MIN_DOT) return { dirty: true, reason: "sol: direção girou" };
  return { dirty: false, reason: "" };
}

export function createTransDirtyGate(opts) {
  const weak = !!(opts && opts.weak === true);
  const minFrames = weak ? TRANS_WEAK_MIN_FRAMES : 1;
  const renderedWin = { center: { x: 0, y: 0, z: 0 }, half: 0, dirToSun: { x: 0, y: 1, z: 0 } };
  let renderedSig = null;
  let hasRendered = false;
  let framesSince = minFrames;                                 
  let renders = 0;
  let skips = 0;
  let deferrals = 0;
  let lastReason = "";

  const result = { render: false, reason: "" };

  function frame(listSig, win) {
    framesSince++;
    let reason = "";
    if (!hasRendered) {
      reason = "primeiro render";
    } else if (listSig !== renderedSig) {
      reason = "transmissores mudaram";
    } else {
      const w = transWindowDirty(renderedWin, win);
      if (w.dirty) reason = w.reason;
    }
    if (reason === "") {

      skips++;
      result.render = false;
      result.reason = "";
      return result;
    }
    if (framesSince < minFrames) {


      deferrals++;
      result.render = false;
      result.reason = "";
      return result;
    }
    hasRendered = true;
    renderedSig = listSig;
    const c = win && win.center && typeof win.center === "object" ? win.center : {};
    const d = win && win.dirToSun && typeof win.dirToSun === "object" ? win.dirToSun : {};
    renderedWin.center.x = num(c.x);
    renderedWin.center.y = num(c.y);
    renderedWin.center.z = num(c.z);
    renderedWin.half = num(win && win.half);
    renderedWin.dirToSun.x = num(d.x);
    renderedWin.dirToSun.y = num(d.y);
    renderedWin.dirToSun.z = num(d.z);
    framesSince = 0;
    renders++;
    lastReason = reason;
    result.render = true;
    result.reason = reason;
    return result;
  }

  function reset() {
    hasRendered = false;
    renderedSig = null;
    framesSince = minFrames;
  }



  function getStats() {
    return { weak, renders, skips, deferrals, framesSince, lastReason };
  }

  return { frame, reset, getStats };
}
